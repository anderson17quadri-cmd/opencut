import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { webEnv } from "@/env/web";

// Local desktop app: one process, one user, no distributed rate-limit
// storage to reach for — better-auth's default in-memory rate limiter is
// exactly right here (see auth/rate-limit.ts for the same reasoning applied
// to the app's own API routes).
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "sqlite",
		usePlural: true,
	}),
	secret: webEnv.BETTER_AUTH_SECRET,
	user: {
		deleteUser: {
			enabled: true,
		},
	},
	emailAndPassword: {
		enabled: true,
	},
	baseURL: webEnv.NEXT_PUBLIC_SITE_URL,
	appName: "OpenCut",
	trustedOrigins: [webEnv.NEXT_PUBLIC_SITE_URL],
});

export type Auth = typeof auth;
