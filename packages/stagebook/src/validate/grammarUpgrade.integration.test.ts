import { describe, expect, test } from "vitest";
import { Readable, Writable } from "node:stream";
import { run } from "../cli/validate.js";
import { collectUpgradeWarnings } from "./upgradeWarnings.js";
import { STAGEBOOK_VERSION } from "./stagebookVersion.js";
import { validateTreatmentWithDiff } from "./validateTreatmentDiff.js";
import { GRAMMAR_UPGRADE_IDS } from "./grammarUpgradeDetectors.js";

const leaf = (reference: string, comparator: string, value?: unknown) => ({
  reference,
  comparator,
  ...(value === undefined ? {} : { value }),
});
const unversioned = {
  treatments: [
    {
      gameStages: [
        {
          conditions: { none: [leaf("0.prompt.answer", "isAbove", 5)] },
          elements: [
            {
              type: "submitButton",
              conditions: {
                all: [
                  leaf("self.prompt.answer", "exists"),
                  { none: [leaf("self.prompt.answer", "isAbove", 5)] },
                  leaf("all.prompt.answer", "equals", "100.00"),
                  leaf("self.prompt.answer", "matches", "/yes/i"),
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};
const moduleSource = (
  version?: string,
) => `${version === undefined ? "" : `stagebook: "${version}"\n`}templates:
  - name: gated_submit
    contentType: element
    content:
      type: submitButton
      conditions:
        reference: self.entryUrl.params.condition
        comparator: equals
        value: "Yes"
`;
const upgradeMessages = (diagnostics: { message: string }[]) =>
  diagnostics.filter((issue) =>
    issue.message.includes("Changed in Stagebook 0.35"),
  );

async function cli(source: string) {
  let output = "";
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      output += chunk.toString();
      done();
    },
  });
  const code = await run({
    argv: ["--format=json", "--no-expand", "--type=treatment", "-"],
    cwd: process.cwd(),
    stdin: Readable.from(source),
    stdout: stream,
    stderr: stream,
  });
  return { code, output };
}

describe("registered grammar upgrade warnings", () => {
  test("the real registry covers every grammar migration category", () => {
    const warnings = collectUpgradeWarnings({
      kind: "treatment",
      file: unversioned,
    });
    expect(new Set(warnings.map((warning) => warning.ruleId))).toEqual(
      new Set(GRAMMAR_UPGRADE_IDS),
    );
    expect(
      warnings.every((warning) =>
        warning.message.includes(`stagebook: "${STAGEBOOK_VERSION}"`),
      ),
    ).toBe(true);
  });
  test.each([undefined, "0.33", "0.34"])(
    "warns for an older or unversioned study: %s",
    (stagebook) => {
      expect(
        collectUpgradeWarnings({
          kind: "treatment",
          file: { ...unversioned, stagebook },
        }),
      ).not.toEqual([]);
    },
  );
  test("reviewing the current version silences the migration rules", () => {
    expect(
      collectUpgradeWarnings({
        kind: "treatment",
        file: { ...unversioned, stagebook: STAGEBOOK_VERSION },
      }),
    ).toEqual([]);
  });
  test.each([
    { merged: STAGEBOOK_VERSION, explicit: undefined, warnings: 0 },
    { merged: "0.33", explicit: STAGEBOOK_VERSION, warnings: 0 },
    { merged: STAGEBOOK_VERSION, explicit: "0.33", warnings: 1 },
  ])(
    "honors root merged version $merged with explicit override $explicit",
    async ({ merged, explicit, warnings }) => {
      const source = `metadata: &metadata
  stagebook: "${merged}"
<<: *metadata
${moduleSource(explicit)}`;
      const result = await validateTreatmentWithDiff({
        source,
        loadImport: async () => {
          throw new Error("unused");
        },
      });
      const migrationWarnings = upgradeMessages(result.diagnostics);
      expect(migrationWarnings).toHaveLength(warnings);
      if (warnings) {
        expect(migrationWarnings[0]).toMatchObject({
          range: {
            startLine: source
              .split("\n")
              .findIndex((line) => line.includes("reference:")),
          },
        });
      }
      const output = await cli(source);
      expect(output.code, output.output).toBe(0);
      const json = JSON.parse(output.output) as {
        files: { diagnostics: { message: string }[] }[];
      };
      expect(
        upgradeMessages(json.files.flatMap((file) => file.diagnostics)),
      ).toHaveLength(warnings);
    },
  );
  test("the editor points at the raw template definition", async () => {
    const source = moduleSource();
    const result = await validateTreatmentWithDiff({
      source,
      loadImport: async () => {
        throw new Error("unused");
      },
    });
    const warnings = upgradeMessages(result.diagnostics);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      severity: "warning",
      range: {
        startLine: source
          .split("\n")
          .findIndex((line) => line.includes("reference:")),
      },
    });
    const reviewed = await validateTreatmentWithDiff({
      source: moduleSource(STAGEBOOK_VERSION),
      loadImport: async () => {
        throw new Error("unused");
      },
    });
    expect(upgradeMessages(reviewed.diagnostics)).toEqual([]);
  });
  test("CLI upgrade-only diagnostics preserve exit zero and version gating", async () => {
    const unreviewed = await cli(moduleSource());
    expect(unreviewed.code, unreviewed.output).toBe(0);
    expect(unreviewed.output).toContain("Changed in Stagebook 0.35");
    const reviewed = await cli(moduleSource(STAGEBOOK_VERSION));
    expect(reviewed.code, reviewed.output).toBe(0);
    expect(reviewed.output).not.toContain("Changed in Stagebook 0.35");
  });
});
