import { fillTemplates } from "../index.js";
import { parse, stringify } from "yaml";
import { loadAndMergeImports } from "./loadAndMergeImports.js";

const DEFAULT_MAX_LINES = 5000;
const DEFAULT_MAX_BROADCAST = 10000;

export interface ExpandResult {
  /** The expanded YAML string as displayed (possibly truncated), or "" on error. */
  yaml: string;
  /**
   * The full, untruncated expanded YAML. Equal to `yaml` when no truncation
   * was needed. Consumers that need to validate the complete expansion
   * (rather than its truncated display form) should use this.
   */
  fullYaml: string;
  /** Error message if expansion failed, null on success. */
  error: string | null;
  /** Whether the output was truncated due to line limit. */
  truncated: boolean;
}

export interface ExpandOptions {
  maxLines?: number;
  maxBroadcastProduct?: number;
}

/**
 * Walk the parsed object looking for broadcast dimensions and estimate
 * the total Cartesian product size. Returns an error message if it
 * exceeds the limit, or null if it's within bounds.
 */
function checkBroadcastSize(obj: unknown, limit: number): string | null {
  let totalProduct = 0;

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;

    if (
      typeof record.template === "string" &&
      record.broadcast &&
      typeof record.broadcast === "object"
    ) {
      const dims = record.broadcast as Record<string, unknown>;
      let product = 1;
      for (const dim of Object.values(dims)) {
        if (Array.isArray(dim)) product *= dim.length;
      }
      totalProduct += product;
    }

    for (const value of Object.values(record)) {
      walk(value);
    }
  }

  walk(obj);

  if (totalProduct > limit) {
    return `Broadcast expansion would produce ~${totalProduct} items (limit: ${limit}). Reduce broadcast dimensions or increase the limit.`;
  }
  return null;
}

/**
 * Expand all templates in a treatment YAML source string.
 *
 * Returns the fully expanded YAML with the `templates` key removed.
 * This is a pure function — no VS Code dependency.
 */
export function expandTreatmentSource(
  source: string,
  options?: ExpandOptions,
): ExpandResult {
  const maxLines = options?.maxLines ?? DEFAULT_MAX_LINES;

  // Parse YAML
  let obj: unknown;
  try {
    obj = parse(source);
  } catch (e) {
    return {
      yaml: "",
      fullYaml: "",
      error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    };
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return {
      yaml: "",
      fullYaml: "",
      error:
        "Treatment file must be a YAML mapping (object), not a scalar or array.",
      truncated: false,
    };
  }

  const record = obj as Record<string, unknown>;

  if (record.templates !== undefined && !Array.isArray(record.templates)) {
    return {
      yaml: "",
      fullYaml: "",
      error: "The 'templates' key must be an array.",
      truncated: false,
    };
  }

  const templates = (record.templates ?? []) as unknown[];

  // Guard against combinatorial explosion from large broadcast dimensions.
  // Estimate the total product size before expanding.
  const broadcastLimit = options?.maxBroadcastProduct ?? DEFAULT_MAX_BROADCAST;
  const sizeError = checkBroadcastSize(record, broadcastLimit);
  if (sizeError) {
    return { yaml: "", fullYaml: "", error: sizeError, truncated: false };
  }

  // Always pass through fillTemplates so unresolved `template:` invocations
  // always surface as a "Template not found" error, even when there are
  // zero root-level templates (the common case once #277 imports landed —
  // see #321 Repro 2). The previous `templates.length > 0` gate silently
  // returned the source unchanged in that case.
  let expanded: Record<string, unknown>;
  try {
    const { result } = fillTemplates({
      obj: record,
      templates,
      allowUnresolved: true,
    });
    expanded = result as Record<string, unknown>;
  } catch (e) {
    return {
      yaml: "",
      fullYaml: "",
      error: `Template expansion failed: ${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    };
  }

  // Remove templates key from output
  delete expanded.templates;

  // Serialize back to YAML
  let yaml: string;
  try {
    yaml = stringify(expanded, { indent: 2, lineWidth: 0 });
  } catch (e) {
    return {
      yaml: "",
      fullYaml: "",
      error: `YAML serialization failed: ${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    };
  }

  // Truncate if over the line limit
  const lines = yaml.split("\n");
  if (lines.length > maxLines) {
    const truncatedYaml = lines.slice(0, maxLines).join("\n");
    return {
      yaml:
        truncatedYaml +
        `\n\n# --- Output truncated at ${maxLines} lines (${lines.length} total) ---`,
      fullYaml: yaml,
      error: null,
      truncated: true,
    };
  }

  return { yaml, fullYaml: yaml, error: null, truncated: false };
}

/**
 * Like `expandTreatmentSource`, but loads `imports:` through the supplied
 * callback before expanding. Returns the same `ExpandResult` shape — the
 * caller can't tell whether imports were involved.
 *
 * Used by the "View Expanded Templates" provider so the expanded preview
 * shows the actual resolution of cross-file template invocations (the
 * second half of #321 Repro 2; without imports loaded, the expander
 * surfaces "Template not found" for templates that live in module files).
 *
 * Import-loading errors (missing/unreadable file, malformed YAML in an
 * import, merge failure) are surfaced in the result's `error` field so
 * the preview shows them as commented banners — same channel as
 * expansion errors.
 */
export async function expandTreatmentSourceWithImports({
  source,
  loadImport,
  options,
}: {
  source: string;
  loadImport: (importPath: string) => Promise<string>;
  options?: ExpandOptions;
}): Promise<ExpandResult> {
  const loadResult = await loadAndMergeImports({ source, loadImport });
  if (!loadResult.ok) {
    return {
      yaml: "",
      fullYaml: "",
      error: loadResult.message,
      truncated: false,
    };
  }
  let mergedYaml: string;
  try {
    mergedYaml = stringify(loadResult.merged, { indent: 2, lineWidth: 0 });
  } catch (e) {
    return {
      yaml: "",
      fullYaml: "",
      error: `YAML serialization failed: ${e instanceof Error ? e.message : String(e)}`,
      truncated: false,
    };
  }
  return expandTreatmentSource(mergedYaml, options);
}
