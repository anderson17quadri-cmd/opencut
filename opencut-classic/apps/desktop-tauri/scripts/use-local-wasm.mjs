// Replaces the published opencut-wasm package in node_modules with the one
// built from rust/wasm (`bun run build:wasm`), so effect shaders added in
// this fork (colour grade, chroma key) are what the app actually runs.
// Run from the opencut-classic directory after `bun install` and the wasm build.
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join("rust", "wasm", "pkg");
if (!existsSync(join(pkgDir, "opencut_wasm_bg.wasm"))) {
	console.error(`No wasm build at ${pkgDir}. Run: bun run build:wasm`);
	process.exit(1);
}

const targets = [join("node_modules", "opencut-wasm")];
for (const workspace of ["apps"]) {
	for (const app of readdirSync(workspace)) {
		const nested = join(workspace, app, "node_modules", "opencut-wasm");
		if (existsSync(nested)) targets.push(nested);
	}
}

let replaced = 0;
for (const target of targets) {
	if (!existsSync(target) || !statSync(target).isDirectory()) continue;
	for (const file of readdirSync(pkgDir)) {
		if (file === ".gitignore") continue;
		cpSync(join(pkgDir, file), join(target, file));
	}
	replaced++;
	console.log(`opencut-wasm replaced in ${target}`);
}
if (replaced === 0) {
	console.error("opencut-wasm is not installed; run bun install first");
	process.exit(1);
}
