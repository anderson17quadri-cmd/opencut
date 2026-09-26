import { toast } from "sonner";
import { AddTrackCommand, InsertElementCommand } from "@/commands";
import type { TimelineElement } from "@/timeline";
import { type MediaTime, mediaTimeToSeconds } from "@/wasm";
import { frameRateToFloat } from "@/fps/utils";
import { buildElementFromMedia } from "@/timeline/element-utils";
import { encodeAlphaVideo } from "./alpha-video";
import {
	type Args,
	allTracks,
	asOneStep,
	CUTOUT_SUFFIX,
	editor,
	findElement,
	graphicsInsertIndex,
	fromSeconds,
	importMediaFile,
	optNum,
	requireOpenProject,
	str,
	toSeconds,
} from "./helpers";
import { ICON_ID_PATTERN, iconSvgUrl } from "./icons";
import { type ImageAnimation, type ImageStyle, imagePlacementCode } from "./image-placement";
import { ANCHORS } from "./layout";
import { SOUND_LEAD, type SoundEffect, soundEffectFile, soundEffectFileName } from "./sound-effects";
import { cutoutPerson } from "./vision";
import {
	type MotionGraphicSpec,
	type MotionMode,
	MotionGraphicSandbox,
} from "./motion-graphics";

// Tools that generate new footage in the editor window: motion graphics
// from code (and, later, AI cutouts). Results are transparent WebM clips
// imported into the project and placed on their own layer.

const MAX_DURATION_SECONDS = 120;

/** A progress notice in the editor while Claude renders something long. */
function progressToast(label: string) {
	const id = `agent-${label}-${Date.now()}`;
	let lastShown = -1;
	toast.loading(`${label}…`, { id });
	return {
		update(fraction: number) {
			const percent = Math.floor(fraction * 100);
			if (percent === lastShown) return;
			lastShown = percent;
			toast.loading(`${label}… ${percent}%`, { id });
		},
		done(message: string) {
			toast.success(message, { id });
		},
		fail() {
			toast.dismiss(id);
		},
	};
}

async function loadImage(url: string): Promise<ImageBitmap> {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Could not load image ${url}`);
	const blob = await response.blob();
	if (blob.type.includes("svg")) {
		// createImageBitmap can't decode SVG blobs directly.
		const objectUrl = URL.createObjectURL(blob);
		try {
			const image = new Image();
			image.src = objectUrl;
			await image.decode();
			return await createImageBitmap(image);
		} finally {
			URL.revokeObjectURL(objectUrl);
		}
	}
	return createImageBitmap(blob);
}

/** Resolves {name: "icon:mdi:heart~ff0000" | "media:<mediaId>"} to bitmaps. */
async function resolveImages(raw: unknown): Promise<Record<string, ImageBitmap>> {
	if (raw === undefined || raw === null) return {};
	if (typeof raw !== "object" || Array.isArray(raw)) {
		throw new Error('"images" must map names to "icon:<iconId>" or "media:<mediaId>"');
	}
	const images: Record<string, ImageBitmap> = {};
	for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
		const ref = String(value);
		if (ref.startsWith("icon:")) {
			const [iconId] = ref.slice(5).toLowerCase().split("~");
			if (!ICON_ID_PATTERN.test(iconId)) throw new Error(`Bad icon id in images.${name}`);
			images[name] = await loadImage(iconSvgUrl({ value: ref.slice(5).toLowerCase() }));
		} else if (ref.startsWith("media:")) {
			const asset = editor()
				.media.getAssets()
				.find((candidate) => candidate.id === ref.slice(6));
			if (!asset) throw new Error(`No media ${ref.slice(6)} for images.${name}`);
			if (asset.type !== "image") throw new Error(`images.${name} must be an image`);
			images[name] = await createImageBitmap(asset.file);
		} else {
			throw new Error(`images.${name} must be "icon:<iconId>" or "media:<mediaId>"`);
		}
	}
	return images;
}

async function buildSpec(args: Args): Promise<MotionGraphicSpec> {
	const project = requireOpenProject();
	const mode = (args.mode === "three" ? "three" : "2d") as MotionMode;
	const duration = Math.min(Math.max(optNum(args, "duration") ?? 5, 0.1), MAX_DURATION_SECONDS);
	const canvas = project.settings.canvasSize;
	const fps = Math.min(Math.max(Math.round(optNum(args, "fps") ?? frameRateToFloat(project.settings.fps)), 1), 60);
	const fonts = Array.isArray(args.fonts)
		? args.fonts.map(String).filter((font) => /^[\w\s-]{1,60}$/.test(font))
		: [];
	return {
		code: str(args, "code"),
		mode,
		width: Math.round(optNum(args, "width") ?? canvas.width),
		height: Math.round(optNum(args, "height") ?? canvas.height),
		fps,
		duration,
		fonts,
		images: await resolveImages(args.images),
	};
}

async function previewMotionGraphic(args: Args) {
	const spec = await buildSpec(args);
	const times = Array.isArray(args.times)
		? args.times.map(Number).filter((t) => Number.isFinite(t)).slice(0, 8)
		: [0, spec.duration / 2, Math.max(0, spec.duration - 1 / spec.fps)];
	const maxWidth = 768;
	const sandbox = await MotionGraphicSandbox.start(spec);
	try {
		const frames = [];
		for (const [i, time] of times.entries()) {
			const bitmap = await sandbox.renderFrame(i, Math.min(Math.max(time, 0), spec.duration));
			const scale = Math.min(1, maxWidth / bitmap.width);
			const out = document.createElement("canvas");
			out.width = Math.round(bitmap.width * scale);
			out.height = Math.round(bitmap.height * scale);
			const ctx = out.getContext("2d");
			if (ctx) {
				// Checkerboard so transparency is visible.
				const size = 16;
				for (let y = 0; y < out.height; y += size) {
					for (let x = 0; x < out.width; x += size) {
						ctx.fillStyle = (x / size + y / size) % 2 === 0 ? "#3a3a3a" : "#2a2a2a";
						ctx.fillRect(x, y, size, size);
					}
				}
				ctx.drawImage(bitmap, 0, 0, out.width, out.height);
			}
			bitmap.close();
			frames.push({ time, image: out.toDataURL("image/jpeg", 0.85).split(",")[1] });
		}
		return { frames };
	} finally {
		sandbox.dispose();
	}
}

async function createMotionGraphic(args: Args) {
	const spec = await buildSpec(args);
	const name = (typeof args.name === "string" && args.name.trim()) || "Motion graphic";
	const start = Math.max(0, optNum(args, "start") ?? toSeconds(editor().playback.getCurrentTime()));
	return renderMotionGraphicClip({ spec, name, start });
}

/** Renders a motion graphic to a transparent clip on a new graphics layer. */
export async function renderMotionGraphicClip({
	spec,
	name,
	start,
	trackIndex,
}: {
	spec: MotionGraphicSpec;
	name: string;
	start: number;
	/** Layer position; default: top, but under any person cutout. */
	trackIndex?: number;
}) {
	const frameCount = Math.max(1, Math.round(spec.duration * spec.fps));
	const progress = progressToast(`Claude está criando "${name}"`);
	const sandbox = await MotionGraphicSandbox.start(spec).catch((error) => {
		progress.fail();
		throw error;
	});
	let file: File;
	try {
		file = await encodeAlphaVideo({
			width: spec.width,
			height: spec.height,
			fps: spec.fps,
			frameCount,
			name: name.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "motion",
			drawFrame: async ({ ctx, index, time }) => {
				const bitmap = await sandbox.renderFrame(index, time);
				ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height);
				bitmap.close();
				progress.update(index / frameCount);
			},
		});
		progress.done(`"${name}" pronto`);
	} catch (error) {
		progress.fail();
		throw error;
	} finally {
		sandbox.dispose();
	}

	const media = await importMediaFile(file);
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === media.mediaId);
	if (!asset) throw new Error("The rendered graphic could not be imported.");

	const clip = await asOneStep(() => {
		// Its own layer on top, but under any person cutout, so a cutout
		// keeps the presenter in front of it.
		const addTrack = new AddTrackCommand({
			type: "video",
			index: trackIndex ?? graphicsInsertIndex(),
		});
		addTrack.execute();
		const trackId = addTrack.getTrackId();
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({
			element: buildElementFromMedia({
				mediaId: asset.id,
				mediaType: asset.type,
				name,
				duration: fromSeconds(spec.duration),
				startTime: fromSeconds(start),
			}),
			placement: { mode: "explicit", trackId },
		}).execute();
		const track = allTracks().find((t) => t.id === trackId);
		const inserted = track?.elements.find((e) => !before.has(e.id));
		if (!inserted) throw new Error("The editor rejected the graphic clip.");
		return { trackId, clipId: inserted.id };
	});

	return {
		...clip,
		mediaId: media.mediaId,
		start,
		end: start + spec.duration,
		frames: frameCount,
		size: `${spec.width}x${spec.height}`,
		note: "Check it with view_frames. To change it, delete_clips this clip and create it again with new code.",
	};
}

async function cutoutPersonTool(args: Args) {
	requireOpenProject();
	const { track, element } = findElement(str(args, "clipId"));
	if (element.type !== "video") throw new Error("cutout_person works on video clips.");
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === element.mediaId);
	if (!asset) throw new Error("The clip's media is missing.");

	const rate = element.retime?.rate ?? 1;
	const sourceStart = mediaTimeToSeconds({ time: element.trimStart });
	const clipSeconds = toSeconds(element.duration);
	const sourceEnd = sourceStart + clipSeconds * rate;

	const progress = progressToast("Recortando a pessoa com IA");
	let file: File;
	try {
		file = await cutoutPerson({
			file: asset.file,
			start: sourceStart,
			end: sourceEnd,
			quality: args.quality === "fast" || args.quality === "best" ? args.quality : "auto",
			onProgress: (fraction) => progress.update(fraction),
		});
		progress.done("Recorte pronto");
	} catch (error) {
		progress.fail();
		throw error;
	}
	const media = await importMediaFile(file);
	const cutoutAsset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === media.mediaId);
	if (!cutoutAsset) throw new Error("The cutout could not be imported.");

	// A copy of the clip that shows only the person, on the top layer, with
	// the same timing, speed, position, animations and effects, so it lines
	// up exactly with the original underneath.
	const result = await asOneStep(() => {
		const addTrack = new AddTrackCommand({ type: "video", index: 0 });
		addTrack.execute();
		const trackId = addTrack.getTrackId();
		const base = buildElementFromMedia({
			mediaId: cutoutAsset.id,
			mediaType: cutoutAsset.type,
			name: `${element.name} ${CUTOUT_SUFFIX}`,
			duration: element.duration,
			startTime: element.startTime,
		});
		const copy = {
			...base,
			params: { ...element.params, muted: true },
			animations: element.animations,
			retime: element.retime,
			effects: element.effects,
			trimStart: 0 as MediaTime,
			trimEnd: 0 as MediaTime,
		} as typeof base;
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({ element: copy, placement: { mode: "explicit", trackId } }).execute();
		const inserted = allTracks()
			.find((t) => t.id === trackId)
			?.elements.find((e: TimelineElement) => !before.has(e.id));
		if (!inserted) throw new Error("The editor rejected the cutout clip.");
		return { trackId, clipId: inserted.id };
	});

	return {
		...result,
		mediaId: media.mediaId,
		originalClipId: element.id,
		originalTrackId: track.id,
		note: "The person now sits on the top layer. Graphics on layers between the original clip and this one appear behind the person. If you move or trim the original later, run cutout_person again.",
	};
}

const IMAGE_STYLES: ImageStyle[] = ["card", "plain", "fullscreen"];
const IMAGE_ANIMATIONS: ImageAnimation[] = ["pop", "fade", "slide", "zoom", "none"];
const MAX_IMAGE_SIDE = 2400;

/** Puts an imported picture over the video, animated in and out. */
async function placeImage(args: Args) {
	const project = requireOpenProject();
	const mediaId = str(args, "mediaId");
	const asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.id === mediaId);
	if (!asset) throw new Error(`No media ${mediaId}. Use list_media or download_media first.`);
	if (asset.type !== "image") throw new Error("place_image needs an image (use add_to_timeline for video).");

	const style = (IMAGE_STYLES.includes(args.style as ImageStyle) ? args.style : "card") as ImageStyle;
	const animation = (
		IMAGE_ANIMATIONS.includes(args.animation as ImageAnimation) ? args.animation : style === "fullscreen" ? "fade" : "pop"
	) as ImageAnimation;
	const anchor = typeof args.anchor === "string" && (ANCHORS as readonly string[]).includes(args.anchor) ? args.anchor : "center";
	const canvas = project.settings.canvasSize;
	const portrait = canvas.height > canvas.width;
	const widthPercent = optNum(args, "widthPercent") ?? (portrait ? 70 : 40);
	const percent = (key: string) => {
		const value = optNum(args, key);
		return value === undefined ? null : Math.min(Math.max(value, 0), 100) / 100;
	};
	const duration = Math.min(Math.max(optNum(args, "duration") ?? 3, 0.5), 30);
	const start = Math.max(0, optNum(args, "start") ?? toSeconds(editor().playback.getCurrentTime()));
	const label = typeof args.label === "string" && args.label.trim() ? args.label.trim().slice(0, 80) : null;
	const labelFont = typeof args.font === "string" && /^[\w\s-]{1,60}$/.test(args.font) ? args.font : "Montserrat";

	let bitmap = await createImageBitmap(asset.file);
	const longest = Math.max(bitmap.width, bitmap.height);
	if (longest > MAX_IMAGE_SIDE) {
		const scale = MAX_IMAGE_SIDE / longest;
		const resized = await createImageBitmap(bitmap, {
			resizeWidth: Math.round(bitmap.width * scale),
			resizeHeight: Math.round(bitmap.height * scale),
			resizeQuality: "high",
		});
		bitmap.close();
		bitmap = resized;
	}

	const spec: MotionGraphicSpec = {
		code: imagePlacementCode({
			style,
			animation,
			anchor,
			width: Math.min(Math.max(widthPercent, 5), 100) / 100,
			x: percent("x"),
			y: percent("y"),
			tilt: optNum(args, "tilt") ?? 0,
			label,
			labelFont,
			credit: typeof args.credit === "string" && args.credit.trim() ? args.credit.trim().slice(0, 90) : null,
			kenBurns: args.kenBurns !== false,
		}),
		mode: "2d",
		width: canvas.width,
		height: canvas.height,
		fps: Math.min(Math.max(Math.round(frameRateToFloat(project.settings.fps)), 1), 60),
		duration,
		fonts: label ? [labelFont] : [],
		images: { img: bitmap },
	};
	const behindPerson = args.behindPerson === true;
	const result = await renderMotionGraphicClip({
		spec,
		name: `Imagem: ${label ?? asset.name}`.slice(0, 80),
		start,
		trackIndex: behindPerson ? undefined : 0,
	});
	const sound = await addSoundEffect({ effect: args.sound, at: start });
	return {
		...result,
		...(sound ? { soundClipId: sound.clipId } : {}),
		imageMediaId: asset.id,
		style,
		animation,
		note: "Check it with view_frames. To change it, delete_clips this clip and call place_image again.",
	};
}

const SOUND_EFFECTS: SoundEffect[] = ["pop", "whoosh", "swoosh_down"];

/** Puts a synthesized pop/whoosh on an audio layer, timed to `at`. */
async function addSoundEffect({ effect, at }: { effect: unknown; at: number }) {
	if (!SOUND_EFFECTS.includes(effect as SoundEffect)) return null;
	const kind = effect as SoundEffect;
	// One copy per project, reused by every picture.
	let asset = editor()
		.media.getAssets()
		.find((candidate) => candidate.type === "audio" && candidate.name === soundEffectFileName(kind));
	if (!asset) {
		const media = await importMediaFile(await soundEffectFile(kind));
		asset = editor()
			.media.getAssets()
			.find((candidate) => candidate.id === media.mediaId);
	}
	if (!asset) return null;
	const found = asset;
	return asOneStep(() => {
		const before = new Set(allTracks().flatMap((t) => t.elements.map((e) => e.id)));
		new InsertElementCommand({
			element: buildElementFromMedia({
				mediaId: found.id,
				mediaType: found.type,
				name: found.name,
				duration: fromSeconds(found.duration ?? 0.5),
				startTime: fromSeconds(Math.max(0, at - SOUND_LEAD[kind])),
			}),
			placement: { mode: "auto", trackType: "audio" },
		}).execute();
		for (const track of allTracks()) {
			const inserted = track.elements.find((e: TimelineElement) => !before.has(e.id));
			if (inserted) return { clipId: inserted.id };
		}
		return null;
	});
}

export async function runGraphicsTool({
	tool,
	args,
}: {
	tool: string;
	args: Args;
}): Promise<unknown> {
	switch (tool) {
		case "preview_motion_graphic":
			return previewMotionGraphic(args);
		case "create_motion_graphic":
			return createMotionGraphic(args);
		case "cutout_person":
			return cutoutPersonTool(args);
		case "place_image":
			return placeImage(args);
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

