# opencut (Claude fork)

Personal fork of [`opencut-app/opencut-classic`](https://github.com/opencut-app/opencut-classic)
(archived), packaged as a Windows app that Claude Desktop can drive: ask
Claude to edit a video and it happens live in the OpenCut window.

## Getting it (Windows)

Each build of `.github/workflows/desktop-windows.yml` produces an artifact
`opencut-windows-installer` containing:

- the OpenCut installer (`.exe` / `.msi`) — no Docker, Node or terminal needed;
- `opencut.mcpb` — the Claude Desktop extension. Double-click it (or drag it
  into Claude Desktop → Settings → Extensions).

Then, with OpenCut open, ask Claude to edit your videos. **[GUIA.md](GUIA.md)**
(Portuguese) explains every tool: what it does, when Claude uses it and an
example request.

From the build that includes the updater on, the installed app checks the
latest signed GitHub release when it opens and offers to update itself; the
Claude extension picks up new tools from the app, so it doesn't need to be
reinstalled.

## Layout

- `opencut-classic/` — the editor. Upstream code minus the Postgres/Redis/
  multi-tenant auth infra (local SQLite + a single local user instead).
  - `apps/web/src/agent/` + `apps/web/src/app/api/agent/` — the bridge:
    the local server receives commands from the Claude extension and hands
    them to the open editor window, which runs them against the editor core.
  - `rust/crates/effects/src/shaders/` — adds colour-grade and chroma-key
    shaders to the upstream effects engine; CI builds `rust/wasm` and swaps
    it in for the published `opencut-wasm` package
    (`apps/desktop-tauri/scripts/use-local-wasm.mjs`).
  - `apps/desktop-tauri/` — the Windows shell (Tauri + WebView2). Bundles a
    portable Node runtime and the Next.js standalone build, starts it on
    `127.0.0.1:47821` and opens a native window on it.
- `mcp-server/` — the Claude Desktop extension (`opencut.mcpb`), a thin MCP
  server that forwards tools to the bridge. See its README.

## Developing

```sh
cd opencut-classic
bun install --linker hoisted
bun run build:wasm && node apps/desktop-tauri/scripts/use-local-wasm.mjs
bun run dev:web                     # http://localhost:3000

cd ../mcp-server
npm ci && npm run pack              # builds opencut.mcpb
```

To point the extension at the dev server, set `OPENCUT_URL=http://localhost:3000`.

## Status

Personal project, not affiliated with the OpenCut team. MIT licensed.
