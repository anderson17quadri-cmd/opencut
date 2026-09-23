import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";
import { webEnv } from "@/env/web";

// Packaged desktop build: no separate "run migrations" step for the user to
// remember, no drizzle-kit in the shipped app. Bootstrap the schema inline
// with IF NOT EXISTS DDL on first connect instead — mirrors schema.ts
// exactly. During development, `bun run db:generate`/`db:push:local` still
// work against this same file for anyone iterating on the schema.
const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT NOT NULL UNIQUE,
	email_verified INTEGER NOT NULL DEFAULT 0,
	image TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	expires_at INTEGER NOT NULL,
	token TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	ip_address TEXT,
	user_agent TEXT,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL,
	provider_id TEXT NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	access_token TEXT,
	refresh_token TEXT,
	id_token TEXT,
	access_token_expires_at INTEGER,
	refresh_token_expires_at INTEGER,
	scope TEXT,
	password TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
	id TEXT PRIMARY KEY,
	message TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verifications (
	id TEXT PRIMARY KEY,
	identifier TEXT NOT NULL,
	value TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER,
	updated_at INTEGER
);
`;

let _db: ReturnType<typeof drizzle> | null = null;

function getDb() {
	if (!_db) {
		const dir = dirname(webEnv.DATABASE_URL);
		if (dir && dir !== "." && !existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		const sqlite = new Database(webEnv.DATABASE_URL);
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		sqlite.exec(BOOTSTRAP_SQL);
		_db = drizzle(sqlite, { schema });
	}

	return _db;
}

export const db = getDb();

export * from "./schema";
