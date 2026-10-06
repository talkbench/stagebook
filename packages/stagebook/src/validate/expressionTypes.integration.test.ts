import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { run } from "../cli/validate.js";
import { promptFileSchema } from "../schemas/promptFile.js";
import { validateTreatmentSource } from "./validateTreatment.js";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";

const textPrompt = "---\ntype: openResponse\n---\nAnswer.\n---\n> Your answer";
const numberPrompt = "---\ntype: numericResponse\n---\nAnswer.";
const source = `introSequences:
  - name: intro
    introSteps:
      - name: welcome
        elements:
          - type: submitButton
treatments:
  - name: study
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: stage
        duration: 60
        elements:
          - type: prompt
            name: answer
            file: question.prompt.md
          - type: submitButton
            conditions:
              reference: self.prompt.answer
              comparator: isAtLeast
              value: 2
`;
const typeDiagnostics = (diagnostics: { code?: string }[]) =>
  diagnostics.filter((item) => item.code === "expression-type");
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "stagebook-expression-types-"));
});
afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function cli(prompt: string | undefined) {
  await writeFile(join(directory, "study.stagebook.yaml"), source);
  if (prompt === undefined)
    await rm(join(directory, "question.prompt.md"), { force: true });
  else await writeFile(join(directory, "question.prompt.md"), prompt);
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const code = await run({
    argv: ["--format=json", "study.stagebook.yaml"],
    cwd: directory,
    stdin: Readable.from(""),
    stdout: stream,
    stderr: stream,
  });
  return { code, output: chunks.join("") };
}

describe("expression types reach every validation surface", () => {
  test("source validation warns when a prompt's type cannot be loaded", () => {
    const issues = typeDiagnostics(validateTreatmentSource(source).diagnostics);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "warning",
      range: { startLine: 19 },
    });
  });
  test("source validation accepts host-supplied prompt types", () => {
    const result = validateTreatmentSource(source, {
      promptFiles: new Map([
        ["question.prompt.md", promptFileSchema.parse(textPrompt)],
      ]),
    });
    expect(typeDiagnostics(result.diagnostics)).toEqual([
      expect.objectContaining({
        severity: "error",
        message: expect.stringContaining("prompts-that-save-numbers"),
      }),
    ]);
  });
  test("editor diff loads prompts and reports positioned type errors", async () => {
    const result = await validateTreatmentWithDiff({
      source,
      loadImport: async () => textPrompt,
    });
    expect(typeDiagnostics(result.diagnostics)).toEqual([
      expect.objectContaining({
        severity: "error",
        range: expect.objectContaining({ startLine: expect.any(Number) }),
      }),
    ]);
  });
  test("editor diff stays gradual for unavailable prompt types", async () => {
    const result = await validateTreatmentWithDiff({
      source,
      loadImport: async () => {
        throw new Error("missing");
      },
    });
    expect(typeDiagnostics(result.diagnostics)).toEqual([
      expect.objectContaining({ severity: "warning" }),
    ]);
  });
  test("CLI loads numeric types without retaining preliminary unreadable warnings", async () => {
    const result = await cli(numberPrompt);
    expect(result.code, result.output).toBe(0);
    expect(result.output).not.toContain('"expression-type"');
  });
  test("CLI exits 1 for known mismatches and links numeric prompt guidance", async () => {
    const result = await cli(textPrompt);
    expect(result.code).toBe(1);
    expect(result.output).toContain("prompts-that-save-numbers");
  });
  test("CLI exits 0 for unknown-type warnings", async () => {
    const result = await cli(undefined);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("unknown type");
  });
});
