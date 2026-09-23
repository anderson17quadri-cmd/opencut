# opencut (Claude fork)

Personal fork of [`opencut-app/opencut-classic`](https://github.com/opencut-app/opencut-classic)
(archived) packaged as a normal Windows app, with a native MCP server so
Claude can drive the video editor timeline directly — no third-party
project, no Docker, no terminal for day-to-day use.

## Layout

- `opencut-classic/` — the editor itself. Same code as upstream, minus the
  Postgres/Redis/multi-tenant-auth infra (swapped for local SQLite + a
  single local user — see `opencut-classic/apps/web/src/db` and `src/auth`),
  plus the exposure of `window.__editor` / `window.__opencut` that
  `mcp-server` needs (see its README for exactly what and why).
- `apps/desktop-tauri/` (inside `opencut-classic/`) — the Windows desktop
  shell (Tauri). Bundles a portable Node runtime + the editor's Next.js
  standalone build; on launch it starts that server in the background,
  waits for it, then opens a native WebView2 window pointed at it. This is
  what gets built into the installer — see its README for the full
  architecture.
- `mcp-server/` — the MCP server (`opencut-mcp`). 12 tools covering track/
  media/clip management, split/move/trim/delete, undo/redo, export, and a
  debug screenshot. Points at the desktop app's local port by default.
- `.github/workflows/desktop-windows.yml` — builds the `.msi`/`.exe`
  installer on `windows-latest` and publishes it to GitHub Releases. This
  environment has no Windows/Rust toolchain to build or test that installer
  locally, so CI is also the first real verification of the whole desktop
  packaging — check the Actions tab for the latest run.

## Getting the app (Windows)

Download the latest installer from this repo's
[Releases](../../releases) page (built by the workflow above) and run it —
no Docker, no Bun, no terminal required. It installs like any other
Windows app and opens straight into the editor.

## Developing

```sh
# the editor, in dev mode
cd opencut-classic
bun install
bun run dev:web        # http://localhost:3000

# the MCP server, separately
cd mcp-server
bun install
OPENCUT_BASE_URL=http://localhost:3000 bunx tsx src/index.ts
```

Then register `mcp-server` with Claude Code / Claude Desktop as an MCP
server (see `mcp-server/README.md`). Once the desktop app is installed,
`mcp-server` points at it by default (`127.0.0.1:47821`) — no
`OPENCUT_BASE_URL` override needed.

To build the Windows installer yourself instead of waiting on CI, see
`opencut-classic/apps/desktop-tauri/README.md`.

## Status

Personal PoC, not affiliated with the OpenCut project. The upstream OpenCut
rewrite (`opencut-app/opencut`) has a native MCP server on its own roadmap;
once that ships, this fork's exposure patches become unnecessary. The
desktop packaging is new and has only been exercised in CI so far — if the
installer build fails or the app doesn't boot cleanly on your machine,
that's expected first-round friction, not a dead end.

Both `opencut-classic/` and `mcp-server/` are MIT licensed.
