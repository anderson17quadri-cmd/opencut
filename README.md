# opencut (Claude fork)

Personal fork of [`opencut-app/opencut-classic`](https://github.com/opencut-app/opencut-classic)
(archived) with a native MCP server so Claude can drive the video editor
timeline directly, without a third-party project.

## Layout

- `opencut-classic/` — the editor itself. Same code as upstream, plus two
  small dev-only patches in
  `apps/web/src/app/editor/[project_id]/page.tsx` that expose
  `window.__editor` and `window.__opencut` for automation (see
  `mcp-server/README.md` for exactly what they expose and why).
- `mcp-server/` — the MCP server (`opencut-mcp`). 12 tools covering track/
  media/clip management, split/move/trim/delete, undo/redo, export, and a
  debug screenshot.

## Quick start

```sh
# terminal 1 — the editor
cd opencut-classic
bun install
bun run dev:web        # http://localhost:3000

# terminal 2 — the MCP server
cd mcp-server
bun install
bunx tsx src/index.ts
```

Then register `mcp-server` with Claude Code / Claude Desktop as an MCP
server (see `mcp-server/README.md`).

## Status

Personal PoC, not affiliated with the OpenCut project. The upstream OpenCut
rewrite (`opencut-app/opencut`) has a native MCP server on its own roadmap;
once that ships, this fork's exposure patches become unnecessary.

Both `opencut-classic/` and `mcp-server/` are MIT licensed.
