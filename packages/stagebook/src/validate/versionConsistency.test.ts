import { describe, it, expect } from "vitest";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";
import { validatePromptSource } from "./validatePrompt.js";
import { STAGEBOOK_VERSION } from "./stagebookVersion.js";

// The version-consistency check (#756): when the entry file declares
// `stagebook:`, each import (direct or transitive) and each prompt file it
// uses that declares an older version, or none, gets one warning.

const CURRENT = STAGEBOOK_VERSION;
const OLDER = "0.1";

const header = (version: string | null) =>
  version === null ? "" : `stagebook: "${version}"\n`;

const prompt = (version: string | null) =>
  `---\ntype: noResponse\n${header(version)}---\n# Welcome\n`;

const module = (
  version: string | null,
  options: { imports?: string[]; template?: string } = {},
) =>
  `${header(version)}${
    options.imports
      ? `imports:\n${options.imports.map((p) => `  - ${p}\n`).join("")}`
      : ""
  }templates:
  - name: ${options.template ?? "unused"}
    contentType: element
    content:
      type: prompt
      file: shared.prompt.md
`;

/** An entry file with the given imports and prompt elements. */
const entry = (
  version: string | null,
  options: { imports?: string[]; prompts?: string[]; elements?: string } = {},
) => `${header(version)}${
  options.imports
    ? `imports:\n${options.imports.map((p) => `  - ${p}\n`).join("")}`
    : ""
}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
${(options.prompts ?? [])
  .map(
    (file, i) =>
      `          - type: prompt\n            name: p${i}\n            file: ${file}\n`,
  )
  .join("")}${options.elements ?? ""}          - type: submitButton
`;

const loaderFromMap =
  (files: Record<string, string>) =>
  (path: string): Promise<string> => {
    const content = files[path.replace(/^\.\//, "")];
    return content === undefined
      ? Promise.reject(new Error(`no file ${path}`))
      : Promise.resolve(content);
  };

async function consistencyWarnings(
  source: string,
  files: Record<string, string>,
) {
  const { diagnostics } = await validateTreatmentWithDiff({
    source,
    loadImport: loaderFromMap(files),
  });
  // Nothing else should fire on these fixtures; keep every diagnostic so an
  // unexpected one fails the test.
  return diagnostics;
}

const lineOf = (source: string, text: string) =>
  source.split("\n").findIndex((line) => line.includes(text));

describe("version consistency — imports", () => {
  it("warns once at the imports: entry for a direct import with no version", async () => {
    const source = entry(CURRENT, { imports: ["a.stagebook.yaml"] });
    const warnings = await consistencyWarnings(source, {
      "a.stagebook.yaml": module(null),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe("warning");
    expect(warnings[0].message).toBe(
      `Imported file "a.stagebook.yaml" doesn't declare a valid \`stagebook:\` version, but this file declares "${CURRENT}". ` +
        `Validate it and review its upgrade warnings, then set its \`stagebook:\` to "${CURRENT}" so the study's files are on one version.`,
    );
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- a.stagebook.yaml"),
    );
  });

  it("names both versions for a direct import that declares an older one", async () => {
    const warnings = await consistencyWarnings(
      entry(CURRENT, { imports: ["a.stagebook.yaml"] }),
      { "a.stagebook.yaml": module(OLDER) },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `Imported file "a.stagebook.yaml" declares \`stagebook: "${OLDER}"\`, older than this file's "${CURRENT}".`,
    );
  });

  it("flags a transitive import at the direct import that brings it in", async () => {
    const source = entry(CURRENT, { imports: ["a.stagebook.yaml"] });
    const warnings = await consistencyWarnings(source, {
      "a.stagebook.yaml": module(CURRENT, {
        imports: ["lib/b.stagebook.yaml"],
      }),
      "lib/b.stagebook.yaml": module(OLDER, { template: "other" }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `"lib/b.stagebook.yaml" (imported through "a.stagebook.yaml") declares \`stagebook: "${OLDER}"\``,
    );
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- a.stagebook.yaml"),
    );
  });

  it("reports a file reached two ways once, at its direct import", async () => {
    const source = entry(CURRENT, {
      imports: ["a.stagebook.yaml", "b.stagebook.yaml"],
    });
    const warnings = await consistencyWarnings(source, {
      "a.stagebook.yaml": module(CURRENT, { imports: ["b.stagebook.yaml"] }),
      "b.stagebook.yaml": module(null, { template: "other" }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Imported file "b.stagebook.yaml"');
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- b.stagebook.yaml"),
    );
  });

  it("is silent for imports on the same version or a newer one", async () => {
    const warnings = await consistencyWarnings(
      entry(OLDER, { imports: ["a.stagebook.yaml", "b.stagebook.yaml"] }),
      {
        "a.stagebook.yaml": module(OLDER),
        "b.stagebook.yaml": module(CURRENT, { template: "other" }),
      },
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't run when the entry file declares no version", async () => {
    const warnings = await consistencyWarnings(
      entry(null, { imports: ["a.stagebook.yaml"] }),
      { "a.stagebook.yaml": module(null) },
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't flag an imported file validated on its own", async () => {
    const warnings = await consistencyWarnings(module(OLDER), {});
    expect(warnings).toEqual([]);
  });
});

describe("version consistency — prompt files", () => {
  it("warns once per prompt file with no version, at its first reference", async () => {
    const source = entry(CURRENT, {
      prompts: ["shared.prompt.md", "shared.prompt.md"],
    });
    const warnings = await consistencyWarnings(source, {
      "shared.prompt.md": prompt(null),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `Prompt file "shared.prompt.md" doesn't declare a valid \`stagebook:\` version, but this file declares "${CURRENT}".`,
    );
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "file: shared.prompt.md"),
    );
  });

  it("names both versions for a prompt file that declares an older one", async () => {
    const warnings = await consistencyWarnings(
      entry(CURRENT, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": prompt(OLDER) },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `Prompt file "q.prompt.md" declares \`stagebook: "${OLDER}"\`, older than this file's "${CURRENT}".`,
    );
  });

  it("covers a prompt file used through an imported template", async () => {
    const warnings = await consistencyWarnings(
      entry(CURRENT, {
        imports: ["a.stagebook.yaml"],
        elements: "          - template: shared_prompt\n",
      }),
      {
        "a.stagebook.yaml": module(CURRENT, { template: "shared_prompt" }),
        "shared.prompt.md": prompt(OLDER),
      },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Prompt file "shared.prompt.md"');
  });

  it("is silent for prompt files on the same version or a newer one", async () => {
    const warnings = await consistencyWarnings(
      entry(OLDER, { prompts: ["a.prompt.md", "b.prompt.md"] }),
      { "a.prompt.md": prompt(OLDER), "b.prompt.md": prompt(CURRENT) },
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't run when the entry file declares no version", async () => {
    const warnings = await consistencyWarnings(
      entry(null, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": prompt(null) },
    );
    expect(warnings).toEqual([]);
  });

  it("skips a prompt file that can't be read; that has its own diagnostic", async () => {
    const warnings = await consistencyWarnings(
      entry(CURRENT, { prompts: ["missing.prompt.md"] }),
      {},
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't check a prompt file validated on its own", () => {
    expect(validatePromptSource(prompt(OLDER)).diagnostics).toEqual([]);
    expect(validatePromptSource(prompt(null)).diagnostics).toEqual([]);
  });
});
