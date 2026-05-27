import {
  parseTreatmentYaml as parseStagebookYaml,
  resolveImportPath,
  resolveImports,
  type ParsedFile,
} from "../index.js";

export type LoadFailureStage =
  | "parse"
  | "import-read"
  | "import-parse"
  | "resolve";

export type LoadAndMergeResult =
  | {
      ok: true;
      /** Root object with `imports:` stripped and `templates:` replaced
       *  by the merged set. Schema/expander-ready. */
      merged: Record<string, unknown>;
      /** The merged templates list (also embedded in `merged.templates`). */
      templates: unknown[];
    }
  | { ok: false; stage: LoadFailureStage; message: string };

/**
 * Parse a treatment source, walk its `imports:` tree via the supplied
 * loader, and merge every imported file's `templates:` into the root.
 *
 * Shared by `parseTreatmentSource` (which then runs `fillTemplates` +
 * schema validation) and `expandTreatmentSourceWithImports` (which
 * runs the expander for the "View Expanded Templates" command). Both
 * paths previously diverged: one knew about imports, the other didn't.
 * See #321 Repro 2.
 *
 * `loadImport` is the host's bridge to its filesystem; in VS Code it
 * wraps `vscode.workspace.fs`, in tests it can be a Map-based mock.
 */
export async function loadAndMergeImports({
  source,
  loadImport,
}: {
  source: string;
  loadImport: (importPath: string) => Promise<string>;
}): Promise<LoadAndMergeResult> {
  let rootParse: ReturnType<typeof parseStagebookYaml>;
  try {
    rootParse = parseStagebookYaml(source);
  } catch (e) {
    return {
      ok: false,
      stage: "parse",
      message: `YAML parse error: ${errorMessage(e)}`,
    };
  }
  const root = rootParse.parsed as ParsedFile;

  // The root file's own path is the parent for resolving its imports.
  // A fictional `root.stagebook.yaml` works because `resolveImportPath`
  // only uses the parent's directory portion.
  const loaded = new Map<string, ParsedFile>();
  const queue: string[] = rootParse.imports.map((p) =>
    resolveImportPath("root.stagebook.yaml", p),
  );
  while (queue.length > 0) {
    const importPath = queue.shift()!;
    if (loaded.has(importPath)) continue;
    let contents: string;
    try {
      contents = await loadImport(importPath);
    } catch (e) {
      return {
        ok: false,
        stage: "import-read",
        message: `Could not read import file '${importPath}': ${errorMessage(e)}`,
      };
    }
    let importedParse: ReturnType<typeof parseStagebookYaml>;
    try {
      importedParse = parseStagebookYaml(contents);
    } catch (e) {
      return {
        ok: false,
        stage: "import-parse",
        message: `YAML parse error in import '${importPath}': ${errorMessage(e)}`,
      };
    }
    loaded.set(importPath, importedParse.parsed as ParsedFile);
    for (const next of importedParse.imports) {
      queue.push(resolveImportPath(importPath, next));
    }
  }

  let mergedTemplates: unknown[];
  try {
    mergedTemplates = resolveImports({ main: root, files: loaded });
  } catch (e) {
    return {
      ok: false,
      stage: "resolve",
      message: `Could not merge imports: ${errorMessage(e)}`,
    };
  }

  // Strip `imports:` from the root and replace `templates:` with the
  // merged set. Note: `fillTemplates` strips `templates:` from its walk
  // input before expanding, so the merged value is effectively only
  // passed to `fillTemplates` via its separate `templates` parameter.
  // Attaching it back on `merged` is documentation: the post-load shape
  // mirrors what a file with inline templates would look like.
  const rootHadTemplates = "templates" in root;
  const { imports: _imports, templates: _origTemplates, ...rest } = root;
  void _imports;
  void _origTemplates;
  const merged: Record<string, unknown> = { ...rest };
  if (mergedTemplates.length > 0 || rootHadTemplates) {
    merged.templates = mergedTemplates;
  }

  return { ok: true, merged, templates: mergedTemplates };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
