import { describe, it, expect, vi } from "vitest";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";
import { validatePromptSource } from "./validatePrompt.js";
import { STAGEBOOK_VERSION } from "./stagebookVersion.js";

// The version-consistency check (#756): when the entry file declares
// `stagebook:`, each import (direct or transitive) and each prompt file it
// uses that declares an older version, or none, gets one warning.

// Several fixtures are unversioned or on an old release, so every real
// upgrade rule would apply to them. Keep the table out of these tests.
vi.mock("./upgradeRules.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./upgradeRules.js")>()),
  upgradeRules: [],
}));

const CURRENT = STAGEBOOK_VERSION;
const OLDER = "0.1";

const header = (version: string | null) =>
  version === null ? "" : `stagebook: "${version}"\n`;

const importsBlock = (imports?: string[]) =>
  imports ? `imports:\n${imports.map((p) => `  - ${p}\n`).join("")}` : "";

const prompt = (version: string | null) =>
  `---\ntype: noResponse\n${header(version)}---\n# Welcome\n`;

/** A module with one template, which renders `shared.prompt.md`. */
const module = (
  version: string | null,
  options: { imports?: string[]; template?: string } = {},
) => `${header(version)}${importsBlock(options.imports)}templates:
  - name: ${options.template ?? "unused"}
    contentType: element
    content:
      type: prompt
      file: shared.prompt.md
`;

/** An entry file with the given imports and prompt elements. */
const entry = (
  version: string | null,
  options: {
    imports?: string[];
    prompts?: string[];
    elements?: string;
    templates?: string;
  } = {},
) => `${header(version)}${importsBlock(options.imports)}${
  options.templates ?? ""
}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
${options.elements ?? ""}${(options.prompts ?? [])
  .map(
    (file, i) =>
      `          - type: prompt\n            name: p${i}\n            file: ${file}\n`,
  )
  .join("")}          - type: submitButton
`;

const loaderFromMap =
  (files: Record<string, string>) =>
  (path: string): Promise<string> => {
    const content = files[path.replace(/^\.\//, "")];
    return content === undefined
      ? Promise.reject(new Error(`no file ${path}`))
      : Promise.resolve(content);
  };

/** Every diagnostic: nothing else fires on these fixtures, so an unexpected
 *  one fails the test. */
async function diagnosticsFor(
  source: string,
  files: Record<string, string>,
  loadImport = loaderFromMap(files),
) {
  const { diagnostics } = await validateTreatmentWithDiff({
    source,
    loadImport,
  });
  return diagnostics;
}

const lineOf = (source: string, text: string) =>
  source.split("\n").findIndex((line) => line.includes(text));

describe("version consistency — imports", () => {
  it("warns once at the imports: entry for a direct import with no version", async () => {
    const source = entry(CURRENT, { imports: ["a.stagebook.yaml"] });
    const warnings = await diagnosticsFor(source, {
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
    const warnings = await diagnosticsFor(
      entry(CURRENT, { imports: ["a.stagebook.yaml"] }),
      { "a.stagebook.yaml": module(OLDER) },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `Imported file "a.stagebook.yaml" declares \`stagebook: "${OLDER}"\`, older than this file's "${CURRENT}".`,
    );
  });

  it("flags a transitive import at the direct import that brings it in", async () => {
    // b's path resolves against lib/a's directory, not the entry's.
    const source = entry(CURRENT, { imports: ["lib/a.stagebook.yaml"] });
    const warnings = await diagnosticsFor(source, {
      "lib/a.stagebook.yaml": module(CURRENT, {
        imports: ["b.stagebook.yaml"],
      }),
      "lib/b.stagebook.yaml": module(OLDER, { template: "other" }),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `"lib/b.stagebook.yaml" (imported through "lib/a.stagebook.yaml") declares \`stagebook: "${OLDER}"\``,
    );
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- lib/a.stagebook.yaml"),
    );
  });

  it("names the direct import for a file several imports deep", async () => {
    const warnings = await diagnosticsFor(
      entry(CURRENT, { imports: ["a.stagebook.yaml"] }),
      {
        "a.stagebook.yaml": module(CURRENT, { imports: ["b.stagebook.yaml"] }),
        "b.stagebook.yaml": module(CURRENT, {
          imports: ["c.stagebook.yaml"],
          template: "b",
        }),
        "c.stagebook.yaml": module(null, { template: "c" }),
      },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      '"c.stagebook.yaml" (imported through "a.stagebook.yaml")',
    );
  });

  it("reports a file reached two ways once, at its direct import", async () => {
    const source = entry(CURRENT, {
      imports: ["a.stagebook.yaml", "b.stagebook.yaml"],
    });
    const warnings = await diagnosticsFor(source, {
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
    const warnings = await diagnosticsFor(
      entry(OLDER, { imports: ["a.stagebook.yaml", "b.stagebook.yaml"] }),
      {
        "a.stagebook.yaml": module(OLDER),
        "b.stagebook.yaml": module(CURRENT, { template: "other" }),
      },
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't run when the entry file declares no version", async () => {
    const warnings = await diagnosticsFor(
      entry(null, { imports: ["a.stagebook.yaml"] }),
      { "a.stagebook.yaml": module(null) },
    );
    expect(warnings).toEqual([]);
  });

  it("judges an imported file validated on its own by its own version", async () => {
    // Imported by a newer study, this module would be flagged there. On its
    // own, only its imports are checked, against its own version.
    const warnings = await diagnosticsFor(
      module(OLDER, { imports: ["b.stagebook.yaml"] }),
      { "b.stagebook.yaml": module(OLDER, { template: "other" }) },
    );
    expect(warnings).toEqual([]);
  });

  it("reads each import once per validation", async () => {
    const files = { "a.stagebook.yaml": module(null) };
    const loadImport = vi.fn(loaderFromMap(files));
    await diagnosticsFor(
      entry(CURRENT, { imports: ["a.stagebook.yaml"] }),
      files,
      loadImport,
    );
    expect(
      loadImport.mock.calls.filter(([path]) => path === "a.stagebook.yaml"),
    ).toHaveLength(1);
  });
});

describe("version consistency — prompt files", () => {
  it("warns once per prompt file with no version, at its first reference", async () => {
    const source = entry(CURRENT, {
      prompts: ["shared.prompt.md", "./shared.prompt.md"],
    });
    const warnings = await diagnosticsFor(source, {
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
    const warnings = await diagnosticsFor(
      entry(CURRENT, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": prompt(OLDER) },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      `Prompt file "q.prompt.md" declares \`stagebook: "${OLDER}"\`, older than this file's "${CURRENT}".`,
    );
  });

  it("points at the right reference when a template shifts the elements", async () => {
    // `two` expands to two elements, so in the hydrated tree old.prompt.md
    // sits at the index new.prompt.md has in the source.
    const source = entry(CURRENT, {
      templates: `templates:
  - name: two
    contentType: elements
    content:
      - type: prompt
        name: t1
        file: a.prompt.md
      - type: prompt
        name: t2
        file: b.prompt.md
`,
      elements: "          - template: two\n",
      prompts: ["old.prompt.md", "new.prompt.md"],
    });
    const warnings = await diagnosticsFor(source, {
      "a.prompt.md": prompt(CURRENT),
      "b.prompt.md": prompt(CURRENT),
      "old.prompt.md": prompt(OLDER),
      "new.prompt.md": prompt(CURRENT),
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Prompt file "old.prompt.md"');
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "file: old.prompt.md"),
    );
  });

  it("covers a prompt file used through an imported template, at the top of the file", async () => {
    // The reference is written in the module, not in this file.
    const warnings = await diagnosticsFor(
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
    expect(warnings[0].range).toBeNull();
  });

  it("doesn't check a prompt file that only an unused template renders", async () => {
    const warnings = await diagnosticsFor(
      entry(CURRENT, { imports: ["a.stagebook.yaml"] }),
      {
        "a.stagebook.yaml": module(CURRENT),
        "shared.prompt.md": prompt(OLDER),
      },
    );
    expect(warnings).toEqual([]);
  });

  it("flags a prompt file with a malformed version like one with none", async () => {
    const warnings = await diagnosticsFor(
      entry(CURRENT, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": "---\ntype: noResponse\nstagebook: 0.30\n---\n# Hi\n" },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain(
      "doesn't declare a valid `stagebook:` version",
    );
  });

  it("still checks a prompt file that fails validation for another reason", async () => {
    const warnings = await diagnosticsFor(
      entry(CURRENT, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": "---\ntype: noResponse\nrows: 3\n---\n# Hi\n" },
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('Prompt file "q.prompt.md"');
  });

  it("is silent for prompt files on the same version or a newer one", async () => {
    const warnings = await diagnosticsFor(
      entry(OLDER, { prompts: ["a.prompt.md", "b.prompt.md"] }),
      { "a.prompt.md": prompt(OLDER), "b.prompt.md": prompt(CURRENT) },
    );
    expect(warnings).toEqual([]);
  });

  it("doesn't run when the entry file declares no version", async () => {
    const warnings = await diagnosticsFor(
      entry(null, { prompts: ["q.prompt.md"] }),
      { "q.prompt.md": prompt(null) },
    );
    expect(warnings).toEqual([]);
  });

  it("skips a prompt file that can't be read; that has its own diagnostic", async () => {
    const warnings = await diagnosticsFor(
      entry(CURRENT, { prompts: ["missing.prompt.md"] }),
      {},
    );
    expect(warnings).toEqual([]);
  });

  it("never asks the host to read a prompt path with a scheme", async () => {
    const loadImport = vi.fn(loaderFromMap({}));
    await diagnosticsFor(
      entry(CURRENT, {
        prompts: ["asset://x.prompt.md", "https://example.com/y.prompt.md"],
      }),
      {},
      loadImport,
    );
    expect(loadImport).not.toHaveBeenCalled();
  });

  it("doesn't check a prompt file validated on its own", () => {
    expect(validatePromptSource(prompt(OLDER)).diagnostics).toEqual([]);
    expect(validatePromptSource(prompt(null)).diagnostics).toEqual([]);
  });
});
