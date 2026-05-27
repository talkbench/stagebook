import { safeParseTreatmentFile } from "../index.js";
import { createPositionMapper, extractYamlErrors } from "./yamlPositionMap.js";
import type { Diagnostic } from "./types.js";

export type { Diagnostic };

export interface ValidationResult {
  diagnostics: Diagnostic[];
  /** The parsed JS object, or null if YAML parsing failed fatally. */
  parsedObj: unknown;
}

/**
 * Validate a treatment YAML source string.
 *
 * Returns diagnostics with source positions and the parsed object.
 * This is a pure function — no VS Code dependency.
 *
 * The schema validates the original (unexpanded) object directly,
 * since treatmentFileSchema uses altTemplateContext() and accepts
 * both concrete objects and template contexts at every level.
 */
export function validateTreatmentSource(source: string): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  // Step 1: Check for YAML syntax errors and duplicate keys
  const yamlErrors = extractYamlErrors(source);
  for (const err of yamlErrors) {
    diagnostics.push({
      message: err.message,
      severity: err.message.match(/unique|duplicate/i) ? "warning" : "error",
      range: {
        startLine: err.line,
        startCol: err.col,
        endLine: err.line,
        endCol: err.col + 1,
      },
    });
  }

  // Step 2: Parse into AST (for position mapping) and JS object (for Zod)
  const mapper = createPositionMapper(source);
  const parsedObj = mapper.toJSON();

  // Step 3: Validate with stagebook's treatmentFileSchema (via the
  // wrapper that rewrites `unrecognized_keys` issues into rich
  // per-key "Did you mean …?" diagnostics — see #123).
  // Pass whatever was parsed (even null/scalar) — Zod produces clear
  // "Expected object, received ..." messages for non-object input.
  const result = safeParseTreatmentFile(parsedObj);

  if (!result.success) {
    for (const issue of result.error.issues) {
      // Unrecognized-key issues (rewritten by safeParseTreatmentFile) end
      // their path at the offending key string and carry a `params.badKey`
      // marker. Resolve them as KEY-token ranges so the squiggle lands on
      // `survyName:`, not on its value — and so the quick-fix's
      // `replace(diagnostic.range, suggestion)` correctly renames the key.
      const params =
        issue.code === "custom"
          ? ((issue as { params?: unknown }).params as
              | { badKey?: unknown }
              | undefined)
          : undefined;
      const isUnrecognizedKey =
        params !== undefined && typeof params.badKey === "string";

      let range = isUnrecognizedKey
        ? mapper.resolveKey(issue.path)
        : mapper.resolve(issue.path);
      let ancestorPath = issue.path;
      // If the exact path doesn't resolve (e.g., "Required" errors on
      // missing fields, or a key-token resolve that fell through), walk up
      // to the nearest ancestor whose value range we can find.
      while (!range && ancestorPath.length > 0) {
        ancestorPath = ancestorPath.slice(0, -1);
        range = mapper.resolve(ancestorPath);
      }

      // Append the field path to every diagnostic so the user always knows
      // which field the error refers to. Zod messages often omit the field
      // name (e.g., "Required", "Expected number, received string"), and
      // even when they include it, the full path gives hierarchical context.
      // Skipped only when the path is already present verbatim in the message.
      const pathStr = formatPath(issue.path);
      const message =
        pathStr && !issue.message.toLowerCase().includes(pathStr.toLowerCase())
          ? `${issue.message} (${pathStr})`
          : issue.message;

      diagnostics.push({
        message,
        severity: "error",
        range,
      });
    }
  }

  return { diagnostics, parsedObj };
}

/**
 * Format a Zod issue path as a readable dotted string.
 * Array indices are shown in brackets: ["treatments", 0, "gameStages", 1] → "treatments[0].gameStages[1]"
 */
function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return "";
  let result = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else {
      result += result ? `.${segment}` : segment;
    }
  }
  return result;
}
