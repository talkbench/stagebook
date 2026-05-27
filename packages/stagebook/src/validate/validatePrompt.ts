import { promptFileSchema } from "../index.js";
import type { SourceRange } from "./yamlPositionMap.js";
import type { Diagnostic } from "./types.js";

export interface PromptValidationResult {
  diagnostics: Diagnostic[];
}

/**
 * Find the 0-based line numbers of all `---` delimiters in the source.
 */
function findDelimiterLines(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const result: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^-{3,}$/.test(lines[i])) {
      result.push(i);
    }
  }
  return result;
}

/**
 * Map a Zod issue path from promptFileSchema to a source line range.
 *
 * promptFileSchema produces paths like:
 * - [] — structural errors (missing delimiters)
 * - ["metadata", "type"] — metadata field errors
 * - ["body"] — body section errors
 * - ["responses"] — response format errors
 */
function mapPromptErrorToRange(
  source: string,
  path: (string | number)[],
  delimiters: number[],
): SourceRange | null {
  if (delimiters.length < 2) {
    // Need at least the frontmatter open + close to localize anything.
    return { startLine: 0, startCol: 0, endLine: 0, endCol: 1 };
  }

  const [metaStart, metaEnd] = delimiters;
  // For 2-section (`noResponse`) files there's no response delimiter; fall
  // back to "end of frontmatter" for any response-section path.
  const responseStart = delimiters[2] ?? metaEnd;

  if (path.length === 0) {
    return { startLine: 0, startCol: 0, endLine: 0, endCol: 1 };
  }

  const section = path[0];

  if (section === "metadata") {
    // Map to the metadata section (between first and second ---)
    // If we have a specific field name, try to find it
    if (path.length >= 2 && typeof path[1] === "string") {
      const fieldName = path[1];
      const lines = source.split(/\r?\n/);
      for (let i = metaStart + 1; i < metaEnd; i++) {
        if (lines[i] && lines[i].trimStart().startsWith(fieldName + ":")) {
          return {
            startLine: i,
            startCol: 0,
            endLine: i,
            endCol: lines[i].length,
          };
        }
      }
    }
    // Fall back to the metadata section start (clamp for empty sections)
    const metaFallbackLine = Math.min(metaStart + 1, metaEnd);
    return {
      startLine: metaFallbackLine,
      startCol: 0,
      endLine: metaFallbackLine,
      endCol: 1,
    };
  }

  if (section === "body") {
    // Clamp for empty body (adjacent delimiters)
    const bodyLine = Math.min(metaEnd + 1, responseStart);
    return {
      startLine: bodyLine,
      startCol: 0,
      endLine: bodyLine,
      endCol: 1,
    };
  }

  if (section === "responses") {
    // Map to the response section (after the third ---)
    return {
      startLine: responseStart + 1,
      startCol: 0,
      endLine: responseStart + 1,
      endCol: 1,
    };
  }

  return null;
}

/**
 * Validate a prompt markdown source string.
 *
 * Returns diagnostics with source positions.
 * This is a pure function — no VS Code dependency.
 */
export function validatePromptSource(source: string): PromptValidationResult {
  const diagnostics: Diagnostic[] = [];
  const delimiters = findDelimiterLines(source);

  // Warn about extra delimiters (likely horizontal rule attempts)
  if (delimiters.length > 3) {
    for (let i = 3; i < delimiters.length; i++) {
      diagnostics.push({
        message:
          "Extra --- delimiter found. If you want a horizontal rule, use *** or ___ instead — three dashes are used to separate prompt sections.",
        severity: "warning",
        range: {
          startLine: delimiters[i],
          startCol: 0,
          endLine: delimiters[i],
          endCol: 3,
        },
      });
    }
  }

  // Validate with stagebook's promptFileSchema
  const result = promptFileSchema.safeParse(source);

  if (!result.success) {
    for (const issue of result.error.issues) {
      // Zod's `unrecognized_keys` puts the bad keys in `issue.keys` and
      // leaves `issue.path` pointing at the parent object. Synthesize a
      // path that includes the bad key so `mapPromptErrorToRange` can
      // find its source line.
      let issuePath = issue.path;
      if (
        issue.code === "unrecognized_keys" &&
        Array.isArray((issue as { keys?: unknown[] }).keys) &&
        (issue as { keys: string[] }).keys.length > 0
      ) {
        issuePath = [...issue.path, (issue as { keys: string[] }).keys[0]];
      }
      const range = mapPromptErrorToRange(source, issuePath, delimiters);
      diagnostics.push({
        message: issue.message,
        severity: "error",
        range,
      });
    }
  }

  return { diagnostics };
}
