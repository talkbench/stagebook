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
