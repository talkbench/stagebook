import { describe, it, expect, vi } from "vitest";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";
import { validateTreatmentSource } from "./validateTreatment.js";
import { validatePromptSource } from "./validatePrompt.js";
import { STAGEBOOK_VERSION } from "./stagebookVersion.js";
import { FIXTURE_VALUE } from "./fixtures/upgradeRuleFixtures.js";

// Upgrade warnings (#756) through the validators that surface them. The
// production table ships empty, so the fixture rules stand in for it.
vi.mock("./upgradeRules.js", async (importOriginal) => {
  const fixtures = await import("./fixtures/upgradeRuleFixtures.js");
  return {
    ...(await importOriginal<typeof import("./upgradeRules.js")>()),
    upgradeRules: [
      fixtures.conditionFixtureRule("fixture-old", "0.1"),
      fixtures.conditionFixtureRule("fixture-new", "0.2"),
      fixtures.promptFixtureRule("fixture-prompt", "0.2"),
    ],
  };
});

const loaderFromMap =
  (files: Record<string, string>) =>
  (path: string): Promise<string> => {
    const content = files[path.replace(/^\.\//, "")];
    return content === undefined
      ? Promise.reject(new Error(`no file ${path}`))
      : Promise.resolve(content);
  };

const QUESTION = "---\ntype: openResponse\n---\nWhy?\n---\n> Because\n";

const header = (version: string | null) =>
  version === null ? "" : `stagebook: "${version}"\n`;

/** A treatment whose submit button is gated by a fixture condition. */
const study = (version: string | null) => `${header(version)}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: q.prompt.md
          - type: submitButton
            conditions:
              - reference: self.prompt.q
                comparator: equals
                value: ${FIXTURE_VALUE}
`;

/** A module whose template carries the fixture condition. */
const module = (version: string | null) => `${header(version)}templates:
  - name: gated_submit
    contentType: element
    content:
      type: submitButton
      conditions:
        - reference: self.prompt.q
          comparator: equals
          value: ${FIXTURE_VALUE}
`;

/** A study that gets its gated submit button from a template. */
const templatedStudy = (
  version: string | null,
  options: { imports?: string } = {},
) => `${header(version)}${options.imports ? `imports:\n  - ${options.imports}\n` : ""}${
  options.imports ? "" : module(null)
}treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: g
        duration: 10
        elements:
          - type: prompt
            name: q
            file: q.prompt.md
          - template: gated_submit
`;

const lineOf = (source: string, text: string) =>
  source.split("\n").findIndex((line) => line.includes(text));

async function upgradeWarnings(
  source: string,
  files: Record<string, string> = {},
) {
  const { diagnostics } = await validateTreatmentWithDiff({
    source,
    loadImport: loaderFromMap({ "q.prompt.md": QUESTION, ...files }),
  });
  return diagnostics.filter((d) => d.message.includes("Fixture change"));
}

describe("upgrade warnings on the editor path (validateTreatmentWithDiff)", () => {
  it("fires every change on a file with no stagebook: field", async () => {
    const source = study(null);
    const warnings = await upgradeWarnings(source);
    expect(warnings.map((w) => w.severity)).toEqual(["warning", "warning"]);
    expect(warnings[0].message).toContain("fixture-old");
    expect(warnings[1].message).toContain("fixture-new");
    // At the condition, where the author reviews it.
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- reference: self.prompt.q"),
    );
  });

  it("fires none on a file set to the current version", async () => {
    expect(await upgradeWarnings(study(STAGEBOOK_VERSION))).toEqual([]);
  });

  it("fires only the changes after an older declared version", async () => {
    const warnings = await upgradeWarnings(study("0.1"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("fixture-new");
  });

  it("points at a template's definition, once, not at its invocation", async () => {
    const source = templatedStudy("0.1");
    const warnings = await upgradeWarnings(source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- reference: self.prompt.q"),
    );
    expect(warnings[0].range!.startLine).toBeLessThan(
      lineOf(source, "treatments:"),
    );
  });
});

describe("a template is judged by the version of the file that defines it", () => {
  it("an up-to-date module's template stays quiet in an unversioned study", async () => {
    // The study declares no version, so every change applies to the study's
    // own conditions, but the template's condition belongs to the module.
    const warnings = await upgradeWarnings(
      templatedStudy(null, { imports: "module.stagebook.yaml" }),
      { "module.stagebook.yaml": module(STAGEBOOK_VERSION) },
    );
    expect(warnings).toEqual([]);
  });

  it("an unversioned module's template warns in the module, at the definition", async () => {
    const source = module(null);
    const warnings = await upgradeWarnings(source);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].range?.startLine).toBe(
      lineOf(source, "- reference: self.prompt.q"),
    );
  });

  it("an unversioned module's template doesn't warn in an up-to-date study", async () => {
    // The study flags the module as behind instead (the consistency check),
    // so the author knows to review it.
    const { diagnostics } = await validateTreatmentWithDiff({
      source: templatedStudy(STAGEBOOK_VERSION, {
        imports: "module.stagebook.yaml",
      }),
      loadImport: loaderFromMap({
        "q.prompt.md": `---\ntype: openResponse\nstagebook: "${STAGEBOOK_VERSION}"\n---\nWhy?\n---\n> Because\n`,
        "module.stagebook.yaml": module(null),
      }),
    });
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Imported file "module.stagebook.yaml"'),
    ]);
  });
});

describe("upgrade warnings stay off the expanded-YAML validator", () => {
  it("validateTreatmentSource reports none, since it also sees expanded YAML", () => {
    const { diagnostics } = validateTreatmentSource(study(null));
    expect(diagnostics).toEqual([]);
  });
});

describe("upgrade warnings on prompt files (validatePromptSource)", () => {
  const prompt = (version: string | null) =>
    `---\ntype: noResponse\nnotes: ${FIXTURE_VALUE}\n${header(version)}---\n# Welcome\n`;

  it("fires a prompt-file change on a prompt with no field, at the construct", () => {
    const { diagnostics } = validatePromptSource(prompt(null));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("warning");
    expect(diagnostics[0].message).toContain("fixture-prompt");
    expect(diagnostics[0].message).toMatch(/in this file's frontmatter/);
    expect(diagnostics[0].range?.startLine).toBe(2);
  });

  it("fires a change made after an older declared version", () => {
    const { diagnostics } = validatePromptSource(prompt("0.1"));
    expect(diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining("fixture-prompt"),
    ]);
  });

  it("fires none on a prompt set to the current version", () => {
    expect(validatePromptSource(prompt(STAGEBOOK_VERSION)).diagnostics).toEqual(
      [],
    );
  });

  it("doesn't run treatment-file changes on prompt files", () => {
    const { diagnostics } = validatePromptSource(
      `---\ntype: openResponse\n---\nWhy?\n---\n> ${FIXTURE_VALUE}\n`,
    );
    expect(diagnostics).toEqual([]);
  });
});
