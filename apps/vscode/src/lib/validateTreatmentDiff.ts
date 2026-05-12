import {
  runValidationDiff,
  collectPreHydrationIssues,
  parseTreatmentYaml as parseStagebookYaml,
  type PreHydrationIssue,
} from "stagebook";
import type { ZodIssue } from "zod";
import { loadAndMergeImports } from "./loadAndMergeImports";
import { createPositionMapper, extractYamlErrors } from "./yamlPositionMap";
import type { Diagnostic } from "./types";

/**
 * Editor-side wrapper around the diff orchestrator. Loads imports
 * asynchronously, runs the orchestrator, runs the pre-hydration
 * semantic checks, and maps every issue's path to a source position
 * via the existing YAML AST mapper.
 *
 * Diagnostic display strategy (v1):
 *
 *   - YAML parse / duplicate-key warnings    → existing behavior
 *   - Imports failed to load                  → error at line 1
 *   - Pre-hydration semantic issues           → error at source path
 *   - Hydration error (after lex/imports OK)  → error at top of file
 *   - matched (real bugs in both passes —     → error at source path
 *     including cross-treatment leaks, since
 *     the schema is strict by default)
 *   - sourceOnly (MIXED bucket — see          → warning at source path
 *     `runValidationDiff.ts`. Could be a
 *     templating artifact (e.g.
 *     template-injected refs that resolve
 *     post-fill, or refinements that fire
 *     pre-fill but pass on hydrated form),
 *     OR a real bug that didn't survive
 *     hydration into a matched pair — the
 *     classic case is a schema error inside
 *     an unused template definition. Path
 *     alone doesn't reliably distinguish.
 *     Warning severity reflects the
 *     uncertainty.)
 *   - hydratedOnly                            → not surfaced in source
 *                                               file; the expanded
 *                                               preview shows them
 *
 * `loadImport` is the editor's bridge to vscode.workspace.fs. Tests
 * pass a Map-backed mock.
 *
 * See #321 for the broader pipeline.
 */

export interface ValidateTreatmentDiffResult {
  diagnostics: Diagnostic[];
  /** The parsed-with-mapper JS object. null when YAML parse failed.
   *  Used by the file-existence checker. */
  parsedObj: unknown;
}

export async function validateTreatmentWithDiff({
  source,
  loadImport,
}: {
  source: string;
  loadImport: (importPath: string) => Promise<string>;
}): Promise<ValidateTreatmentDiffResult> {
  const diagnostics: Diagnostic[] = [];

  // YAML syntax + duplicate-key warnings (existing behavior, preserved
  // so we don't regress on noise-level diagnostics the orchestrator
  // doesn't cover).
  const yamlErrors = extractYamlErrors(source);
  let hasYamlParseError = false;
  for (const err of yamlErrors) {
    const isDuplicateKey = err.message.match(/unique|duplicate/i);
    if (!isDuplicateKey) hasYamlParseError = true;
    diagnostics.push({
      message: err.message,
      severity: isDuplicateKey ? "warning" : "error",
      range: {
        startLine: err.line,
        startCol: err.col,
        endLine: err.line,
        endCol: err.col + 1,
      },
    });
  }

  // Build the source-side AST mapper once. Used for every issue
  // routed to a source position.
  const mapper = createPositionMapper(source);
  const parsedObj = mapper.toJSON();

  // Short-circuit on YAML parse errors. `extractYamlErrors` already
  // surfaced precise line/col diagnostics; running the import loader
  // and orchestrator on malformed YAML would produce a duplicate
  // top-of-file error ("YAML parse error: ...") plus a parade of
  // downstream "couldn't expand" / "schema rejected" noise that's
  // already explained by the parse failure.
  if (hasYamlParseError) return { diagnostics, parsedObj };

  // Load imports asynchronously.
  const loadResult = await loadAndMergeImports({ source, loadImport });
  if (!loadResult.ok) {
    // Couldn't even load imports. Surface as a top-of-file error;
    // skip the rest of the pipeline (it'd just produce noise).
    diagnostics.push({
      message: loadResult.message,
      severity: "error",
      range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    });
    return { diagnostics, parsedObj };
  }

  // Compute the just-imported templates (slice past the root portion
  // of the merged list). `resolveImports` writes root templates first
  // then imports, so this gives us the orchestrator's expected
  // `importedTemplates` parameter shape.
  const rootParse = safeParseStagebookYaml(source);
  const rootTemplatesCount =
    rootParse !== null && Array.isArray(rootParse.parsed?.templates)
      ? rootParse.parsed.templates.length
      : 0;
  const importedTemplates = loadResult.templates.slice(rootTemplatesCount);

  // Pre-hydration semantic checks (template-name resolution, circular
  // invocations). Catches a class of errors the orchestrator's
  // hydration step would otherwise throw on generically.
  const preHydration = collectPreHydrationIssues({
    root: (loadResult.merged ?? {}) as Record<string, unknown>,
    importedTemplates,
  });
  for (const issue of preHydration) {
    diagnostics.push({
      message: issue.message,
      severity: "error",
      range: resolveOrWalkUp(mapper, issue.path),
    });
  }

  // Run the diff orchestrator.
  const diff = runValidationDiff({ source, importedTemplates });

  if (diff.hydrationError) {
    // Hydration failed. If pre-hydration semantic already explained
    // why (e.g., "Template 'foo' is not defined"), the generic
    // hydration error is redundant noise — pre-hydration is the more
    // specific diagnostic. Otherwise surface the hydration error at
    // top of file so the user has *something*.
    if (preHydration.length === 0) {
      diagnostics.push({
        message: diff.hydrationError,
        severity: "error",
        range: { startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      });
    }
    return { diagnostics, parsedObj };
  }

  // matched: real bugs in both passes. Source-positioned by virtue of
  // being a source-pass issue. Includes cross-treatment leaks now
  // that the schema is strict by default — both passes fire on a
  // leak, diff matches them, lands here.
  for (const issue of diff.matched) {
    diagnostics.push({
      message: appendPathIfMissing(issue),
      severity: "error",
      range: resolveIssueRange(mapper, issue),
    });
  }

  // sourceOnly: MIXED bucket — see `runValidationDiff.ts` for the full
  // contract. Two distinct kinds of issue land here:
  //
  //   (a) Templating artifacts. The classic case is a refinement that
  //       fires on the unfilled source but passes on the hydrated form
  //       (e.g., intro-step advancement-element rule on a template
  //       invocation that expands to a submitButton). Another common
  //       case is a reference whose producer lives in a template body
  //       — the strict reference check on source pass fires
  //       (templates not yet expanded), but the hydrated pass passes
  //       (templates injected the producer). These are not real bugs.
  //
  //   (b) Real bugs that didn't survive hydration into a matched pair.
  //       The classic case is a schema error inside an unused template
  //       definition: the source-pass schema flags it (template
  //       content is validated), but it has no hydrated counterpart
  //       (the template was never invoked, so no expansion-site
  //       instance to match against). These ARE real bugs.
  //
  // Path alone doesn't reliably tell (a) from (b) — the
  // advancement-element refinement can fire at a `templates[...]`
  // path too. Surface as warning to express the uncertainty without
  // overclaiming. The expanded-preview document still shows the full
  // hydrated-pass diagnostics for users who want to drill in.
  for (const issue of diff.sourceOnly) {
    diagnostics.push({
      message: appendPathIfMissing(issue),
      severity: "warning",
      range: resolveIssueRange(mapper, issue),
    });
  }

  return { diagnostics, parsedObj };
}

/**
 * Resolve a Zod issue to a source range, with special handling for
 * the unrecognized-key issues rewritten by `safeParseTreatmentFile`.
 *
 * Those issues carry `params.badKey` and the path ends at the
 * offending key string; the existing UnrecognizedKeyQuickFixProvider
 * expects a key-token range so its `replace(diagnostic.range,
 * suggestion)` correctly renames the key (rather than replacing the
 * value). Mirrors the logic in `validateTreatmentSource`.
 */
function resolveIssueRange(
  mapper: ReturnType<typeof createPositionMapper>,
  issue: ZodIssue,
): Diagnostic["range"] {
  const params =
    issue.code === "custom"
      ? ((issue as { params?: unknown }).params as
          | { badKey?: unknown }
          | undefined)
      : undefined;
  const isUnrecognizedKey =
    params !== undefined && typeof params.badKey === "string";
  if (isUnrecognizedKey) {
    const keyRange = mapper.resolveKey(issue.path);
    if (keyRange) return keyRange;
    // Fall through to the value/walk-up resolver when resolveKey can't
    // pin a key range.
  }
  return resolveOrWalkUp(mapper, issue.path);
}

/**
 * Resolve a path to a source range; if the exact path doesn't
 * resolve (e.g., a hydrated path that points inside a template-
 * expanded subtree the source doesn't contain), walk up one segment
 * at a time and retry. As a last resort, return a top-of-file range.
 */
function resolveOrWalkUp(
  mapper: ReturnType<typeof createPositionMapper>,
  path: (string | number)[],
): Diagnostic["range"] {
  let p = path;
  let range = mapper.resolve(p);
  while (!range && p.length > 0) {
    p = p.slice(0, -1);
    range = mapper.resolve(p);
  }
  return range ?? { startLine: 0, startCol: 0, endLine: 0, endCol: 1 };
}

/**
 * Append the field path to a Zod issue's message so the user has
 * locational context even when the diagnostic position is approximate
 * (e.g., walk-up landed on the enclosing treatment for a hydrated
 * path). Mirrors the existing `validateTreatmentSource` behavior.
 */
function appendPathIfMissing(issue: ZodIssue | PreHydrationIssue): string {
  const pathStr = formatPath(issue.path);
  if (!pathStr || issue.message.toLowerCase().includes(pathStr.toLowerCase())) {
    return issue.message;
  }
  return `${issue.message} (${pathStr})`;
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "";
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else {
      out += out ? `.${segment}` : segment;
    }
  }
  return out;
}

/**
 * Best-effort parse of the root source for the purpose of counting
 * root-level templates. Returns null on parse failure (in which case
 * the caller treats root.templates as empty).
 */
function safeParseStagebookYaml(
  source: string,
): { parsed: { templates?: unknown } } | null {
  try {
    return parseStagebookYaml(source) as {
      parsed: { templates?: unknown };
    };
  } catch {
    return null;
  }
}
