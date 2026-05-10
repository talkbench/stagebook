import type { TreatmentFileType } from "stagebook";
import {
  parseTreatmentYaml as parseStagebookYaml,
  resolveImportPath,
  resolveImports,
  type ParsedFile,
} from "stagebook";
import { parseTreatmentYaml } from "./treatment";
import { expandTreatmentFile } from "./expandTreatmentFile";

export interface ExampleEntry {
  /** Directory name, e.g. "annotated-walkthrough". */
  id: string;
  /** First treatment's `name` after template expansion. */
  title: string;
  /** First treatment's `notes` field (Markdown), if set. */
  notes?: string;
  /** Raw YAML source as written by the researcher (still has `imports:`). */
  yaml: string;
  /**
   * YAML (or JSON, also valid YAML) source with any `imports:`
   * resolved against the bundled module files and the resulting
   * templates merged in. Equal to `yaml` for examples with no
   * imports. Use this for runtime parse + expand so the imported
   * templates are present.
   */
  mergedYaml: string;
  /** Content of every `*.prompt.md` in the example, keyed by path
   *  relative to the example directory (e.g. `"prompts/consent.prompt.md"`). */
  prompts: Record<string, string>;
  /** README.md content, if present in the example directory. */
  readme?: string;
}

/**
 * Pure: given an input map of treatment YAML files and a map of
 * `*.prompt.md` files (both keyed by absolute import path, as returned
 * by `import.meta.glob`), build the sorted catalog of examples.
 *
 * Separating this from the glob call keeps it testable without
 * relying on Vite's runtime glob.
 *
 * Only files in the example directory ROOT (e.g.
 * `examples/foo/foo.stagebook.yaml`) become catalog entries. Files
 * inside nested module subdirectories (e.g.
 * `examples/foo/modules/m.stagebook.yaml`) are loaded only when an
 * entry's `imports:` references them — they're not catalog entries
 * in their own right.
 */
export function buildCatalog(
  yamlByPath: Record<string, string>,
  textByPath: Record<string, string>,
): ExampleEntry[] {
  return Object.entries(yamlByPath)
    .filter(([path]) => isExampleRoot(path))
    .map(([path, yaml]) => buildEntry(path, yaml, textByPath, yamlByPath))
    .sort((a, b) => a.id.localeCompare(b.id));
}

// True when this YAML file lives at the example-directory root (one
// directory deep under `examples/`), not inside a `modules/` or
// other nested subdir. Examples currently have a flat root-file
// layout; files in subdirs are imports, not separate examples.
function isExampleRoot(path: string): boolean {
  const examplesIdx = path.indexOf("/examples/");
  if (examplesIdx < 0) return false;
  const tail = path.slice(examplesIdx + "/examples/".length);
  // tail should be like `foo/foo.stagebook.yaml` — exactly one
  // directory segment before the filename.
  return tail.split("/").length === 2;
}

/**
 * Resolve any `imports:` declared in `rootYaml` against the bundled
 * `yamlByPath` map (a build-time snapshot of every example file),
 * returning a YAML string of the merged result with the `imports:`
 * key stripped and merged `templates:` re-attached.
 *
 * Synchronous because the example data is already in memory — no
 * I/O. The async equivalent for runtime URL loading lives in
 * `loadAndMergeTreatmentFile.ts`.
 *
 * Examples without `imports:` round-trip the original YAML
 * unchanged, so this is a no-op for the existing catalog.
 */
function mergeBundledImports(
  rootYaml: string,
  exampleDir: string,
  yamlByPath: Record<string, string>,
): string {
  const rootParse = parseStagebookYaml(rootYaml);
  if (rootParse.imports.length === 0) return rootYaml;

  const root = rootParse.parsed as ParsedFile;
  const loaded = new Map<string, ParsedFile>();
  const queue: string[] = rootParse.imports.map((p) =>
    resolveImportPath("root.stagebook.yaml", p),
  );

  while (queue.length > 0) {
    const importPath = queue.shift()!;
    if (loaded.has(importPath)) continue;
    const fullPath = `${exampleDir}${importPath}`;
    const yaml = yamlByPath[fullPath];
    if (yaml === undefined) {
      throw new Error(
        `Example at ${exampleDir} imports "${importPath}" but no bundled file ` +
          `exists at ${fullPath}. Make sure the file exists and matches the ` +
          `glob in exampleCatalog.ts.`,
      );
    }
    const childParse = parseStagebookYaml(yaml);
    loaded.set(importPath, childParse.parsed as ParsedFile);
    for (const next of childParse.imports) {
      queue.push(resolveImportPath(importPath, next));
    }
  }

  const mergedTemplates = resolveImports({ main: root, files: loaded });

  // Strip `imports:`, attach merged templates, re-serialize as JSON
  // (which is valid YAML) so the existing string-based parse path
  // can consume the result without changes.
  //
  // Re-attach `templates:` whenever the root explicitly had it, even
  // if the merged array is empty — preserves the schema's rejection
  // of `templates: []` in the root example.
  const rootHadTemplates = "templates" in root;
  const { imports: _imports, templates: _origTemplates, ...rest } = root;
  void _imports;
  void _origTemplates;
  const merged: Record<string, unknown> = { ...rest };
  if (mergedTemplates.length > 0 || rootHadTemplates) {
    merged.templates = mergedTemplates;
  }
  return JSON.stringify(merged);
}

function buildEntry(
  path: string,
  yaml: string,
  textByPath: Record<string, string>,
  yamlByPath: Record<string, string>,
): ExampleEntry {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1];
  const id = parts[parts.length - 2];
  const exampleDir = path.substring(0, path.length - fileName.length);

  // Resolve any `imports:` against the bundled YAML map so the
  // example previews end-to-end. The example catalog is built at
  // app start; if an example imports a file we didn't bundle we'd
  // rather know now (via the throw) than at preview time.
  const mergedYaml = mergeBundledImports(yaml, exampleDir, yamlByPath);
  const parsed = parseTreatmentYaml(mergedYaml);
  const { result } = expandTreatmentFile(parsed);
  const firstTreatment = result.treatments?.[0] as
    | { name: string; notes?: string }
    | undefined;

  // `textByPath` globs both `*.prompt.md` and `README.md`; only the
  // prompt files belong in `prompts`. README is a separate field.
  const prompts: Record<string, string> = {};
  for (const [p, content] of Object.entries(textByPath)) {
    if (p.startsWith(exampleDir) && p.endsWith(".prompt.md")) {
      prompts[p.substring(exampleDir.length)] = content;
    }
  }

  return {
    id,
    title: firstTreatment?.name ?? id,
    notes: firstTreatment?.notes,
    yaml,
    mergedYaml,
    prompts,
    readme: textByPath[`${exampleDir}README.md`],
  };
}

// --- Build-time discovery ------------------------------------------
// `import.meta.glob` inlines every matched file's content at build
// time, so the bundle is only rebuilt when an example is added,
// removed, or edited — not on every build.
//
// Glob pattern uses `**` so files in nested subdirs (e.g.
// `examples/foo/modules/m.stagebook.yaml`) get bundled too. Such
// files don't become catalog entries themselves (filtered out by
// `isExampleRoot` in `buildCatalog`); they're only loaded when
// resolved via an entry's `imports:` declaration.
const yamlByPath = import.meta.glob(
  "../../../../examples/**/*.stagebook.yaml",
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

const textByPath = import.meta.glob(
  ["../../../../examples/**/*.prompt.md", "../../../../examples/*/README.md"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

export const exampleCatalog: ExampleEntry[] = buildCatalog(
  yamlByPath,
  textByPath,
);

/**
 * Parse + expand the example's YAML the same way the URL load path does
 * in `loader.ts`. Without expansion, a treatment template with a
 * `broadcast` axis renders as a single row, so the OverviewPage's
 * `treatments.length > 1` check fails and the picker collapses to the
 * single-button "Ready to view" state instead of showing radios for
 * each broadcasted variant. (Issue #229.)
 */
export function prepareExampleTreatment(
  entry: ExampleEntry,
): TreatmentFileType {
  // Use mergedYaml so any imported templates are present before
  // template expansion. For examples without imports this is the
  // same string as `entry.yaml`.
  const parsed = parseTreatmentYaml(entry.mergedYaml);
  const { result } = expandTreatmentFile(parsed);
  return result;
}

/**
 * Build `getTextContent` / `getAssetURL` functions for an example
 * loaded from bundled content (no network).
 */
export function createExampleContentFns(entry: ExampleEntry) {
  return {
    getTextContent(path: string): Promise<string> {
      // README is bundled separately from prompts but served via the same
      // getTextContent channel so App.tsx can fetch it without knowing
      // whether the source is an example or a URL.
      if (path === "README.md" && entry.readme !== undefined) {
        return Promise.resolve(entry.readme);
      }
      const content = entry.prompts[path];
      if (content === undefined) {
        return Promise.reject(
          new Error(
            `No bundled content for "${path}" in example "${entry.id}"`,
          ),
        );
      }
      return Promise.resolve(content);
    },
    getAssetURL(path: string): string {
      return path;
    },
  };
}
