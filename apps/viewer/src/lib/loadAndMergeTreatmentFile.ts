/**
 * Load a Stagebook treatment file plus its (transitively) imported
 * template modules, returning the merged result.
 *
 * Wraps stagebook's primitives (`parseTreatmentYaml`,
 * `resolveImportPath`, `resolveImports`) with a host-side loading
 * loop. The host injects `loadImport(canonicalPath) => Promise<string>`
 * — for the URL flow this is `fetch(rawBaseUrl + path).text()`; for
 * the bundled examples it's a synchronous lookup wrapped in
 * `Promise.resolve`.
 *
 * Throws if any import can't be loaded, parses with errors, or
 * triggers a template-name collision in `resolveImports`.
 */
import {
  parseTreatmentYaml as parseStagebookYaml,
  resolveImportPath,
  resolveImports,
  type ParsedFile,
  type TreatmentFileType,
} from "stagebook";

export type LoadImportFn = (canonicalPath: string) => Promise<string>;

/**
 * Sentinel used as the parent path when resolving the root file's
 * own imports. Only the directory portion matters to
 * `resolveImportPath`, so any name ending in `.stagebook.yaml` works
 * — using a literal makes the intent obvious in stack traces.
 */
const ROOT_PATH_SENTINEL = "root.stagebook.yaml";

export async function loadAndMergeTreatmentFile(
  rootYaml: string,
  loadImport: LoadImportFn,
): Promise<TreatmentFileType> {
  const rootParse = parseStagebookYaml(rootYaml);
  const root = rootParse.parsed as ParsedFile;

  const loaded = new Map<string, ParsedFile>();
  const queue: string[] = rootParse.imports.map((p) =>
    resolveImportPath(ROOT_PATH_SENTINEL, p),
  );

  while (queue.length > 0) {
    const importPath = queue.shift()!;
    if (loaded.has(importPath)) continue;
    const text = await loadImport(importPath);
    const childParse = parseStagebookYaml(text);
    loaded.set(importPath, childParse.parsed as ParsedFile);
    for (const next of childParse.imports) {
      queue.push(resolveImportPath(importPath, next));
    }
  }

  const mergedTemplates = resolveImports({ main: root, files: loaded });

  // Strip `imports:` from the root and replace `templates:` with the
  // merged set — what the schema/runtime expects post-import.
  //
  // Re-attach `templates:` whenever the root explicitly had it, even
  // if the merged array is empty — preserves the schema's rejection
  // of `templates: []` in the root.
  const rootHadTemplates = "templates" in root;
  const { imports: _imports, templates: _origTemplates, ...rest } = root;
  void _imports;
  void _origTemplates;
  const merged: Record<string, unknown> = { ...rest };
  if (mergedTemplates.length > 0 || rootHadTemplates) {
    merged.templates = mergedTemplates;
  }
  return merged as TreatmentFileType;
}
