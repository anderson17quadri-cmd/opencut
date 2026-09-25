// Messages exchanged between the local server (on behalf of the Claude
// Desktop extension) and the editor window that executes them.

export interface AgentCommand {
	id: string;
	tool: string;
	args: Record<string, unknown>;
}

export interface AgentReply {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}
