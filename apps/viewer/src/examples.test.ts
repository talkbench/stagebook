import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  promptFileSchema,
  parseTreatmentYaml as parseStagebookYaml,
  resolveImportPath,
  resolveImports,
  treatmentFileSchema,
  type ParsedFile,
} from "stagebook";
import { parseTreatmentYaml } from "./lib/treatment";
import { expandTreatmentFile } from "stagebook/viewer";

const examplesRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples",
);

interface Example {
  name: string;
  treatmentFile: string;
}

const EXAMPLES: Example[] = [
  {
    name: "annotated-walkthrough",
    treatmentFile: "annotated-walkthrough/walkthrough.stagebook.yaml",
  },
  {
    name: "imports-walkthrough",
    treatmentFile: "imports-walkthrough/imports-walkthrough.stagebook.yaml",
  },
  {
    name: "i18n-gallery",
    treatmentFile: "i18n-gallery/i18n-gallery.stagebook.yaml",
  },
];

/**
 * Parse the root YAML and any imports it transitively references,
 * returning a JSON string of the merged result. Mirrors the
 * `mergeBundledImports` helper in `exampleCatalog.ts` but uses the
 * filesystem (sync `readFileSync`) since this test runs in node.
 *
 * Examples without `imports:` round-trip the original YAML
 * unchanged.
 */
function mergeImportsFromDisk(rootYaml: string, exampleDir: string): string {
  const { parsed: rootParsed, imports } = parseStagebookYaml(rootYaml);
  if (imports.length === 0) return rootYaml;

  const root = rootParsed as ParsedFile;
  const loaded = new Map<string, ParsedFile>();
  const queue = imports.map((p) => resolveImportPath("root.stagebook.yaml", p));
  while (queue.length > 0) {
    const importPath = queue.shift()!;
    if (loaded.has(importPath)) continue;
    const yaml = readFileSync(resolve(exampleDir, importPath), "utf8");
    const child = parseStagebookYaml(yaml);
    loaded.set(importPath, child.parsed as ParsedFile);
    for (const next of child.imports) {
      queue.push(resolveImportPath(importPath, next));
    }
  }
  const mergedTemplates = resolveImports({ main: root, files: loaded });
  const { imports: _imports, templates: _templates, ...rest } = root;
  void _imports;
  void _templates;
  const merged: Record<string, unknown> = { ...rest };
  if (mergedTemplates.length > 0) merged.templates = mergedTemplates;
  return JSON.stringify(merged);
}

function collectPromptPaths(obj: unknown, paths: Set<string>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectPromptPaths(item, paths);
    return;
  }
  const record = obj as Record<string, unknown>;
  const file = record.file;
  if (typeof file === "string" && file.endsWith(".prompt.md")) {
    paths.add(file);
  }
  for (const value of Object.values(record)) collectPromptPaths(value, paths);
}

describe.each(EXAMPLES)("$name example", ({ treatmentFile }) => {
  const yamlPath = resolve(examplesRoot, treatmentFile);
  const exampleDir = dirname(yamlPath);

  it("parses, validates, and fully expands templates", () => {
    const yaml = readFileSync(yamlPath, "utf8");
    const merged = mergeImportsFromDisk(yaml, exampleDir);
    const parsed = parseTreatmentYaml(merged);
    const { result, unresolvedFields } = expandTreatmentFile(parsed);
    expect(unresolvedFields).toEqual([]);
    const reparsed = treatmentFileSchema.safeParse(result);
    if (!reparsed.success) {
      const summary = reparsed.error.issues
        .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n");
      throw new Error(`Expanded treatment failed schema:\n${summary}`);
    }
  });

  it("each referenced prompt file exists and parses", () => {
    const yaml = readFileSync(yamlPath, "utf8");
    const merged = mergeImportsFromDisk(yaml, exampleDir);
    const parsed = parseTreatmentYaml(merged);
    const { result } = expandTreatmentFile(parsed);
    const promptPaths = new Set<string>();
    collectPromptPaths(result, promptPaths);
    expect(promptPaths.size).toBeGreaterThan(0);
    for (const promptPath of promptPaths) {
      const abs = resolve(exampleDir, promptPath);
      const content = readFileSync(abs, "utf8");
      const parsedPrompt = promptFileSchema.safeParse(content);
      if (!parsedPrompt.success) {
        const summary = parsedPrompt.error.issues
          .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n");
        throw new Error(`Prompt ${promptPath} failed schema:\n${summary}`);
      }
    }
  });
});
