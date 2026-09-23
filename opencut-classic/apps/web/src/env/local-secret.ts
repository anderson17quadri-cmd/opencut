import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

// better-auth needs a stable secret to sign sessions/cookies — stable across
// restarts, or every restart invalidates all sessions. For a local desktop
// install there's no secret manager to reach for, so generate one on first
// run and persist it next to the SQLite db (same directory, so it moves with
// the user's data if they relocate it).
export function getOrCreateLocalSecret(): string {
	const dbPath = process.env.DATABASE_URL ?? "./data/opencut.db";
	const dir = dirname(dbPath);
	const secretPath = join(dir, ".auth-secret");

	if (existsSync(secretPath)) {
		return readFileSync(secretPath, "utf8").trim();
	}

	if (dir && dir !== "." && !existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const secret = randomBytes(32).toString("hex");
	writeFileSync(secretPath, secret, { mode: 0o600 });
	return secret;
}
