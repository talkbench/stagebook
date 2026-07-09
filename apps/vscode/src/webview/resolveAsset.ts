/**
 * Resolve an `asset://<prefix>/<rest>` URI against the configured local mounts
 * (#192). The extension reads `stagebook.assetRoots` and pre-computes a
 * `{ prefix -> webview-URI base }` map (each base is `asWebviewUri(<mount dir>)`);
 * this runs in the webview and does the sync prefix lookup + path join, so the
 * host resolver stays synchronous.
 *
 * Returns the loadable webview URL when the prefix is mounted and the path is
 * safe; otherwise returns the `asset://` URI UNCHANGED so the renderer falls
 * back to the labeled placeholder (#191) instead of loading a broken URL.
 *
 * `assetPath` is assumed to be an `asset://…` URI (the caller checks the
 * scheme); a non-asset input is returned unchanged.
 */
export function resolveAssetUrl(
  assetPath: string,
  assetRoots: Record<string, string>,
): string {
  const match = /^asset:\/\/([^/]+)(?:\/(.*))?$/i.exec(assetPath);
  if (!match) return assetPath; // not asset:// or malformed → passthrough

  const prefix = match[1];
  const rest = match[2] ?? "";

  const base = assetRoots[prefix];
  if (!base) return assetPath; // prefix not mounted → placeholder fallback

  // Reject path traversal before building a URL — a treatment must not reach
  // outside its mounted root (`localResourceRoots` is the second line of
  // defense). Split on BOTH separators so a backslash-delimited `..\..`
  // (crafted, or a stray Windows path) is caught too, not just `../..`.
  if (rest.split(/[/\\]/).some((seg) => seg === "..")) return assetPath;

  // `.` and empty segments are harmless noise; drop them before joining.
  const segments = rest.split("/").filter((s) => s !== "" && s !== ".");
  const encoded = segments.map(encodeURIComponent).join("/");
  const normalizedBase = base.endsWith("/") ? base : base + "/";
  return encoded ? normalizedBase + encoded : base;
}

/**
 * Route a webview content path to a loadable URL (#192):
 *
 * - an `asset://…` URI resolves against the local mounts via
 *   {@link resolveAssetUrl} — an unmapped or unsafe one is returned UNCHANGED
 *   so the #191 placeholder fires. That passthrough MUST stay an `asset:` URI:
 *   Element's `isUnresolvedAsset` detector (`/^asset:\/\//i`) keys off it, so
 *   this routing gate has to match that scheme test.
 * - any other path is joined onto the treatment-dir base URI (leading slashes
 *   stripped) — the pre-#192 behavior for repo-relative assets.
 *
 * This is the exact `getAssetURL` contract the renderer calls; kept pure and
 * separate from the postMessage bridge so it's unit-testable.
 */
export function buildAssetURL(
  assetPath: string,
  webviewBaseUri: string,
  assetRoots: Record<string, string>,
): string {
  if (/^asset:\/\//i.test(assetPath)) {
    return resolveAssetUrl(assetPath, assetRoots);
  }
  const base = webviewBaseUri.endsWith("/")
    ? webviewBaseUri
    : webviewBaseUri + "/";
  return base + assetPath.replace(/^\/+/, "");
}
