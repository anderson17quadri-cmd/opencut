import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { type NextRequest, NextResponse } from "next/server";
import { mediaMimeType } from "@/agent/local-files";
import { isFromEditorWindow } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

// Lets the editor window import a file from disk by path (the path comes from
// Claude via an add_media command) — a browser page can't open local files
// on its own.
export async function GET(request: NextRequest) {
	if (!isFromEditorWindow(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const path = request.nextUrl.searchParams.get("path") ?? "";
	if (!isAbsolute(path)) {
		return NextResponse.json({ error: "Path must be absolute" }, { status: 400 });
	}

	const mimeType = mediaMimeType(path);
	if (!mimeType) {
		return NextResponse.json(
			{ error: "Not a supported video, audio or image file" },
			{ status: 415 },
		);
	}

	let size: number;
	try {
		const info = await stat(path);
		if (!info.isFile()) throw new Error("not a file");
		size = info.size;
	} catch {
		return NextResponse.json({ error: `File not found: ${path}` }, { status: 404 });
	}

	const body = Readable.toWeb(
		createReadStream(path),
	) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, {
		headers: {
			"content-type": mimeType,
			"content-length": String(size),
			"x-file-name": encodeURIComponent(basename(path)),
		},
	});
}
