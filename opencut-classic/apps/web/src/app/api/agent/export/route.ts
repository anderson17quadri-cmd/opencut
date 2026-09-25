import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type NextRequest, NextResponse } from "next/server";
import { nextExportPath } from "@/agent/local-files";
import { isFromEditorWindow } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

// The editor renders the video in the browser; this writes the result to
// ~/Videos/OpenCut so Claude can tell the user where it is.
export async function POST(request: NextRequest) {
	if (!isFromEditorWindow(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	if (!request.body) {
		return NextResponse.json({ error: "Empty body" }, { status: 400 });
	}

	const params = request.nextUrl.searchParams;
	const extension = params.get("format") === "webm" ? "webm" : "mp4";
	const path = await nextExportPath({
		name: params.get("name") ?? "OpenCut export",
		extension,
	});

	await pipeline(
		Readable.fromWeb(
			request.body as unknown as import("node:stream/web").ReadableStream,
		),
		createWriteStream(path),
	);
	return NextResponse.json({ path });
}
