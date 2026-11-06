import * as path from "path";
import { isWithinWorkspace } from "./filePaths.js";

/**
 * workspaceState key under which the VS Code preview persists the user's
 * interactive asset-folder picks (#192), as a prefix → absolute-fsPath map.
 * Workspace-scoped and machine-local (a Memento, not a file) — never committed
 * to the study, never Settings-Synced.
 */
export const ASSET_MOUNTS_STATE_KEY = "stagebook.assetMounts";

/**
 * Merge the two sources of asset mounts into one prefix → absolute-fsPath map.
 *
 * - `settingMounts` — the `stagebook.assetRoots` setting, a committable shared
 *   convention. Relative paths resolve against the workspace root; absolute
 *   paths are used as-is.
 * - `pickedMounts` — the user's interactive folder picks from workspaceState
 *   (always absolute). These WIN on conflict, so a local pick overrides a
 *   committed default.
 *
 * Pure (no VS Code or filesystem access) so it's unit-testable. Non-string or
 * empty values are skipped. A relative setting path with no workspace root is
 * passed through unchanged — it can't be resolved, and the caller will simply
 * fail to load it, which is the correct outcome.
 */
export function mergeAssetMounts(
  settingMounts: Record<string, unknown>,
  pickedMounts: Record<string, unknown>,
  workspaceRootFsPath: string | undefined,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [prefix, raw] of Object.entries(settingMounts)) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    merged[prefix] =
      path.isAbsolute(raw) || !workspaceRootFsPath
        ? raw
        : path.join(workspaceRootFsPath, raw);
  }
  // Interactive picks override the committed setting.
  for (const [prefix, raw] of Object.entries(pickedMounts)) {
    if (typeof raw === "string" && raw.length > 0) merged[prefix] = raw;
  }
  return merged;
}

/**
 * Resolve an `asset://<prefix>/<rest>` reference to its mounted directory and
 * the relative rest path, for READING the file host-side (#192 — an
 * `asset://…` prompt loads its markdown through the readFile bridge, not the
 * webview `<img>/<video src>` path).
 *
 * Returns null when the prefix isn't mounted or `rest` traverses upward (`..`,
 * either separator) — the caller then reports it unresolved so the #191
 * placeholder fires. The rest is returned raw for the caller to join onto the
 * mount dir (and re-check containment). Pure/testable; `asset:` scheme match is
 * case-insensitive, prefix case preserved.
 */
export function parseMountedAsset(
  assetPath: string,
  mountDirs: Record<string, string>,
): { dir: string; rest: string } | null {
  const match = /^asset:\/\/([^/]+)(?:\/(.*))?$/i.exec(assetPath);
  if (!match) return null;
  const dir = mountDirs[match[1]];
  if (typeof dir !== "string" || dir.length === 0) return null;
  const rest = match[2] ?? "";
  if (rest.split(/[/\\]/).some((seg) => seg === "..")) return null;
  return { dir, rest };
}

/**
 * Reduce a set of mount directories to the minimal set that must be ADDED as
 * extra webview `localResourceRoots`, given the roots the webview already
 * covers (the extension dir + workspace folders).
 *
 * VS Code `localResourceRoots` are RECURSIVE, so a mount inside a workspace
 * folder (or inside another retained mount) is already loadable — re-adding it
 * as a distinct root is pointless AND makes the panel's root set change, which
 * would force a spurious webview reload on every in-workspace pick. Dropping
 * those keeps an in-workspace mount reload-free (#192 review).
 *
 * Pure — testable. Order-preserving and deterministic (so the caller's
 * reload-vs-not root-set comparison is stable). Paths are compared via
 * {@link isWithinWorkspace} (string-level `path.relative`; does not resolve
 * symlinks — the same caveat the readFile guard carries).
 */
export function extraAssetRoots(
  mountDirs: string[],
  coveredRootFsPaths: string[],
): string[] {
  const kept: string[] = [];
  for (const dir of mountDirs) {
    if (typeof dir !== "string" || dir.length === 0) continue;
    if (coveredRootFsPaths.some((root) => isWithinWorkspace(dir, root))) {
      continue; // already covered by a base root (recursive)
    }
    if (kept.some((k) => isWithinWorkspace(dir, k))) {
      continue; // already covered by a mount we're keeping
    }
    kept.push(dir);
  }
  return kept;
}

/**
 * Split the asset prefixes a treatment references into those with a resolved
 * mount directory and those without.
 *
 * `mounted` (prefix → dir) feeds the webview's resolver; `unmapped` drives the
 * picker card. Pure — testable. Preserves the input order of `prefixes` in
 * `unmapped`.
 */
export function splitAssetMounts(
  prefixes: string[],
  mountDirs: Record<string, string>,
): { mounted: Record<string, string>; unmapped: string[] } {
  const mounted: Record<string, string> = {};
  const unmapped: string[] = [];
  for (const prefix of prefixes) {
    const dir = mountDirs[prefix];
    if (typeof dir === "string" && dir.length > 0) mounted[prefix] = dir;
    else unmapped.push(prefix);
  }
  return { mounted, unmapped };
}

/**
 * The `asset://<prefix>/…` prefixes in a task parameter file's field values
 * (#815), so the picker card can offer to mount them: a task's clip URL is
 * usually where an `asset://` reference lives, and the treatment only holds
 * its `${clipUrl}` placeholder. Reads the Annotator task-file array or a
 * `{ "tasks": [...] }` submission body; only entries' `fields` count, never
 * deployment `metadata`. Unparseable text yields none — the preview reports
 * it. Pure — testable.
 */
export function collectTaskParameterAssetPrefixes(text: string): string[] {
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return [];
  }
  const entries: unknown[] = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.tasks)
      ? json.tasks
      : [];

  const prefixes = new Set<string>();
  // Explicit stack: a deeply nested value can't overflow the call stack.
  const pending: unknown[] = entries.map((entry) =>
    isRecord(entry) ? entry.fields : undefined,
  );
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      const prefix = ASSET_PREFIX.exec(value)?.[1];
      // A `${…}` prefix isn't a concrete mount key.
      if (prefix !== undefined && !prefix.includes("${")) prefixes.add(prefix);
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (isRecord(value)) {
      for (const item of Object.values(value)) pending.push(item);
    }
  }
  return [...prefixes];
}

// Matches stagebook's collectAssetPrefixes: case-insensitive scheme, prefix up
// to the first slash; an opaque `asset:clip.mp4` has no mount prefix.
const ASSET_PREFIX = /^asset:\/\/([^/]+)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
