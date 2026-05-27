import {
  fillTemplates,
  treatmentFileSchema,
  type TreatmentFileType,
} from "../index.js";
import {
  loadAndMergeImports,
  type LoadFailureStage,
} from "./loadAndMergeImports.js";

/**
 * Stage at which parsing/expanding/validating failed.
 *
 * - `parse`         — root YAML parse failed
 * - `import-read`   — an imported file couldn't be read by `loadImport`
 * - `import-parse`  — an imported file's YAML parse failed
 * - `resolve`       — `resolveImports` threw while merging templates
 * - `hydration`     — `fillTemplates` threw (most commonly: template name
 *                     not defined in this file or its imports)
 * - `schema`        — the hydrated form failed schema validation
 */
export type ParseFailureStage = LoadFailureStage | "hydration" | "schema";

export type ParseResult =
  | { ok: true; data: TreatmentFileType }
  | { ok: false; stage: ParseFailureStage; message: string };

/**
 * Host-agnostic core of the treatment-file preview pipeline. Loads imports
 * (via the supplied callback), merges them, runs `fillTemplates`, and
 * validates against `treatmentFileSchema`.
 *
 * Each failure mode returns `{ ok: false, stage, message }` rather than
 * a null/undefined so callers can surface specific text instead of a
 * generic "could not parse" notification. This replaces the previous
 * behavior of `parseTreatmentForPreview` in extension.ts which silently
 * swallowed every error — the root cause of #321 Repro 1.
 *
 * `loadImport` is the host's bridge to its filesystem. In VS Code it
 * wraps `vscode.workspace.fs.readFile`; in tests it's a Map-based mock.
 * Throw or reject on failure; the caller will tag it as `import-read`.
 *
 * See #321 for the broader validation pipeline this is part of.
 */
export async function parseTreatmentSource({
  source,
  loadImport,
}: {
  source: string;
  loadImport: (importPath: string) => Promise<string>;
}): Promise<ParseResult> {
  const loadResult = await loadAndMergeImports({ source, loadImport });
  if (!loadResult.ok) return loadResult;

  // Always pass through fillTemplates, even when there are zero templates,
  // so unresolved `template:` invocations always surface as a real
  // "Template not found" error. (Per #321 Repro 2: the previous
  // `templates.length > 0` gate let invocations silently pass through.)
  let expanded: Record<string, unknown>;
  try {
    const { result } = fillTemplates({
      obj: loadResult.merged,
      templates: loadResult.templates,
      allowUnresolved: true,
    });
    expanded = result as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      stage: "hydration",
      message: `Template expansion failed: ${errorMessage(e)}`,
    };
  }

  const parsed = treatmentFileSchema.safeParse(expanded);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message = firstIssue
      ? `Schema validation failed at ${formatPath(firstIssue.path)}: ${firstIssue.message}`
      : "Schema validation failed";
    return { ok: false, stage: "schema", message };
  }
  return { ok: true, data: parsed.data };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function formatPath(p: (string | number)[]): string {
  if (p.length === 0) return "(root)";
  return p
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : seg))
    .join(".")
    .replace(/\.\[/g, "[");
}
