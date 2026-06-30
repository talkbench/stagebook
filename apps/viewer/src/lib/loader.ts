import { parseGitHubUrl } from "./github";
import { expandTreatmentFile } from "./expandTreatmentFile";
import { TreatmentValidationError } from "./treatment";
import { safeParseTreatmentFile, type TreatmentFileType } from "stagebook";
import {
  loadAndMergeImports,
  checkPromptLocaleConsistencyWithLoader,
} from "stagebook/validate";

export interface LoadResult {
  treatmentFile: TreatmentFileType;
  unresolvedFields: string[];
  rawBaseUrl: string;
}

type FetchFn = (
  url: string,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Load a treatment file from a GitHub URL, resolving any `imports:`
 * against the same repo and branch as the entry-point file (#312).
 * Accepts an injectable fetch function for testing.
 */
export async function loadTreatmentFromUrl(
  githubUrl: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<LoadResult> {
  const { rawFileUrl, rawBaseUrl } = parseGitHubUrl(githubUrl);

  // Cache-bust: raw.githubusercontent.com has aggressive CDN caching
  const bustUrl = `${rawFileUrl}?t=${Date.now()}`;
  const response = await fetchFn(bustUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch treatment file (HTTP ${response.status}): ${rawFileUrl}`,
    );
  }

  const rootYaml = await response.text();

  // Fetch each `imports:` from the same repo + branch as the entry-point
  // file. `canonicalPath` is POSIX-normalized (e.g. `modules/foo.stagebook.yaml`),
  // and `rawBaseUrl` already has a trailing slash, so concatenation produces
  // a valid raw.githubusercontent.com URL.
  const loadImport = async (canonicalPath: string): Promise<string> => {
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
  };

  // `loadAndMergeImports` (from stagebook/validate) parses the root YAML,
  // recursively fetches every imported file via `loadImport`, and returns
  // a discriminated result with the merged object (`imports:` stripped,
  // `templates:` replaced by the merged set). It does not validate
  // against `treatmentFileSchema` — we do that here so validation errors
  // come through the same `TreatmentValidationError` path as the
  // local-YAML flow.
  const loadResult = await loadAndMergeImports({
    source: rootYaml,
    loadImport,
  });
  if (!loadResult.ok) {
    throw new Error(loadResult.message);
  }
  const parsed = safeParseTreatmentFile(loadResult.merged);
  if (!parsed.success) {
    throw new TreatmentValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    );
  }

  const { result, unresolvedFields } = expandTreatmentFile(parsed.data);

  // Post-hydration locale-consistency rule (ADR 2026-06-localization #6):
  // every referenced prompt's frontmatter `locale` must match its container's
  // `locale` (both default `en`). Runs on the hydrated tree, fetching each
  // prompt's frontmatter from the same repo + branch as the entry-point file.
  // Surfaced through the same `TreatmentValidationError` path as schema errors
  // so it shows up in the preview's validation UI. Unreadable / unparseable
  // prompts return null and are skipped — those failures surface elsewhere.
  const loadPrompt = async (relPath: string): Promise<string | null> => {
    const promptResponse = await fetchFn(
      `${rawBaseUrl}${relPath}?t=${Date.now()}`,
    );
    return promptResponse.ok ? promptResponse.text() : null;
  };
  const localeMismatches = await checkPromptLocaleConsistencyWithLoader({
    fileObj: result,
    loadPrompt,
  });
  if (localeMismatches.length > 0) {
    throw new TreatmentValidationError(
      localeMismatches.map((mismatch) => ({
        path: mismatch.promptFile,
        message: mismatch.message,
      })),
    );
  }

  return { treatmentFile: result, unresolvedFields, rawBaseUrl };
}
