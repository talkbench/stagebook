/**
 * Percent-encode a researcher-authored asset path's segments so it's
 * safe to concatenate with a host's already-encoded base URL.
 *
 * Researchers write filesystem-style paths in YAML (`file: my pic.jpg`)
 * and in markdown image refs (`![](images/round#3.png)`). Those paths
 * may contain spaces, `?`, `#`, `+`, non-ASCII — all valid in filenames
 * but URI-special otherwise. The host's `getAssetURL` is contracted to
 * concatenate with its already-encoded base without re-encoding (see
 * the `getAssetURL` docstring on `StagebookProvider`), so encoding has
 * to happen at the caller before we hand the path over.
 *
 * Per-segment `encodeURIComponent` (rather than `encodeURI` on the
 * whole path) catches `?`, `#`, `&`, `+`, `:`, while preserving `/`
 * separators. See #431 (markdown image refs) and #433 (YAML file
 * fields) for the bugs this prevents.
 *
 * Paths that already look like an absolute URI (anything with a
 * scheme prefix like `http://`, `https://`, `asset://`, `data:`) are
 * returned as-is — encoding would corrupt the scheme delimiters.
 */
export function encodeAssetPath(path: string): string {
  // Scheme detector: an ASCII letter followed by alphanumerics / `+.-`,
  // terminated by `:`. Covers every IANA-registered URI scheme plus
  // stagebook's `asset://` convention. Case-insensitive per RFC 3986.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return path;
  }
  return path.split("/").map(encodeURIComponent).join("/");
}
