import type { TreatmentFileType } from "stagebook";
import { parseTreatmentYaml } from "./treatment";
import { expandTreatmentFile } from "./expandTreatmentFile";

export interface ExampleEntry {
  /** Directory name, e.g. "annotated-walkthrough". */
  id: string;
  /** First treatment's `name` after template expansion. */
  title: string;
  /** First treatment's `notes` field (Markdown), if set. */
  notes?: string;
  /** Raw YAML source. */
  yaml: string;
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
 */
export function buildCatalog(
  yamlByPath: Record<string, string>,
  textByPath: Record<string, string>,
): ExampleEntry[] {
  return Object.entries(yamlByPath)
    .map(([path, yaml]) => buildEntry(path, yaml, textByPath))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildEntry(
  path: string,
  yaml: string,
  textByPath: Record<string, string>,
): ExampleEntry {
  const parts = path.split("/");
  const fileName = parts[parts.length - 1];
  const id = parts[parts.length - 2];
  const exampleDir = path.substring(0, path.length - fileName.length);

  const parsed = parseTreatmentYaml(yaml);
  const { result } = expandTreatmentFile(parsed);
  const firstTreatment = result.treatments[0] as
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
    prompts,
    readme: textByPath[`${exampleDir}README.md`],
  };
}

// --- Build-time discovery ------------------------------------------
// `import.meta.glob` inlines every matched file's content at build
// time, so the bundle is only rebuilt when an example is added,
// removed, or edited — not on every build.
const yamlByPath = import.meta.glob("../../../../examples/*/*.stagebook.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

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
  const parsed = parseTreatmentYaml(entry.yaml);
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
