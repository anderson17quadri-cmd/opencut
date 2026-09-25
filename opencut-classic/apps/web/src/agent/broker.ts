import type { AgentCommand, AgentReply } from "./protocol";

type Subscriber = (command: AgentCommand) => void;

interface Broker {
	subscribers: Subscriber[];
	pending: Map<string, (reply: AgentReply) => void>;
	onSubscribe: Set<() => void>;
}

// Route handlers can end up in separate bundles, so module-level state
// isn't guaranteed to be shared between them. One broker per process.
const holder = globalThis as { __opencutAgentBroker?: Broker };

function getBroker(): Broker {
	holder.__opencutAgentBroker ??= {
		subscribers: [],
		pending: new Map(),
		onSubscribe: new Set(),
	};
	return holder.__opencutAgentBroker;
}

export function subscribe(subscriber: Subscriber): () => void {
	const broker = getBroker();
	broker.subscribers.push(subscriber);
	for (const wake of broker.onSubscribe) wake();
	return () => {
		broker.subscribers = broker.subscribers.filter((s) => s !== subscriber);
	};
}

// A window that just navigated reconnects within a second or two, so give
// it a moment instead of failing the command outright.
async function waitForWindow(timeoutMs: number): Promise<Subscriber | null> {
	const broker = getBroker();
	const latest = () => broker.subscribers.at(-1) ?? null;
	if (latest()) return latest();

	await new Promise<void>((resolve) => {
		const wake = () => {
			clearTimeout(timer);
			broker.onSubscribe.delete(wake);
			resolve();
		};
		const timer = setTimeout(wake, timeoutMs);
		broker.onSubscribe.add(wake);
	});
	return latest();
}

export async function dispatch({
	tool,
	args,
	timeoutMs,
}: {
	tool: string;
	args: Record<string, unknown>;
	timeoutMs: number;
}): Promise<AgentReply> {
	const target = await waitForWindow(15_000);
	if (!target) {
		return {
			id: "",
			ok: false,
			error: "OpenCut is not open. Ask the user to open the OpenCut app.",
		};
	}

	const broker = getBroker();
	const id = crypto.randomUUID();
	return new Promise((resolve) => {
		const finish = (reply: AgentReply) => {
			clearTimeout(timer);
			broker.pending.delete(id);
			resolve(reply);
		};
		const timer = setTimeout(
			() =>
				finish({
					id,
					ok: false,
					error: `OpenCut did not answer within ${Math.round(timeoutMs / 1000)}s.`,
				}),
			timeoutMs,
		);
		broker.pending.set(id, finish);
		target({ id, tool, args });
	});
}

export function settle(reply: AgentReply): boolean {
	const finish = getBroker().pending.get(reply.id);
	if (!finish) return false;
	finish(reply);
	return true;
}
