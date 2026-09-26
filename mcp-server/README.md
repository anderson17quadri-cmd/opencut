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

Tools (55), roughly what a professional editor does:

- **Project**: `get_state`, `list_projects`, `create_project`, `open_project`,
  `set_project` (9:16 / 16:9 / 1:1 / 4:5…, fps, colour or blurred background).
- **Media**: `list_media_files`, `add_media`, `add_to_timeline`.
- **Cutting**: `split_clip`, `trim_clip`, `delete_clips`, `move_clip`,
  `duplicate_clip`, `cut_range` (ripple delete across all tracks),
  `find_silences` / `remove_silences` (jump cuts).
- **Look at the result**: `view_frames` returns rendered frames as images.
- **Text and captions**: `add_text`, `transcribe` (per segment or per
  word), `generate_captions` (on-device Whisper). Styles: classic text
  clips, or karaoke, where the spoken word lights up. Plus
  `add_captions`.
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
- **Motion graphics from code**: `preview_motion_graphic` and
  `create_motion_graphic`. Claude writes a 2D canvas or three.js
  `render(t)`; it runs in a sandboxed iframe (opaque origin, no network)
  and is rendered to a transparent WebM on its own layer. Use it for
  titles, VS cards, explainers, 3D objects and end cards.
- **AI cutout**: `cutout_person` separates the presenter from the
  background (MediaPipe, on device) into an aligned top layer, so graphics
  can sit behind them. `move_layer` reorders layers. `follow_hand` tracks a
  visible hand (MediaPipe Hand Landmarker) and keys another clip's position
  so it floats in the palm.
- **Editor's finishing touches**: `explode_layers` (the frame turns
  sideways and splits into 3D glass panes — presenter, graphics,
  background with the person painted out — with numbered labels, then
  folds back seamlessly), `punch_zoom` (cut/smooth/push zooms that keep
  the face framed, via on-device face detection), `add_sound_effect`
  (pop, whoosh, swoosh, click, impact, riser, ding — synthesized locally,
  no licence), `duck_music` (music dips automatically under speech).
- **Pictures at spoken references**: `add_web_image` (download + import +
  show a picture as a pop-up card, plain picture or fullscreen cutaway,
  with optional sound) and `place_image` for pictures already imported.
- **Transitions**: `add_transition` (crossfade, dip to black, slides, zoom;
  one pair or every cut), overlapping with spare footage when there is
  some, otherwise pulling later clips in.
- **From the internet**: `search_free_media` (music and sound effects
  from Openverse, images from Wikimedia Commons and Openverse with preview
  pictures Claude can look at, video from Wikimedia Commons, with license
  and attribution) and `download_media` (direct links to
  `Downloads\OpenCut`, imported into the project; only public http(s)
  hosts, media files up to 4 GB). Credits are never drawn on the video:
  `export_video` writes `<video> - créditos.txt` next to the export,
  listing the downloaded media the video actually uses.
- **Audio**: `set_volume`, `set_speed`, `set_track`.
- **History / output**: `undo`, `redo`, `seek`, `export_video` (saves to
  `Videos\OpenCut`), `check_task` for operations that outlast the client's
  tool timeout.

The extension's instructions include a step-by-step "edit like a human
editor" recipe (clean cut, hook, pacing with zooms and b-roll, karaoke
captions, signature 3D moments, sound design, music ducking, grade, CTA,
review with `view_frames`).

Captions, the AI cutout, face detection and hand tracking need internet
the first time (their models are downloaded once);
icon search, free-media search and downloads need internet; everything else
works offline.

## Building

```sh
npm ci
npm run pack      # bundles src/ into extension/server and writes opencut.mcpb
```

Set `OPENCUT_URL` to point at a dev server instead (e.g. `http://localhost:3000`).

MIT.
