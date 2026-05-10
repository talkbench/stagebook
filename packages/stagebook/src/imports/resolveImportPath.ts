/**
 * Canonicalize an import path against its parent file's path.
 *
 * Used by hosts to deduplicate imports — two routes to the same file
 * (e.g. `B/b.stagebook.yaml` from main, `../B/b.stagebook.yaml` from
 * a sibling under `A/`) must produce the same canonical string so the
 * host's loaded-file map keys correctly.
 *
 * Always uses POSIX-style forward slashes regardless of host OS.
 * Stagebook's import grammar is `/`-separated; the host is
 * responsible for translating to its native filesystem when reading.
 *
 * Pure function — no I/O, no host filesystem dependency. Stagebook
 * doesn't validate that the resulting path exists; that's a host
 * concern at load time.
 */
export function resolveImportPath(
  parentPath: string,
  importPath: string,
): string {
  // Normalize incoming separators to posix so the function works the
  // same way whether the host passes `study\main.yaml` (Windows) or
  // `study/main.yaml`.
  const parent = parentPath.replace(/\\/g, "/");
  const imp = importPath.replace(/\\/g, "/");

  // Absolute import — discard the parent directory; just normalize.
  if (imp.startsWith("/")) {
    return normalize(imp);
  }

  // Compose the import path against the parent file's directory.
  const lastSlash = parent.lastIndexOf("/");
  const parentDir = lastSlash >= 0 ? parent.slice(0, lastSlash) : "";
  const joined = parentDir.length > 0 ? `${parentDir}/${imp}` : imp;

  return normalize(joined);
}

/**
 * Collapse `.` and `..` segments. POSIX-style — leading `/` indicates
 * absolute. Walking past the root (`/../foo`) clamps at the root;
 * walking past the start of a relative path keeps the leading `..`s
 * (e.g. `../../foo` is preserved verbatim).
 */
function normalize(p: string): string {
  const isAbsolute = p.startsWith("/");
  const segments = p.split("/").filter((s) => s.length > 0 && s !== ".");
  const result: string[] = [];

  for (const seg of segments) {
    if (seg === "..") {
      if (
        result.length > 0 &&
        result[result.length - 1] !== ".." &&
        // Only pop a real segment, not a leading `..` chain.
        result[result.length - 1] !== ""
      ) {
        result.pop();
      } else if (!isAbsolute) {
        // Relative path with leading `..`s — preserve them.
        result.push("..");
      }
      // For absolute paths, walking past `/` is a no-op (clamp at root).
    } else {
      result.push(seg);
    }
  }

  const joined = result.join("/");
  if (isAbsolute) return `/${joined}`;
  return joined.length > 0 ? joined : ".";
}
