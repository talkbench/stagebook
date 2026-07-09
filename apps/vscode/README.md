# Stagebook for VS Code

Validation, syntax highlighting, and live preview for Stagebook treatment
(`.stagebook.yaml`) and prompt (`.prompt.md`) files.

## Features

- **Diagnostics** — the same validator that powers the `stagebook validate`
  CLI runs as you type, surfacing schema errors, cross-file `imports:`
  problems, and post-expansion issues in the Problems panel (same text,
  positions, and severities the CLI reports).
- **Syntax highlighting** — dedicated grammars and file icons for
  `.stagebook.yaml` and `.prompt.md`.
- **Preview** — `Stagebook: Preview Treatment` renders a participant-perspective
  preview of a treatment; `Stagebook: Preview Expanded Templates` shows the
  file with templates and imports expanded.
- **Validate Workspace** — `Stagebook: Validate Workspace` checks every
  Stagebook file in the folder at once.
- **Local asset mounts** — preview media referenced by `asset://` URIs by
  pointing each prefix at a folder on your machine (see below).

## Previewing local assets (`asset://`)

Treatments can reference platform-hosted media with an `asset://<prefix>/<path>`
URI (e.g. `asset://group_recordings/session_01.mp4`). In production the platform
resolves these; in the preview there is no platform, so by default an
`asset://` reference shows a labeled placeholder.

To see the real media while authoring, **mount each prefix to a local folder**:

- When a preview references an unmapped prefix, a banner appears above it with a
  **Choose folder…** button per prefix. Pick the folder that contains that
  prefix's files and the media loads in place — no reload needed for folders
  inside your workspace.
- Your choices are remembered **per workspace** (in VS Code's storage) and are
  **never written to the study** — `asset://` stays platform-resolved and the
  `.stagebook.yaml` stays portable.
- To re-point a folder you picked by mistake, or to clear all mounts, run
  **`Stagebook: Configure Asset Folders`** from the Command Palette.

Prefer a **committable, shared convention** for a team? Set
[`stagebook.assetRoots`](#settings) instead — but note the paths are only used
by this preview, and machine-specific absolute paths won't be portable across
teammates (which is exactly why the per-workspace picker is the default).

Mounting a folder grants the preview read access to it (via the webview's
`localResourceRoots`); the mapping is always your explicit choice, never set by
a treatment, and paths that try to escape a mounted folder (`../…`) are
rejected.

### Settings

| Setting | Description |
| --- | --- |
| `stagebook.assetRoots` | An object mapping each `asset://` prefix to a local folder (absolute, or relative to the workspace root), e.g. `{ "group_recordings": "/Users/me/pilot_videos", "diagrams": "./media/diagrams" }`. Preview-only; an interactive pick for the same prefix overrides it. |

## Install

The extension is not on the VS Code Marketplace yet. Each
[GitHub Release](https://github.com/talkbench/stagebook/releases) attaches a
`.vsix` you can install directly. The stable URL below always resolves to the
newest release:

```bash
curl -L -o stagebook-vscode.vsix \
  https://github.com/talkbench/stagebook/releases/latest/download/stagebook-vscode.vsix
code --install-extension stagebook-vscode.vsix
```

Or, in VS Code: **Extensions** panel → **⋯** menu → **Install from VSIX…** →
pick the downloaded file.

> Installing a **same-version** `.vsix` over one already installed does not
> auto-reload — reload the window (**Developer: Reload Window**) to pick up the
> new build. **Workspace Trust** must be granted for the folder before the
> extension activates.

## Build from source

The `.vsix` is not committed to the repo — it is built in CI and attached to
releases (see [`.github/workflows/release-vscode.yml`](../../.github/workflows/release-vscode.yml)).
To build one locally (e.g. while developing the extension):

```bash
npm run package -w stagebook-vscode
```

This runs the `vscode:prepublish` step (library build + production bundle) and
emits `apps/vscode/stagebook-vscode-<version>.vsix`, which you can install with
`code --install-extension apps/vscode/stagebook-vscode-<version>.vsix --force`.

## Marketplace publishing

Publishing to the VS Code Marketplace and Open VSX is tracked in
[#135](https://github.com/talkbench/stagebook/issues/135).
