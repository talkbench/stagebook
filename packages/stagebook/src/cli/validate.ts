import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";
import { parseArgs } from "node:util";
import { text as readStream } from "node:stream/consumers";
import { glob } from "tinyglobby";

import type { Diagnostic } from "../validate/index.js";
import {
  validateTreatmentSource,
  validatePromptSource,
  expandAndValidateWithImports,
} from "../validate/index.js";
import { load as loadYaml } from "js-yaml";
import {
  fileSchema,
  promptFileSchema,
  collectReferencedPromptFiles,
  checkPromptLocaleConsistency,
} from "../index.js";

export type Format = "text" | "json";
export type FileType = "treatment" | "prompt";

export interface RunOptions {
  argv: string[];
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd?: string;
}

export interface FileResult {
  path: string;
  type: FileType;
  diagnostics: Diagnostic[];
  unreadable?: string;
}

const USAGE = `Usage: stagebook validate [options] <files...>

Validate Stagebook treatment files (.stagebook.yaml) and prompt files
(.prompt.md). Dispatches by suffix; for stdin, pass '-' and --type.

Options:
  --format=<text|json>   Output format. Default: text.
  --type=<treatment|prompt>
                         Required when reading from stdin ('-').
  --no-expand            Skip template expansion + import resolution
                         for treatment files. Catches fewer errors;
                         default is expand-and-validate.
  --allow-empty          Exit 0 when a glob matches no files instead
                         of exit 2.
  -h, --help             Print this message.

Exit codes:
  0   No errors (warnings OK, or nothing to report).
  1   At least one error in at least one file.
  2   A file couldn't be read, YAML was unparseable, a glob matched
      zero files (override with --allow-empty), or argv was invalid.

Examples:
  stagebook validate study.stagebook.yaml prompt.prompt.md
  stagebook validate 'stagebook/**/*.stagebook.yaml'
  cat foo.stagebook.yaml | stagebook validate --type=treatment -
  stagebook validate --format=json study.stagebook.yaml
`;

export async function run({
  argv,
  stdin,
  stdout,
  stderr,
  cwd = process.cwd(),
}: RunOptions): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        format: { type: "string", default: "text" },
        type: { type: "string" },
        "no-expand": { type: "boolean", default: false },
        "allow-empty": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (err) {
    stderr.write(
      `Error: ${err instanceof Error ? err.message : String(err)}\n\n`,
    );
    stderr.write(USAGE);
    return 2;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (positionals.length === 0) {
    stderr.write("Error: no file paths or stdin marker ('-') provided.\n\n");
    stderr.write(USAGE);
    return 2;
  }

  const format = values.format;
  if (format !== "text" && format !== "json") {
    stderr.write(
      `Error: --format must be 'text' or 'json' (got '${String(format)}').\n`,
    );
    return 2;
  }

  // Expand globs (filesystem paths). Stdin ('-') and literal-path positionals
  // are passed through; literal paths that don't exist surface as
  // per-file "could not read" results so other inputs still validate.
  const inputs: string[] = [];
  for (const positional of positionals) {
    if (positional === "-") {
      inputs.push("-");
      continue;
    }
    if (!hasGlobChars(positional)) {
      inputs.push(positional);
      continue;
    }
    const matched = await glob([positional], {
      cwd,
      onlyFiles: true,
      dot: false,
    });
    if (matched.length === 0) {
      if (values["allow-empty"]) continue;
      stderr.write(
        `Error: glob '${positional}' matched no files (override with --allow-empty).\n`,
      );
      return 2;
    }
    inputs.push(...matched);
  }

  if (inputs.length === 0) {
    // All inputs were `--allow-empty`-suppressed globs that matched nothing.
    return 0;
  }

  const results: FileResult[] = [];
  let unreadable = false;
  for (const input of inputs) {
    let source: string;
    let fileType: FileType;
    let displayPath: string;

    if (input === "-") {
      const typeArg = values.type;
      if (typeArg !== "treatment" && typeArg !== "prompt") {
        stderr.write(
          "Error: stdin ('-') requires --type=treatment or --type=prompt.\n",
        );
        return 2;
      }
      fileType = typeArg;
      try {
        source = await readStream(stdin);
      } catch (err) {
        stderr.write(
          `Error reading stdin: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        return 2;
      }
      displayPath = "<stdin>";
    } else {
      const absPath = isAbsolute(input) ? input : resolvePath(cwd, input);
      const detected = detectFileType(input);
      if (!detected) {
        results.push({
          path: input,
          type: "treatment",
          diagnostics: [],
          unreadable: `unknown file type (expected .stagebook.yaml or .prompt.md)`,
        });
        unreadable = true;
        continue;
      }
      fileType = detected;
      try {
        source = await readFile(absPath, "utf8");
      } catch (err) {
        results.push({
          path: input,
          type: fileType,
          diagnostics: [],
          unreadable: `could not read: ${err instanceof Error ? err.message : String(err)}`,
        });
        unreadable = true;
        continue;
      }
      displayPath = input;
    }

    if (fileType === "prompt") {
      const result = validatePromptSource(source);
      results.push({
        path: displayPath,
        type: "prompt",
        diagnostics: result.diagnostics,
      });
      continue;
    }

    // Treatment file
    const noExpand = values["no-expand"] === true;
    if (noExpand || displayPath === "<stdin>") {
      const result = validateTreatmentSource(source);
      results.push({
        path: displayPath,
        type: "treatment",
        diagnostics: result.diagnostics,
      });
      continue;
    }

    // Default: expand templates (resolving imports relative to the file's
    // own directory) and validate the expansion. Catches errors that only
    // surface after template substitution and import merging.
    const dir = dirname(resolvePath(cwd, displayPath));
    const result = await expandAndValidateWithImports({
      source,
      loadImport: async (importPath: string) => {
        const target = isAbsolute(importPath)
          ? importPath
          : resolvePath(dir, importPath);
        return await readFile(target, "utf8");
      },
    });
    const diagnostics: Diagnostic[] = result.expandError
      ? [
          {
            severity: "error",
            message: `Template expansion failed: ${result.expandError}`,
            range: null,
          },
          ...result.diagnostics,
        ]
      : result.diagnostics;

    // Post-hydration locale-consistency rule (ADR 2026-06-localization #6):
    // each referenced prompt's frontmatter `locale` must match its
    // treatment's `locale` (both default `en`). Cross-file by nature, so it
    // runs here where the referenced prompt files are readable from disk.
    if (!result.expandError) {
      diagnostics.push(
        ...(await checkLocaleConsistencyDiagnostics(result.fullYaml, dir)),
      );
    }
    results.push({ path: displayPath, type: "treatment", diagnostics });
  }

  if (format === "json") {
    writeJson(stdout, results);
  } else {
    writeText(stdout, results);
  }

  const hasErrors = results.some((r) =>
    r.diagnostics.some((d) => d.severity === "error"),
  );
  if (unreadable) return 2;
  if (hasErrors) return 1;
  return 0;
}

function detectFileType(path: string): FileType | null {
  if (path.endsWith(".stagebook.yaml")) return "treatment";
  if (path.endsWith(".prompt.md")) return "prompt";
  return null;
}

/**
 * Build the prompt→locale map by reading each referenced prompt file from
 * disk, then run `checkPromptLocaleConsistency`. Unreadable or unparseable
 * prompts are skipped — missing files and invalid prompt syntax are different
 * error classes, reported when those files are validated directly.
 */
async function checkLocaleConsistencyDiagnostics(
  fullYaml: string,
  dir: string,
): Promise<Diagnostic[]> {
  let fileObj: unknown;
  try {
    fileObj = loadYaml(fullYaml);
  } catch {
    return []; // YAML errors are already reported by the schema pass
  }

  const promptLocales = new Map<string, string | undefined>();
  for (const relPath of collectReferencedPromptFiles(fileObj)) {
    // Gate before the read (ADR security acceptance condition): never read a
    // path the schema rejects (absolute, backslash, interior `..`). Those
    // paths already carry their own error diagnostics from the schema pass —
    // this just ensures the locale rule can't be used to read them anyway.
    if (!fileSchema.safeParse(relPath).success) continue;
    let promptSource: string;
    try {
      promptSource = await readFile(resolvePath(dir, relPath), "utf8");
    } catch {
      continue;
    }
    const parsed = promptFileSchema.safeParse(promptSource);
    if (!parsed.success) continue;
    promptLocales.set(relPath, parsed.data.metadata.locale);
  }

  return checkPromptLocaleConsistency(fileObj, promptLocales).map(
    (mismatch) => ({
      severity: "error" as const,
      message: mismatch.message,
      range: null,
    }),
  );
}

function hasGlobChars(s: string): boolean {
  return /[*?[\]{}]/.test(s);
}

// Strip terminal-control + C1 chars before writing to stdout. Diagnostic
// messages embed user-controlled YAML keys verbatim, so a crafted key like
// `"foo[2J"` would otherwise clear the researcher's terminal. JSON
// output is safe because JSON.stringify escapes control chars.
function stripControl(s: string): string {
  // Keeps \t (\x09) and \n (\x0a); strips other C0 (\x00-\x1f), DEL (\x7f),
  // and C1 (\x80-\x9f).
  return s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

function writeText(stream: NodeJS.WritableStream, results: FileResult[]): void {
  let errorCount = 0;
  let warningCount = 0;
  let fileCount = 0;
  for (const r of results) {
    if (r.unreadable) {
      stream.write(
        `${stripControl(r.path)}: error: ${stripControl(r.unreadable)}\n`,
      );
      errorCount += 1;
      fileCount += 1;
      continue;
    }
    if (r.diagnostics.length === 0) continue;
    fileCount += 1;
    for (const d of r.diagnostics) {
      // 1-based line:col for editor jump-to-location.
      const line = d.range ? d.range.startLine + 1 : 1;
      const col = d.range ? d.range.startCol + 1 : 1;
      stream.write(
        `${stripControl(r.path)}:${line}:${col}: ${d.severity}: ${stripControl(d.message)}\n`,
      );
      if (d.severity === "error") errorCount += 1;
      else warningCount += 1;
    }
  }
  if (errorCount + warningCount > 0) {
    const parts: string[] = [];
    if (errorCount > 0)
      parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
    if (warningCount > 0)
      parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
    stream.write(
      `\n${parts.join(", ")} in ${fileCount} file${fileCount === 1 ? "" : "s"}.\n`,
    );
  }
}

function writeJson(stream: NodeJS.WritableStream, results: FileResult[]): void {
  let errorCount = 0;
  let warningCount = 0;
  let fileCount = 0;

  const files = results
    .filter((r) => !r.unreadable && r.diagnostics.length > 0)
    .map((r) => {
      fileCount += 1;
      for (const d of r.diagnostics) {
        if (d.severity === "error") errorCount += 1;
        else warningCount += 1;
      }
      return { path: r.path, diagnostics: r.diagnostics };
    });

  const unreadableFiles = results
    .filter((r) => r.unreadable)
    .map((r) => {
      errorCount += 1;
      fileCount += 1;
      return { path: r.path, message: r.unreadable };
    });

  const output = {
    files,
    unreadable: unreadableFiles,
    summary: { errors: errorCount, warnings: warningCount, files: fileCount },
  };
  stream.write(JSON.stringify(output, null, 2) + "\n");
}
