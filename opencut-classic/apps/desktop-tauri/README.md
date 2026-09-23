# OpenCut desktop (Tauri, Windows)

Native Windows shell around the editor. No Docker, no terminal, no
separate install steps for the end user — the installer bundles everything
it needs and the app is a normal double-click `.exe`/`.msi`.

## How it works

1. On launch, `src-tauri/src/main.rs` spawns a **bundled portable Node.js
   runtime** running the Next.js app's **standalone build** (`next build`
   with `output: "standalone"` in `apps/web/next.config.ts`) as a hidden
   background process, on `127.0.0.1:47821`.
2. It waits for that port to accept connections, then opens a native
   window (Windows' built-in WebView2 — this is why RAM usage stays low:
   no bundled Chromium like Electron) pointed at that local URL.
3. The SQLite database lives under the OS-provided per-app data directory
   (`%APPDATA%/dev.anderson17quadri.opencut/data/opencut.db`), not inside
   the install folder, so it survives reinstalls/updates.
4. Closing the window kills the background Node process.

Why a bundled Node runtime instead of Tauri's sidecar/shell plugin: the
Next.js standalone output is a folder (server.js + a pruned `node_modules`
including native addons like `better-sqlite3`), not a single executable —
compiling it into one `.exe` (Node's experimental SEA) doesn't play well
with native addons. Shipping a portable Node binary alongside it and
invoking `node server.js` directly is the boring, reliable option.

## Building

This is built by CI (`.github/workflows/desktop-windows.yml`), not by hand
— see that workflow for the exact steps (staging the Node runtime,
building the Next.js standalone output, generating icons, running
`tauri build`). This sandbox has no Windows/Rust toolchain to build or
test it locally, so CI is also how the first real verification of this
setup happens; expect to iterate on the workflow based on what it reports.

To build locally on an actual Windows machine once you have Rust + the
Tauri CLI installed, mirror what the workflow does: build
`apps/web` in standalone mode, stage a portable Node runtime + the
standalone output under `src-tauri/resources/`, generate icons, then
`bunx tauri build` from this directory.
