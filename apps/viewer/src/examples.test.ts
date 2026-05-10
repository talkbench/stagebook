import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promptFileSchema, treatmentFileSchema } from "stagebook";
import { parseTreatmentYaml } from "./lib/treatment";
import { expandTreatmentFile } from "./lib/expandTreatmentFile";

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
];

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
    const parsed = parseTreatmentYaml(yaml);
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
    const parsed = parseTreatmentYaml(yaml);
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
