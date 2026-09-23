import { z } from "zod";
import { getOrCreateLocalSecret } from "./local-secret";

const webEnvSchema = z.object({
	// Node
	NODE_ENV: z.enum(["development", "production", "test"]),
	ANALYZE: z.string().optional(),
	NEXT_RUNTIME: z.enum(["nodejs", "edge"]).optional(),

	// Public
	NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
	NEXT_PUBLIC_MARBLE_API_URL: z.url().optional(),

	// Server — a filesystem path to the local SQLite database file, not a
	// connection string. Defaults to a data dir next to wherever the app runs.
	DATABASE_URL: z.string().default("./data/opencut.db"),

	// Auto-generated and persisted locally on first run if not set — see
	// local-secret.ts. There's no multi-tenant deployment here to leak a
	// shared secret across, so a per-install random secret is enough.
	BETTER_AUTH_SECRET: z.string().default(""),

	// Optional third-party integrations. The app runs fully offline without
	// them; features that need them (blog changelog, Freesound search)
	// degrade gracefully instead of failing to boot.
	MARBLE_WORKSPACE_KEY: z.string().optional(),
	FREESOUND_CLIENT_ID: z.string().optional(),
	FREESOUND_API_KEY: z.string().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

const parsed = webEnvSchema.parse(process.env);

export const webEnv: WebEnv = {
	...parsed,
	BETTER_AUTH_SECRET: parsed.BETTER_AUTH_SECRET || getOrCreateLocalSecret(),
};
