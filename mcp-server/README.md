# OpenCut for Claude Desktop

A Claude Desktop extension (`opencut.mcpb`) that lets Claude edit videos in
the OpenCut app. Changes happen live in the OpenCut window and go through its
normal undo history.

## Install

1. Install and open OpenCut.
2. Double-click `opencut.mcpb` (it ships next to the installer in each build),
   or in Claude Desktop go to **Settings → Extensions** and drag it in.
3. Ask Claude something like "cut the first 5 seconds of ferias.mp4 from my
   Downloads and add the title 'Férias 2026'".

OpenCut has to be open while Claude works.

## How it works

The extension is a small stdio MCP server. Each tool is a POST to
`http://127.0.0.1:47821/api/agent/commands` on the OpenCut app, which hands
it to the open window (see `opencut-classic/apps/web/src/agent`). Nothing
leaves the computer.

Tools: `get_state`, `list_media_files`, `list_projects`, `create_project`,
`open_project`, `add_media`, `add_to_timeline`, `add_text`, `split_clip`,
`delete_clips`, `move_clip`, `set_speed`, `set_volume`, `seek`, `undo`,
`redo`, `export_video` (saves to `Videos\OpenCut`).

## Building

```sh
npm ci
npm run pack      # bundles src/ into extension/server and writes opencut.mcpb
```

Set `OPENCUT_URL` to point at a dev server instead (e.g. `http://localhost:3000`).

MIT.
