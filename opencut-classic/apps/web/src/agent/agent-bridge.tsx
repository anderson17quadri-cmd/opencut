"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { AgentCommand, AgentReply } from "./protocol";
import { runAgentTool } from "./tools";

/**
 * Keeps this window connected to the local server so the Claude Desktop
 * extension can drive it. Mounted in the root layout: it stays connected
 * across page changes, which open_project/create_project rely on.
 */
export function AgentBridge() {
	const router = useRouter();
	const routerRef = useRef(router);
	routerRef.current = router;

	useEffect(() => {
		const source = new EventSource("/api/agent/stream");
		// Commands run one at a time, in order, like a person clicking.
		let queue = Promise.resolve();

		source.onmessage = (event) => {
			const command = JSON.parse(event.data) as AgentCommand;
			queue = queue.then(async () => {
				let reply: AgentReply;
				try {
					const result = await runAgentTool({
						tool: command.tool,
						args: command.args,
						navigate: (path) => routerRef.current.push(path),
					});
					reply = { id: command.id, ok: true, result };
				} catch (error) {
					reply = {
						id: command.id,
						ok: false,
						error: error instanceof Error ? error.message : String(error),
					};
				}
				await fetch("/api/agent/results", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(reply),
				}).catch(() => {});
			});
		};

		return () => source.close();
	}, []);

	return null;
}
