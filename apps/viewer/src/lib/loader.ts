import { parseGitHubUrl } from "./github";
import { expandTreatmentFile } from "./expandTreatmentFile";
import { TreatmentValidationError } from "./treatment";
import { safeParseTreatmentFile, type TreatmentFileType } from "stagebook";
import { loadAndMergeImports } from "stagebook/validate";

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

  return { treatmentFile: result, unresolvedFields, rawBaseUrl };
}
