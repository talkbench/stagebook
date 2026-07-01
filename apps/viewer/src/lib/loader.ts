import { parseGitHubUrl } from "./github";
import { expandTreatmentFile } from "./expandTreatmentFile";
import { safeParseTreatmentFile, type TreatmentFileType } from "stagebook";
import {
  loadAndMergeImports,
  validateTreatmentWithDiff,
} from "stagebook/validate";
import type { ViewerDiagnostic } from "./diagnostics";

export interface LoadResult {
  /**
   * The parsed + expanded treatment file, or `null` when the file has errors
   * that prevent it from rendering (YAML syntax, schema violations). When
   * null, `diagnostics` explains why and the caller shows a placeholder.
   */
  treatmentFile: TreatmentFileType | null;
  /**
   * Validation diagnostics — the same import-aware, positioned diagnostics the
   * VS Code extension shows in its Problems panel: schema errors (including
   * inside imported templates), template artifacts downgraded to warnings after
   * hydration, YAML/duplicate-key issues, post-fill schema, and prompt
   * locale-consistency. Empty for a clean file. Present even when
   * `treatmentFile` is set (warnings, and non-structural errors like locale
   * mismatches, don't block rendering).
   */
  diagnostics: ViewerDiagnostic[];
  unresolvedFields: string[];
  rawBaseUrl: string;
}

type FetchFn = (
  url: string,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Load a treatment file from a GitHub URL, resolving any `imports:`
 * against the same repo and branch as the entry-point file (#312), and
 * surfacing validation diagnostics on load (#440).
 *
 * Diagnostics come from `validateTreatmentWithDiff` — the same import-aware,
 * diff-based validator the VS Code extension drives its Problems panel from —
 * so the messages, positions, and severities match the editor exactly (a
 * template that injects an advancement element shows as a warning, not an
 * error; a schema slip inside an imported template is reported; etc.).
 *
 * Validation is non-fatal: a file with only warnings still renders (warnings
 * ride along in `diagnostics`); a file with structural errors returns a null
 * `treatmentFile` plus the diagnostics that explain why. Only failure to fetch
 * the entry file or one of its imports throws — those aren't file-content
 * diagnostics.
 *
 * Accepts an injectable fetch function for testing.
 */
export async function loadTreatmentFromUrl(
  githubUrl: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<LoadResult> {
  const { rawFileUrl, rawBaseUrl, filePath } = parseGitHubUrl(githubUrl);

  // Cache-bust: raw.githubusercontent.com has aggressive CDN caching
  const bustUrl = `${rawFileUrl}?t=${Date.now()}`;
  const response = await fetchFn(bustUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch treatment file (HTTP ${response.status}): ${rawFileUrl}`,
    );
  }

  const rootYaml = await response.text();

  // Fetch each `imports:` from the same repo + branch as the entry-point file.
  // Memoized so the two passes below (diff validation, then the merge for the
  // render object) — plus the validator's own prompt locale-consistency fetches
  // — hit the network at most once per path.
  const importCache = new Map<string, Promise<string>>();
  const loadImport = (canonicalPath: string): Promise<string> => {
    let pending = importCache.get(canonicalPath);
    if (!pending) {
      pending = (async () => {
        const importUrl = `${rawBaseUrl}${canonicalPath}?t=${Date.now()}`;
        const importResponse = await fetchFn(importUrl);
        if (!importResponse.ok) {
          throw new Error(
            `Failed to fetch imported file '${canonicalPath}' (HTTP ${importResponse.status}) — ` +
              `make sure the file exists in the same repo as the entry-point file. ` +
              `Tried: ${rawBaseUrl}${canonicalPath}`,
          );
        }
        return importResponse.text();
      })();
      importCache.set(canonicalPath, pending);
    }
    return pending;
  };

  // Merge imports for the render object. A genuine import fetch/parse/merge
  // failure is a network/structural problem the author resolves outside this
  // file, so it stays a hard error (Retry-able) — unlike a root YAML syntax
  // error (`stage: "parse"`), which we surface as a positioned diagnostic.
  const loadResult = await loadAndMergeImports({
    source: rootYaml,
    loadImport,
  });
  if (!loadResult.ok && loadResult.stage !== "parse") {
    throw new Error(loadResult.message);
  }

  // Positioned diagnostics from the extension's validator (see the doc comment).
  // Tagged with the entry file's display path so the panel can attribute them.
  const diagnostics: ViewerDiagnostic[] = (
    await validateTreatmentWithDiff({ source: rootYaml, loadImport })
  ).diagnostics.map((d) => ({ ...d, file: filePath }));

  // Root YAML couldn't be parsed — nothing renders; `diagnostics` carries the
  // positioned reason.
  if (!loadResult.ok) {
    return {
      treatmentFile: null,
      diagnostics,
      unresolvedFields: [],
      rawBaseUrl,
    };
  }

  // Build the render object. Normally we render the schema-validated merged
  // object; but when the pre-fill schema rejects it while the diff validator
  // found no error (only warnings), the rejection is a template artifact that
  // resolves on hydration — e.g. a step whose only advancement element is
  // injected by a template invocation. Expand from the merged object in that
  // case so the preview still opens. A real structural error keeps the
  // placeholder.
  const parsed = safeParseTreatmentFile(loadResult.merged);
  const hasError = diagnostics.some((d) => d.severity === "error");
  const expandInput: TreatmentFileType | null = parsed.success
    ? parsed.data
    : hasError
      ? null
      : (loadResult.merged as TreatmentFileType);
  if (expandInput === null) {
    return {
      treatmentFile: null,
      diagnostics,
      unresolvedFields: [],
      rawBaseUrl,
    };
  }

  try {
    const { result, unresolvedFields } = expandTreatmentFile(expandInput);
    return { treatmentFile: result, diagnostics, unresolvedFields, rawBaseUrl };
  } catch {
    // Expansion blew up on a structurally-broken object the diff validator
    // didn't flag as blocking — fall back to the placeholder rather than crash.
    return {
      treatmentFile: null,
      diagnostics,
      unresolvedFields: [],
      rawBaseUrl,
    };
  }
}
