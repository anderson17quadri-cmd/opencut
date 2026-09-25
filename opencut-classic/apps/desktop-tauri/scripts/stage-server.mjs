// Copies the Next.js standalone build into src-tauri/resources/server as
// plain files. Symlinks are resolved into real copies: the installer can't
// carry them, and Turbopack links native externals (better-sqlite3) into
// .next/node_modules via one.
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "web");
const standalone = join(web, ".next", "standalone");
const dest = join(here, "..", "src-tauri", "resources", "server");
const appDir = join(dest, "apps", "web");

// fs.cpSync's `dereference` only applies to the top-level source, not to
// symlinks nested inside it, so walk the tree ourselves. statSync follows
// links, so every entry lands as a real file or directory.
function copyResolved(src, dst) {
	if (statSync(src).isDirectory()) {
		mkdirSync(dst, { recursive: true });
		for (const name of readdirSync(src)) {
			copyResolved(join(src, name), join(dst, name));
		}
	} else {
		copyFileSync(src, dst);
	}
}

if (!existsSync(join(standalone, "apps", "web", "server.js"))) {
	throw new Error(`no standalone build at ${standalone} — run the web build first`);
}

rmSync(dest, { recursive: true, force: true });
copyResolved(standalone, dest);

// output: "standalone" leaves static assets and public/ out.
copyResolved(join(web, ".next", "static"), join(appDir, ".next", "static"));
if (existsSync(join(web, "public"))) {
	copyResolved(join(web, "public"), join(appDir, "public"));
}

// Collecting page data at build time opens the default ./data/opencut.db;
// don't ship that — the app uses a per-user DB under %APPDATA%.
rmSync(join(appDir, "data"), { recursive: true, force: true });

console.log(`staged server at ${dest}`);
