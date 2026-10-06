import {
  fileSchema,
  parseTreatmentYaml,
  promptFileSchema,
  resolveImportPath,
} from "../index.js";
import { forEachConcreteElement } from "../schemas/forEachConcreteElement.js";
import {
  compareStagebookVersions,
  declaredStagebookVersion,
} from "./stagebookVersion.js";
import {
  createPositionMapper,
  resolvePathOrAncestor,
} from "./yamlPositionMap.js";
import type { Diagnostic } from "./types.js";

/**
 * A study's files should all be on one Stagebook version (#756).
 *
 * When the validated (entry) file declares `stagebook:`, every file it imports,
 * directly or through other imports, and every prompt file it uses should
 * declare the same version or a newer one. A file that declares an older
 * version, or none, gets one warning naming both versions: its upgrade
 * warnings, reported when that file itself is validated, haven't been
 * reviewed against the entry file's release. A newer file isn't flagged, so a
 * shared prompt file can be raised for one study without breaking another.
 *
 * No check runs when the entry file declares no version. Validating an
 * imported file or a prompt file on its own checks only what *it* uses.
 */
export interface VersionConsistencyIssue {
  /**
   * Where the file comes in: `["imports", i]` in the entry file for an import
   * (the direct import it's reached through), or the first prompt element's
   * `file` path in the hydrated tree for a prompt file.
   */
  path: (string | number)[];
  message: string;
}

const ROOT = "root.stagebook.yaml"; // as in loadAndMergeImports

function hasScheme(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

function behindMessage(
  subject: string,
  declared: string | undefined,
  entryVersion: string,
): string {
  const problem =
    declared === undefined
      ? `doesn't declare a valid \`stagebook:\` version, but this file declares "${entryVersion}"`
      : `declares \`stagebook: "${declared}"\`, older than this file's "${entryVersion}"`;
  return `${subject} ${problem}. Validate it and review its upgrade warnings, then set its \`stagebook:\` to "${entryVersion}" so the study's files are on one version.`;
}

function isBehind(declared: string | undefined, entryVersion: string): boolean {
  return (
    declared === undefined ||
    compareStagebookVersions(declared, entryVersion) < 0
  );
}

/**
 * Run the consistency check. Loaders follow the other cross-file checks:
 * `loadImport` takes a canonical import path (as `loadAndMergeImports` passes
 * it), `loadPrompt` a prompt `file:` path relative to the entry file. A file
 * that can't be read or parsed is skipped; those problems have their own
 * diagnostics.
 *
 * @param entry the entry file's parsed YAML, as written
 * @param hydrated the entry file after imports and templates are resolved, or
 *   null when hydration failed (prompt files are then not checked)
 */
export async function checkVersionConsistencyWithLoader({
  entry,
  hydrated,
  loadImport,
  loadPrompt,
}: {
  entry: unknown;
  hydrated: unknown;
  loadImport: (importPath: string) => Promise<string>;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<VersionConsistencyIssue[]> {
  const entryVersion = declaredStagebookVersion(entry);
  if (entryVersion === undefined) return [];
  const issues: VersionConsistencyIssue[] = [];

  // Imports, breadth-first so a file is reported at the shortest chain that
  // reaches it: a direct import before one it also gets through another file.
  const rootImports =
    typeof entry === "object" &&
    entry !== null &&
    Array.isArray((entry as { imports?: unknown }).imports)
      ? ((entry as { imports: unknown[] }).imports as unknown[])
      : [];
  const queue: { path: string; index: number; via?: string }[] = [];
  rootImports.forEach((importPath, index) => {
    if (typeof importPath === "string" && importPath.length > 0) {
      queue.push({ path: resolveImportPath(ROOT, importPath), index });
    }
  });
  const seen = new Set<string>();
  while (queue.length > 0) {
    const { path, index, via } = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    let parsed: ReturnType<typeof parseTreatmentYaml>;
    try {
      parsed = parseTreatmentYaml(await loadImport(path));
    } catch {
      continue;
    }
    const declared = declaredStagebookVersion(parsed.parsed);
    if (isBehind(declared, entryVersion)) {
      const subject =
        via === undefined
          ? `Imported file "${path}"`
          : `"${path}" (imported through "${via}")`;
      issues.push({
        path: ["imports", index],
        message: behindMessage(subject, declared, entryVersion),
      });
    }
    for (const next of parsed.imports) {
      queue.push({
        path: resolveImportPath(path, next),
        index,
        via: via ?? path,
      });
    }
  }

  // Prompt files the study uses, reported once each at the first reference.
  // Gated like the locale check: never read a path the schema rejects, or one
  // with a scheme (a URL or `asset://`) the host can't read locally.
  const firstReference = new Map<string, (string | number)[]>();
  forEachConcreteElement(hydrated, (element, path) => {
    const file = element.file;
    if (element.type !== "prompt" || typeof file !== "string") return;
    if (hasScheme(file) || !fileSchema.safeParse(file).success) return;
    if (!firstReference.has(file)) firstReference.set(file, [...path, "file"]);
  });
  for (const [file, path] of firstReference) {
    let source: string | null;
    try {
      source = await loadPrompt(file);
    } catch {
      continue;
    }
    if (source === null) continue;
    const parsed = promptFileSchema.safeParse(source);
    if (!parsed.success) continue;
    const declared = parsed.data.metadata.stagebook;
    if (isBehind(declared, entryVersion)) {
      issues.push({
        path,
        message: behindMessage(`Prompt file "${file}"`, declared, entryVersion),
      });
    }
  }

  return issues;
}

/**
 * The consistency check as warnings positioned in the entry file's source.
 * Shared by the CLI and `validateTreatmentWithDiff`. A prompt reference's
 * hydrated path is mapped to its nearest ancestor in the source, as the other
 * cross-file checks do.
 */
export async function versionConsistencyDiagnostics({
  source,
  hydrated,
  loadImport,
  loadPrompt,
}: {
  source: string;
  hydrated: unknown;
  loadImport: (importPath: string) => Promise<string>;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<Diagnostic[]> {
  const mapper = createPositionMapper(source);
  const issues = await checkVersionConsistencyWithLoader({
    entry: mapper.toJSON(),
    hydrated,
    loadImport,
    loadPrompt,
  });
  return issues.map((issue) => ({
    message: issue.message,
    severity: "warning",
    range: resolvePathOrAncestor(mapper, issue.path),
  }));
}
