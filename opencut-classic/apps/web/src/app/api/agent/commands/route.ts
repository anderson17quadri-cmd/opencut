import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/agent/broker";
import { defaultMediaFolders, listMediaFolder } from "@/agent/local-files";
import { isFromLocalProcess } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
	tool: z.string().min(1),
	args: z.record(z.string(), z.unknown()).default({}),
});

const DEFAULT_TIMEOUT_MS = 2 * 60_000;
// Rendering a long video in the browser can take a while.
const EXPORT_TIMEOUT_MS = 60 * 60_000;

export async function POST(request: NextRequest) {
	if (!isFromLocalProcess(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return NextResponse.json({ error: "Invalid command" }, { status: 400 });
	}

	const { tool, args } = parsed.data;

	// Browsing the disk is the server's job; everything else runs in the
	// editor window so the user sees it happen.
	if (tool === "list_media_files") {
		try {
			const folders =
				typeof args.folder === "string" && args.folder
					? [args.folder]
					: defaultMediaFolders();
			const result = await Promise.all(folders.map(listMediaFolder));
			return NextResponse.json({ id: "", ok: true, result });
		} catch (error) {
			return NextResponse.json({
				id: "",
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const reply = await dispatch({
		tool,
		args,
		timeoutMs: tool === "export_video" ? EXPORT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS,
	});
	return NextResponse.json(reply);
}
