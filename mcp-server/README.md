# OpenCut for Claude Desktop

A Claude Desktop extension (`opencut.mcpb`) that lets Claude edit videos in
the OpenCut app. Changes happen live in the OpenCut window and go through its
normal undo history.

## Install

1. Install and open OpenCut.
2. Double-click `opencut.mcpb` (it ships next to the installer in each build),
   or in Claude Desktop go to **Settings → Extensions** and drag it in.
3. Ask Claude something like "turn ferias.mp4 from my Downloads into a
   Reels video with captions, a title and a fire emoji, and cut the pauses".

OpenCut has to be open while Claude works.

## How it works

The extension is a small stdio MCP server. Each tool is a POST to
`http://127.0.0.1:47821/api/agent/commands` on the OpenCut app, which hands
it to the open window (see `opencut-classic/apps/web/src/agent`). Nothing
leaves the computer.

Tools (40), roughly what a professional editor does:

- **Project**: `get_state`, `list_projects`, `create_project`, `open_project`,
  `set_project` (9:16 / 16:9 / 1:1 / 4:5…, fps, colour or blurred background).
- **Media**: `list_media_files`, `add_media`, `add_to_timeline`.
- **Cutting**: `split_clip`, `trim_clip`, `delete_clips`, `move_clip`,
  `duplicate_clip`, `cut_range` (ripple delete across all tracks),
  `find_silences` / `remove_silences` (jump cuts).
- **Look at the result**: `view_frames` returns rendered frames as images.
- **Text and captions**: `add_text`, `transcribe`, `generate_captions`
  (on-device Whisper), `add_captions`.
- **Layout and style**: `set_clip_properties` (anchor/position/size in % of
  the frame, text font/colour/box, opacity, rotation, blend mode, volume).
- **Graphics**: `search_icons` + `add_icon` (Iconify: icons, emojis, logos,
  flags), `add_shape`.
- **Motion**: `animate` (fade, zoom/Ken Burns, slide, pop, spin, pulse,
  shake, or custom keyframes), `remove_animations`.
- **Looks**: `list_effects`, `add_effect` (per clip or as an adjustment
  layer), `update_effect`, `remove_effect` — blur, colour adjustment,
  black & white, sepia, vignette, sharpen, chroma key; `add_mask`,
  `remove_mask`.
- **Audio**: `set_volume`, `set_speed`, `set_track`.
- **History / output**: `undo`, `redo`, `seek`, `export_video` (saves to
  `Videos\OpenCut`).

Captions need internet the first time (the speech model is downloaded once),
and icon search needs internet; everything else works offline.

## Building

```sh
npm ci
npm run pack      # bundles src/ into extension/server and writes opencut.mcpb
```

Set `OPENCUT_URL` to point at a dev server instead (e.g. `http://localhost:3000`).

MIT.
