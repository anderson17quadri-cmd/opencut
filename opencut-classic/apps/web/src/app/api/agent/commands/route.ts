import { readFile, stat } from "node:fs/promises";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/agent/broker";
import { downloadMedia, searchFreeMedia, withPreviews } from "@/agent/downloads";
import {
	recordAlias,
	recordDownloadCredit,
	recordRenderedCredit,
	rememberSearchResults,
	writeCreditsFile,
} from "@/agent/credits";
import { EMOJI_LICENSE, EMOJI_SOURCE, fetchEmojiAnimation, searchEmoji } from "@/agent/emoji";
import { animationSeen, fetchAnimation, LOTTIE_LICENSE, searchAnimations } from "@/agent/lottie";
import { defaultMediaFolders, listMediaFolder } from "@/agent/local-files";
import { isFromLocalProcess } from "@/agent/request-guards";
import { styleGuide } from "@/agent/style-guides";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
	tool: z.string().min(1),
	args: z.record(z.string(), z.unknown()).default({}),
});

const DEFAULT_TIMEOUT_MS = 2 * 60_000;
// Rendering a long video in the browser can take a while, and the first
// transcription downloads the speech model.
const SLOW_TOOL_TIMEOUT_MS: Record<string, number> = {
	export_video: 60 * 60_000,
	transcribe: 30 * 60_000,
	generate_captions: 30 * 60_000,
	find_silences: 10 * 60_000,
	remove_silences: 10 * 60_000,
	view_frames: 5 * 60_000,
	add_transition: 5 * 60_000,
	create_motion_graphic: 30 * 60_000,
	preview_motion_graphic: 5 * 60_000,
	cutout_person: 60 * 60_000,
	follow_hand: 30 * 60_000,
	place_image: 10 * 60_000,
	explode_layers: 30 * 60_000,
	place_animation: 10 * 60_000,
	clean_voice: 30 * 60_000,
	find_beats: 5 * 60_000,
	generate_voiceover: 15 * 60_000,
	rank_pictures: 10 * 60_000,
	find_fillers: 30 * 60_000,
	remove_fillers: 30 * 60_000,
	polish_voice: 15 * 60_000,
	master_audio: 15 * 60_000,
	detect_scenes: 30 * 60_000,
	add_title: 10 * 60_000,
	add_3d_logo: 30 * 60_000,
	apply_look: 5 * 60_000,
	auto_reframe: 15 * 60_000,
	add_transition_effect: 10 * 60_000,
	punch_zoom: 5 * 60_000,
	duck_music: 10 * 60_000,
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

/** Remembers which downloaded picture a place_image clip shows (for credits). */
async function linkPlacedPicture(result: unknown) {
	const { mediaId, imageName } = (result ?? {}) as { mediaId?: string; imageName?: string };
	if (mediaId && imageName) await recordAlias({ mediaId, sourceName: imageName });
}

/** Adds the credits file next to an exported video. */
async function withCredits(result: unknown) {
	const { usedMedia, ...rest } = (result ?? {}) as {
		path?: string;
		usedMedia?: Array<{ id: string; name: string }>;
	};
	if (!rest.path || !usedMedia) return rest;
	const credits = await writeCreditsFile({ videoPath: rest.path, usedMedia }).catch(() => null);
	return credits
		? {
				...rest,
				creditsFile: credits.path,
				creditsNote: `${credits.count} downloaded picture(s)/sound(s) are listed with author and licence in this text file (nothing is written on the video). Tell the user it exists so they can paste the credits into the post caption if they want.`,
			}
		: rest;
}

/** CLIP scores above which a picture clearly / probably shows the description. */
const STRONG_MATCH = 0.27;
const POSSIBLE_MATCH = 0.24;

/**
 * Orders picture results by how well they show `match` (CLIP, run in the
 * editor window), best first, each with a verdict. Falls back to the
 * search order if the editor can't run the check.
 */
async function rankByMatch(
	found: Awaited<ReturnType<typeof searchFreeMedia>>,
	match: string,
	previews: boolean,
) {
	const withPictures = await withPreviews(found.results, found.results.length);
	const ranked = await dispatch({
		tool: "rank_pictures",
		args: { text: match, pictures: withPictures.map((item) => ("preview" in item ? item.preview : null)) },
		timeoutMs: 10 * 60_000,
	});
	const scores = ranked.ok ? ((ranked.result as { scores?: Array<number | null> }).scores ?? []) : [];
	if (!ranked.ok || scores.length !== withPictures.length) {
		return {
			...found,
			results: previews ? withPictures.slice(0, 8).concat(found.results.slice(8)) : found.results,
			matchNote: `The picture check could not run (${ranked.ok ? "no scores" : ranked.error}); results are in search order — look at the previews.`,
		};
	}
	const verdict = (score: number | null) =>
		score === null ? "unknown" : score >= STRONG_MATCH ? "strong" : score >= POSSIBLE_MATCH ? "possible" : "weak";
	const order = withPictures
		.map((item, index) => ({ item, score: scores[index] }))
		.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
	return {
		...found,
		results: order.map(({ item, score }, index) => {
			const { preview, ...rest } = item as typeof item & { preview?: unknown };
			return {
				...rest,
				match: verdict(score),
				matchScore: score === null ? null : Math.round(score * 1000) / 1000,
				...(previews && preview && index < 8 ? { preview } : {}),
			};
		}),
		matchNote: `Ordered by how well each picture shows "${match}" (AI image check, CLIP): "strong" clearly shows it, "possible" may, "weak" probably doesn't — don't use weak ones; search again with other words instead.`,
	};
}

/** Tools that run in this server process rather than the editor window. */
async function runServerTool(
	tool: string,
	args: Record<string, unknown>,
): Promise<{ handled: false } | { handled: true; result: unknown }> {
	switch (tool) {
		case "list_media_files": {
			const folders =
				typeof args.folder === "string" && args.folder
					? [args.folder]
					: defaultMediaFolders();
			return { handled: true, result: await Promise.all(folders.map(listMediaFolder)) };
		}
		case "search_free_media": {
			const found = await searchFreeMedia({
				query: str(args.query),
				type: str(args.type),
				limit: typeof args.limit === "number" ? args.limit : undefined,
				commercial: typeof args.commercialUse === "boolean" ? args.commercialUse : undefined,
			});
			rememberSearchResults(found.results);
			const match = str(args.match).trim();
			if (str(args.type) === "image" && match) {
				return { handled: true, result: await rankByMatch(found, match, args.previews !== false) };
			}
			// Pictures come with small previews so Claude can pick the right one.
			if (str(args.type) === "image" && args.previews !== false) {
				return { handled: true, result: { ...found, results: await withPreviews(found.results) } };
			}
			return { handled: true, result: found };
		}
		case "download_media": {
			const downloaded = await downloadMedia({
				url: str(args.url),
				fileName: str(args.fileName) || undefined,
			});
			await recordDownloadCredit({ url: str(args.url), path: downloaded.path });
			if (args.addToProject === false) return { handled: true, result: downloaded };
			// Import it into the open project, like add_media with the new path.
			const imported = await dispatch({
				tool: "add_media",
				args: { path: downloaded.path },
				timeoutMs: DEFAULT_TIMEOUT_MS,
			});
			return {
				handled: true,
				result: imported.ok
					? { ...downloaded, media: imported.result }
					: { ...downloaded, importError: imported.error },
			};
		}
		case "add_web_image": {
			// Download a picture from the web, import it, and place it over
			// the video in one go.
			const downloaded = await downloadMedia({
				url: str(args.url),
				fileName: str(args.fileName) || undefined,
			});
			await recordDownloadCredit({ url: str(args.url), path: downloaded.path });
			const imported = await dispatch({
				tool: "add_media",
				args: { path: downloaded.path },
				timeoutMs: DEFAULT_TIMEOUT_MS,
			});
			if (!imported.ok) throw new Error(`Downloaded to ${downloaded.path} but import failed: ${imported.error}`);
			const mediaId = (imported.result as { mediaId?: string }).mediaId;
			if (!mediaId) throw new Error("The downloaded file was not imported.");
			const { url: _url, fileName: _fileName, ...placement } = args;
			const placed = await dispatch({
				tool: "place_image",
				args: { ...placement, mediaId },
				timeoutMs: SLOW_TOOL_TIMEOUT_MS.place_image,
			});
			if (!placed.ok) throw new Error(`Imported as media ${mediaId} but placing failed: ${placed.error}`);
			await linkPlacedPicture(placed.result);
			return { handled: true, result: { downloadedTo: downloaded.path, ...(placed.result as object) } };
		}
		case "search_animations":
			return {
				handled: true,
				result: await searchAnimations({
					query: str(args.query),
					limit: typeof args.limit === "number" ? args.limit : undefined,
					previews: args.previews !== false,
				}),
			};
		case "add_animation": {
			const url = str(args.url);
			const animation = await fetchAnimation(url);
			const { url: _url, ...placement } = args;
			const placed = await dispatch({
				tool: "place_animation",
				args: { ...placement, animation },
				timeoutMs: SLOW_TOOL_TIMEOUT_MS.place_animation,
			});
			if (!placed.ok) throw new Error(placed.error ?? "Could not add the animation.");
			const mediaId = (placed.result as { mediaId?: string }).mediaId;
			const info = animationSeen(url);
			if (mediaId) {
				await recordRenderedCredit({
					mediaId,
					key: `LottieFiles ${url}`,
					credit: {
						title: info?.name ?? "Lottie animation",
						creator: info?.creator,
						license: LOTTIE_LICENSE,
						sourcePage: info?.sourcePage,
						url,
					},
				}).catch(() => {});
			}
			return { handled: true, result: placed.result };
		}
		case "apply_look": {
			// A .cube LUT from the user's disk is read here and sent as text.
			const lutPath = str(args.lutPath);
			if (!lutPath) return { handled: false };
			if (!/\.cube$/i.test(lutPath)) throw new Error("lutPath must be a .cube file.");
			const info = await stat(lutPath).catch(() => null);
			if (!info?.isFile()) throw new Error(`No file at ${lutPath}.`);
			if (info.size > 20 * 1024 * 1024) throw new Error("That .cube file is too big (20 MB max).");
			const { lutPath: _path, ...rest } = args;
			const applied = await dispatch({
				tool: "apply_look",
				args: { ...rest, lutText: await readFile(lutPath, "utf8") },
				timeoutMs: DEFAULT_TIMEOUT_MS,
			});
			if (!applied.ok) throw new Error(applied.error ?? "Could not apply the LUT.");
			return { handled: true, result: applied.result };
		}
		case "get_style_guide":
			return { handled: true, result: styleGuide(str(args.style) || "cinematico") };
		case "search_emoji":
			return { handled: true, result: searchEmoji({ query: str(args.query), limit: typeof args.limit === "number" ? args.limit : undefined }) };
		case "add_animated_emoji": {
			const found = await fetchEmojiAnimation(str(args.emoji));
			const { emoji: _emoji, ...placement } = args;
			const placed = await dispatch({
				tool: "place_animation",
				args: { widthPercent: 22, loop: true, duration: 2.5, name: `Emoji ${found.emoji}`, ...placement, animation: found.animation },
				timeoutMs: SLOW_TOOL_TIMEOUT_MS.place_animation,
			});
			if (!placed.ok) throw new Error(placed.error ?? "Could not add the emoji.");
			const mediaId = (placed.result as { mediaId?: string }).mediaId;
			if (mediaId) {
				await recordRenderedCredit({
					mediaId,
					key: "Noto Animated Emoji",
					credit: { title: "Emojis animados Noto", creator: "Google", license: EMOJI_LICENSE, sourcePage: EMOJI_SOURCE, url: EMOJI_SOURCE },
				}).catch(() => {});
			}
			return { handled: true, result: { emoji: found.emoji, name: found.name, ...(placed.result as object) } };
		}
		default:
			return { handled: false };
	}
}

export async function POST(request: NextRequest) {
	if (!isFromLocalProcess(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid command" }, { status: 400 });
	}

	const { tool, args } = parsed.data;

	// Disk and network access are the server's job; everything else runs in
	// the editor window so the user sees it happen.
	try {
		const server = await runServerTool(tool, args);
		if (server.handled) {
			return NextResponse.json({ id: "", ok: true, result: server.result });
		}
	} catch (error) {
		return NextResponse.json({
			id: "",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}

	const reply = await dispatch({
		tool,
		args,
		timeoutMs: SLOW_TOOL_TIMEOUT_MS[tool] ?? DEFAULT_TIMEOUT_MS,
	});
	if (reply.ok && tool === "place_image") await linkPlacedPicture(reply.result).catch(() => {});
	if (reply.ok && tool === "generate_voiceover") {
		const { mediaId, voice, license } = (reply.result ?? {}) as { mediaId?: string; voice?: string; license?: string };
		if (mediaId) {
			await recordRenderedCredit({
				mediaId,
				key: `Piper ${voice ?? "voz"}`,
				credit: {
					title: `Narração com voz de IA (Piper, voz pt_BR ${voice ?? ""})`.trim(),
					creator: "Piper (rhasspy / OHF-Voice)",
					license,
					sourcePage: "https://huggingface.co/rhasspy/piper-voices",
					url: "https://github.com/rhasspy/piper",
				},
			}).catch(() => {});
		}
	}
	if (reply.ok && tool === "export_video") {
		return NextResponse.json({ ...reply, result: await withCredits(reply.result) });
	}
	return NextResponse.json(reply);
}
