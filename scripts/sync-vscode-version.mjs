#!/usr/bin/env node
// Derive the VS Code extension's version from the stagebook library version, so
// the installed extension's version reflects the stagebook it bundles (#562).
//
// The extension only ships alongside a stagebook release (release-vscode.yml
// fires on `release: published`), so its version should equal the library's —
// then "which stagebook am I previewing against?" and "is my extension current?"
// are answerable from the Extensions panel. A hand-maintained number is the same
// drift trap the design-token copy was (#560), so this is derived, never typed.
//
// Runs as apps/vscode's `prepackage` hook (before `vsce package`), so every
// built/released vsix carries the stagebook version. Idempotent: a no-op when
// already in sync (so a local `npm run package` doesn't dirty the tree).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const libPath = join(root, "packages", "stagebook", "package.json");
const extPath = join(root, "apps", "vscode", "package.json");

const libVersion = JSON.parse(readFileSync(libPath, "utf8")).version;
const extRaw = readFileSync(extPath, "utf8");
const extVersion = JSON.parse(extRaw).version;

if (extVersion === libVersion) {
  console.log(
    `stagebook-vscode version already ${libVersion} (matches stagebook) — no change`,
  );
  process.exit(0);
}

// Replace only the first `"version": "…"` (the package version — `engines`
// uses `"vscode":`, not `"version":`) so the file's formatting is preserved.
const updated = extRaw.replace(/("version":\s*")[^"]*(")/, `$1${libVersion}$2`);
if (updated === extRaw) {
  console.error("sync-vscode-version: could not find the version field to update");
  process.exit(1);
}
writeFileSync(extPath, updated);
console.log(
  `stagebook-vscode version ${extVersion} -> ${libVersion} (matched to stagebook)`,
);
