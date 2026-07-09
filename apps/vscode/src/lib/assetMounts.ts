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
