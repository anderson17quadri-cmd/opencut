import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/agent/broker";
import { downloadMedia, searchFreeMedia } from "@/agent/downloads";
import { defaultMediaFolders, listMediaFolder } from "@/agent/local-files";
import { isFromLocalProcess } from "@/agent/request-guards";

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
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

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
		case "search_free_media":
			return {
				handled: true,
				result: await searchFreeMedia({
					query: str(args.query),
					type: str(args.type),
					limit: typeof args.limit === "number" ? args.limit : undefined,
					commercial: typeof args.commercialUse === "boolean" ? args.commercialUse : undefined,
				}),
			};
		case "download_media": {
			const downloaded = await downloadMedia({
				url: str(args.url),
				fileName: str(args.fileName) || undefined,
			});
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
	return NextResponse.json(reply);
}
