import { type NextRequest, NextResponse } from "next/server";
import { subscribe } from "@/agent/broker";
import { isFromEditorWindow } from "@/agent/request-guards";

export const dynamic = "force-dynamic";

// Server-sent events: the editor window listens here for commands to run.
export async function GET(request: NextRequest) {
	if (!isFromEditorWindow(request)) {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}

	const encoder = new TextEncoder();
	let cleanup = () => {};

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					cleanup();
				}
			};

			const unsubscribe = subscribe((command) => {
				send(`data: ${JSON.stringify(command)}\n\n`);
			});
			const heartbeat = setInterval(() => send(": ping\n\n"), 15_000);
			cleanup = () => {
				clearInterval(heartbeat);
				unsubscribe();
			};

			request.signal.addEventListener("abort", () => {
				cleanup();
				try {
					controller.close();
				} catch {}
			});

			send(": connected\n\n");
		},
		cancel() {
			cleanup();
		},
	});

	return new Response(stream, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		},
	});
}
