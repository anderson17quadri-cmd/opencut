# opencut-mcp

MCP (Model Context Protocol) server for the `opencut-classic` fork in this
repo. Lets Claude drive the timeline via `window.__editor` in a
Playwright-controlled browser — no manual clicking required.

## Why a fork instead of upstream

`opencut-classic` doesn't expose any editor internals by default. Two small,
dev-only patches in `../opencut-classic/apps/web/src/app/editor/[project_id]/page.tsx`
expose what this server needs:

1. `window.__editor` — the `EditorCore` singleton (timeline, media, command
   history, renderer).
2. `window.__opencut` — wasm time helpers (`mediaTimeFromSeconds`,
   `TICKS_PER_SECOND`, `mediaTime`, `roundMediaTime`), so tool code can convert
   seconds to the editor's internal `MediaTime` (integer ticks) without
   importing the wasm module directly.

Both are gated behind `process.env.NODE_ENV !== "production"`, so a
production build of the editor exposes nothing.

## Tools

| tool | description |
|------|-------------|
| `opencut_get_state` | Timeline snapshot (tracks, elements, assets). |
| `opencut_add_track` | Add a track. Prefer omitting `trackId` on `insert_clip` instead — empty tracks get pruned. |
| `opencut_add_media` | Upload a local file as a MediaAsset. |
| `opencut_insert_clip` | Add an element referencing a MediaAsset. `mode: "auto"` when `trackId` omitted. |
| `opencut_split_at` | Split element(s) at a time (seconds). |
| `opencut_move` / `opencut_trim` / `opencut_delete` | Direct pass-through to TimelineManager. |
| `opencut_undo` / `opencut_redo` | CommandManager history. |
| `opencut_export` | `RendererManager.exportProject`. |
| `opencut_screenshot` | Debug: screenshot the editor viewport. |

## Running

Points at the packaged Windows desktop app (`apps/desktop-tauri`) by
default, since that's what most people will actually have running.

```sh
# 1. Open the OpenCut desktop app (the installed .exe/.msi) — leave it running.

# 2. Install and run this MCP server (separate shell).
cd mcp-server
bun install
bunx tsx src/index.ts   # stdio transport, connects to 127.0.0.1:47821
```

Working against the dev server instead (`cd opencut-classic && bun run
dev:web`, port 3000)? Set `OPENCUT_BASE_URL=http://localhost:3000` first.

Env:
- `OPENCUT_BASE_URL` — default `http://127.0.0.1:47821` (the packaged app's port)
- `OPENCUT_HEADLESS` — `false` to see the browser (WSLg / X11 required) — n/a when pointed at the desktop app, which already has its own window
- `OPENCUT_VIDEO_DIR` — set to record a webm screencast of the browser

### Registering with Claude Code / Claude Desktop

Add an MCP server entry pointing at this package, e.g. in Claude Code:

```sh
claude mcp add opencut -- bunx tsx /absolute/path/to/mcp-server/src/index.ts
```

## Notes

1. **Empty tracks are pruned** on every command. Prefer `insert_clip` with
   `trackId` omitted (`placement: { mode: "auto" }`) — the command creates the
   track on demand and it survives because it has an element.
2. **MediaTime is integer ticks**, not seconds (`TICKS_PER_SECOND` is
   120,000 at runtime). Every tool that takes a time argument
   (`insert_clip`, `split_at`, `move`, `trim`) converts via
   `window.__opencut.mediaTimeFromSeconds` before crossing into the editor —
   don't pass raw seconds directly to editor APIs from new tool code.
3. **AudioElement is a discriminated union** — uploads must carry
   `sourceType: "upload"` in addition to `mediaId`.
4. **Editor page is `/editor/[project_id]`**, created via the `/projects` UI
   boot path this server uses.

MIT.
