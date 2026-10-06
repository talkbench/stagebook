import { fileSchema, parseTreatmentYaml, resolveImportPath } from "../index.js";
import { forEachConcreteElement } from "../schemas/forEachConcreteElement.js";
import { readPromptFrontmatter } from "./promptFrontmatter.js";
import {
  compareStagebookVersions,
  declaredStagebookVersion,
} from "./stagebookVersion.js";
import type { PositionMapper } from "./yamlPositionMap.js";
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
   * Where the file comes in, as a path into the entry file as written: the
   * `["imports", i]` entry it's reached through, or the first prompt element
   * in this file that names it. Null when this file doesn't name the prompt
   * file itself (it comes from an imported template).
   */
  path: (string | number)[] | null;
  message: string;
}

const ROOT = "root.stagebook.yaml"; // as in loadAndMergeImports

/** Collapse `./`, `a/../` and backslashes, so one file is one key. */
function normalizePath(path: string): string {
  return resolveImportPath(ROOT, path);
}

function hasScheme(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBehind(declared: string | undefined, entryVersion: string): boolean {
  return (
    declared === undefined ||
    compareStagebookVersions(declared, entryVersion) < 0
  );
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

/**
 * The first prompt element in the entry file as written (stages or template
 * definitions) whose `file:` names `normalized`. Matching the literal, rather
 * than mapping a hydrated path back, keeps the warning off the wrong element
 * when a template expansion shifts list indices.
 */
function findPromptReference(
  entry: unknown,
  normalized: string,
): (string | number)[] | null {
  const seen = new Set<object>();
  const walk = (
    node: unknown,
    path: (string | number)[],
  ): (string | number)[] | null => {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return null;
    }
    seen.add(node);
    if (
      isRecord(node) &&
      node.type === "prompt" &&
      typeof node.file === "string" &&
      normalizePath(node.file) === normalized
    ) {
      return [...path, "file"];
    }
    const children: [string | number, unknown][] = Array.isArray(node)
      ? node.map((child, i) => [i, child])
      : Object.entries(node);
    for (const [key, child] of children) {
      const found = walk(child, [...path, key]);
      if (found) return found;
    }
    return null;
  };
  return walk(entry, []);
}

/**
 * Run the consistency check. Loaders follow the other cross-file checks:
 * `loadImport` takes a canonical import path (as `loadAndMergeImports` passes
 * it), `loadPrompt` a prompt `file:` path relative to the entry file. A file
 * that can't be read or parsed is skipped; those problems have their own
 * diagnostics. A prompt file only needs readable frontmatter: one that fails
 * the prompt schema for another reason is still checked.
 *
 * @param entry the entry file's parsed YAML, as written
 * @param hydrated the entry file after imports and templates are resolved, or
 *   null (prompt files are then not checked)
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
  const rootImports: unknown[] =
    isRecord(entry) && Array.isArray(entry.imports) ? entry.imports : [];
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
          ? `Imported file ${JSON.stringify(path)}`
          : `${JSON.stringify(path)} (imported through ${JSON.stringify(via)})`;
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

  // Prompt files the study uses, once each. Gated like the locale check:
  // never read a path the schema rejects, or one with a scheme (a URL or
  // `asset://`) the host can't read locally.
  const prompts = new Map<string, string>(); // normalized path → as written
  forEachConcreteElement(hydrated, (element) => {
    const file = element.file;
    if (element.type !== "prompt" || typeof file !== "string") return;
    if (hasScheme(file) || !fileSchema.safeParse(file).success) return;
    const normalized = normalizePath(file);
    if (!prompts.has(normalized)) prompts.set(normalized, file);
  });
  for (const [normalized, file] of prompts) {
    let source: string | null;
    try {
      source = await loadPrompt(file);
    } catch {
      continue;
    }
    if (source === null) continue;
    const frontmatter = readPromptFrontmatter(source);
    if (!isRecord(frontmatter)) continue;
    const declared = declaredStagebookVersion(frontmatter);
    if (isBehind(declared, entryVersion)) {
      issues.push({
        path: findPromptReference(entry, normalized),
        message: behindMessage(
          `Prompt file ${JSON.stringify(normalized)}`,
          declared,
          entryVersion,
        ),
      });
    }
  }

  return issues;
}

/**
 * The consistency check as warnings positioned in the entry file's source.
 * Shared by the CLI and `validateTreatmentWithDiff`; pass the source's
 * position mapper (`createPositionMapper(source)`).
 */
export async function versionConsistencyDiagnostics({
  mapper,
  hydrated,
  loadImport,
  loadPrompt,
}: {
  mapper: PositionMapper;
  hydrated: unknown;
  loadImport: (importPath: string) => Promise<string>;
  loadPrompt: (relPath: string) => Promise<string | null>;
}): Promise<Diagnostic[]> {
  let entry: unknown;
  try {
    entry = mapper.toJSON();
  } catch {
    return []; // e.g. too many YAML aliases; the YAML pass reports it
  }
  const issues = await checkVersionConsistencyWithLoader({
    entry,
    hydrated,
    loadImport,
    loadPrompt,
  });
  return issues.map((issue) => ({
    message: issue.message,
    severity: "warning",
    range: issue.path ? mapper.resolve(issue.path) : null,
  }));
}
