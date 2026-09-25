import type { NextRequest } from "next/server";

// The server listens on 127.0.0.1, but any web page the user opens can still
// send requests to localhost. Browsers mark every request with Origin /
// Sec-Fetch-Site; the MCP extension (a plain Node process) sends neither.

/** For endpoints only the Claude Desktop extension should call. */
export function isFromLocalProcess(request: NextRequest): boolean {
	return (
		!request.headers.has("origin") && !request.headers.has("sec-fetch-site")
	);
}

/** For endpoints only the OpenCut window itself should call. */
export function isFromEditorWindow(request: NextRequest): boolean {
	return request.headers.get("sec-fetch-site") === "same-origin";
}
