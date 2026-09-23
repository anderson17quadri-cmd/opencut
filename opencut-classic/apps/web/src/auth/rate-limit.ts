// In-memory sliding-window limiter. The Upstash/Redis-backed version this
// replaced was built for a multi-instance server deployment; a local
// single-user desktop app has exactly one process and no need to coordinate
// rate-limit state across machines, so a plain in-memory map is enough.
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 100;

const hits = new Map<string, number[]>();

// Periodically drop keys with no requests in the current window so this
// map doesn't grow unbounded over a long-running session.
setInterval(
	() => {
		const cutoff = Date.now() - WINDOW_MS;
		for (const [key, timestamps] of hits) {
			const kept = timestamps.filter((t) => t > cutoff);
			if (kept.length === 0) hits.delete(key);
			else hits.set(key, kept);
		}
	},
	5 * 60_000,
).unref?.();

export const baseRateLimit = {
	async limit(key: string) {
		const now = Date.now();
		const cutoff = now - WINDOW_MS;
		const timestamps = (hits.get(key) ?? []).filter((t) => t > cutoff);
		const success = timestamps.length < MAX_REQUESTS;
		if (success) {
			timestamps.push(now);
			hits.set(key, timestamps);
		}
		return { success };
	},
};

export async function checkRateLimit({ request }: { request: Request }) {
	const ip = request.headers.get("x-forwarded-for") ?? "anonymous";
	const { success } = await baseRateLimit.limit(ip);
	return { success, limited: !success };
}
