/**
 * Merge templates from a main file plus all of its (transitively
 * loaded) imports into a single flat templates array, rewriting
 * `file:` paths so they're relative to the main file's location.
 *
 * Pure function over already-loaded files. The host owns the loading
 * loop (file I/O, sync vs async, dedup) and feeds the result into
 * this function. See `resolveImportPath` for the dedup invariant.
 *
 * Path rewriting is **per template, based on the file the template
 * was declared in** — regardless of which other files transitively
 * imported it. So a template from `surveys/tipi/tipi.stagebook.yaml`
 * has its `file:` paths prefixed with `surveys/tipi/`, producing
 * paths relative to the main file's location, no matter which import
 * chain reached it.
 *
 * After this returns, imported templates are indistinguishable from
 * inline templates — `fillTemplates` and `treatmentFileSchema` see a
 * flat templates array as if everything were declared in the main
 * file.
 */

// Field names whose values are file-relative paths inside a template.
// These are the same fields the host's `getAssetURL(path)` resolves
// against the asset base — anything not in this set is treated as
// opaque content and passed through unchanged.
const FILE_PATH_FIELDS = new Set(["file", "captionsFile"]);

export interface ParsedFile {
  templates?: unknown[];
  imports?: string[];
  // Other top-level fields (treatments, introSequences, etc.) are
  // ignored by resolveImports — it only consumes the templates list.
  [key: string]: unknown;
}

export interface ResolveImportsArgs {
  /** The main (entry-point) file's parsed contents. */
  main: ParsedFile;
  /**
   * Map from canonical import path (per `resolveImportPath`) to the
   * parsed contents of that file. The host populates this via its
   * loading loop.
   */
  files: Map<string, ParsedFile>;
}

export function resolveImports({ main, files }: ResolveImportsArgs): unknown[] {
  const result: unknown[] = [];
  const seenNames = new Map<string, string>(); // name → source ("(main)" or canonical path)

  // 1. Inline templates from the main file. No path rewriting —
  //    they're already relative to the main file's location.
  if (Array.isArray(main.templates)) {
    for (const template of main.templates) {
      const name = templateName(template);
      if (name !== undefined) {
        if (seenNames.has(name)) {
          throw new Error(
            duplicateNameMessage(name, seenNames.get(name)!, "(main)"),
          );
        }
        seenNames.set(name, "(main)");
      }
      result.push(template);
    }
  }

  // 2. Imported files. Each file's templates get path-rewritten using
  //    that file's directory as the prefix.
  for (const [canonicalPath, parsed] of files) {
    if (!Array.isArray(parsed.templates)) continue;
    const prefix = directoryOf(canonicalPath);
    for (const template of parsed.templates) {
      const name = templateName(template);
      if (name !== undefined) {
        if (seenNames.has(name)) {
          throw new Error(
            duplicateNameMessage(name, seenNames.get(name)!, canonicalPath),
          );
        }
        seenNames.set(name, canonicalPath);
      }
      result.push(
        prefix.length > 0 ? prependPathPrefix(template, prefix) : template,
      );
    }
  }

  return result;
}

function directoryOf(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
}

function templateName(template: unknown): string | undefined {
  if (
    template !== null &&
    typeof template === "object" &&
    "name" in template &&
    typeof (template as { name: unknown }).name === "string"
  ) {
    return (template as { name: string }).name;
  }
  return undefined;
}

function duplicateNameMessage(
  name: string,
  firstSource: string,
  secondSource: string,
): string {
  return (
    `Duplicate template name "${name}": declared in ${firstSource} and ${secondSource}. ` +
    `Template names must be unique across the main file and all imported files. ` +
    `Rename one to disambiguate (e.g. prefix with the module's namespace: \`tipi_${name}\`).`
  );
}

/**
 * Recursively walk an object/array, prepending `prefix/` to any
 * `file:` / `captionsFile:` string value. Skips values that look
 * like they're already absolute (`http://`, `https://`, `/...`),
 * since those aren't relative paths needing the prefix.
 *
 * Returns a new object — does not mutate the input. This guards
 * against accidental double-prefix on subsequent calls and against
 * callers that share template objects between passes.
 */
function prependPathPrefix(value: unknown, prefix: string): unknown {
  if (value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => prependPathPrefix(item, prefix));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FILE_PATH_FIELDS.has(key) && typeof val === "string") {
      result[key] = isAbsolutePath(val) ? val : `${prefix}/${val}`;
    } else {
      result[key] = prependPathPrefix(val, prefix);
    }
  }
  return result;
}

// Path values that should NOT be rewritten with the import-directory
// prefix. Includes `/`-rooted absolute paths and any URL-like value
// matching `<scheme>:` — covers `http://`, `https://`, `asset://`
// (Stagebook's platform-provided assets, see treatment-files.md), and
// any future schemes the host might support. Case-insensitive so
// `HTTP://` / `Asset://` still parse correctly.
function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p);
}
