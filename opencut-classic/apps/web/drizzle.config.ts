import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

if (process.env.NODE_ENV === "production") {
	dotenv.config({ path: ".env.production" });
} else {
	dotenv.config({ path: ".env.local" });
}

const databaseUrl = process.env.DATABASE_URL ?? "./data/opencut.db";

export default {
	schema: "./src/db/schema.ts",
	dialect: "sqlite",
	migrations: {
		table: "drizzle_migrations",
	},
	dbCredentials: {
		url: databaseUrl,
	},
	out: "./migrations",
	strict: process.env.NODE_ENV === "production",
} satisfies Config;
