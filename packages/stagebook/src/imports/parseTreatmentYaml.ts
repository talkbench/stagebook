import { load, type LoadOptions } from "js-yaml";

/**
 * Parse a Stagebook YAML source string and extract its `imports:`
 * declarations as a separate field.
 *
 * Surfacing `imports:` here means hosts never have to peek into
 * Stagebook's schema to discover what other files they need to load
 * — they just feed the array into their loading loop:
 *
 *     const { parsed, imports } = parseTreatmentYaml(text);
 *     for (const importPath of imports) {
 *       const child = await loadFile(resolveImportPath(thisPath, importPath));
 *       // ...
 *     }
 *
 * Hosts that prefer their own parser (JSON, TOML, DB-backed) can
 * skip this function and feed already-parsed objects to
 * `resolveImports` directly. Just make sure to extract `imports:`
 * yourself and recurse before merging.
 *
 * **YAML config:** uses js-yaml's safe `load` (no constructors, no
 * arbitrary code execution). Does *not* enable YAML 1.1's implicit
 * boolean parsing (which would turn `country: NO` into `country: false`
 * — the "Norway problem"). Stagebook's grammar is JSON-compatible
 * for scalars; if you need richer YAML semantics, parse separately.
 */
export interface ParsedTreatmentFile {
  /** The parsed object — typed loosely; full validation happens later. */
  parsed: Record<string, unknown>;
  /** The list of import paths declared at the top level, or [] if none. */
  imports: string[];
}

const SAFE_YAML_OPTS: LoadOptions = {
  // Default schema; no custom constructors. js-yaml's `load` is safe
  // by default in v4+ — kept explicit for documentation.
};

export function parseTreatmentYaml(yamlString: string): ParsedTreatmentFile {
  const raw = load(yamlString, SAFE_YAML_OPTS);

  if (raw === null || raw === undefined) {
    return { parsed: {}, imports: [] };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      "Stagebook file must parse to an object at the top level. " +
        `Got ${Array.isArray(raw) ? "array" : typeof raw}.`,
    );
  }

  const parsed = raw as Record<string, unknown>;
  const imports = extractImports(parsed.imports);
  return { parsed, imports };
}

function extractImports(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(
      "`imports:` must be an array of relative path strings, e.g. " +
        "`imports: [./surveys/tipi/tipi.stagebook.yaml]`. " +
        `Got ${typeof value}.`,
    );
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(
        "Every `imports:` entry must be a non-empty string. " +
          `Got ${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}.`,
      );
    }
    result.push(entry);
  }
  return result;
}
