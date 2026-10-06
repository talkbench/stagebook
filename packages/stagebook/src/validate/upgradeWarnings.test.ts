import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promptFileSchema } from "../schemas/index.js";
import {
  upgradeRules,
  type UpgradeRule,
  type UpgradeRuleInput,
} from "./upgradeRules.js";
import { collectUpgradeWarnings } from "./upgradeWarnings.js";
import {
  STAGEBOOK_VERSION,
  compareStagebookVersions,
} from "./stagebookVersion.js";
import {
  FIXTURE_VALUE,
  conditionFixtureRule,
  promptFixtureRule,
} from "./fixtures/upgradeRuleFixtures.js";

// Two changes, in two releases. Both predate any real release, so the tests
// hold whatever STAGEBOOK_VERSION is.
const OLD = conditionFixtureRule("fixture-old", "0.1");
const NEW = conditionFixtureRule("fixture-new", "0.2");
const PROMPT = promptFixtureRule("fixture-prompt", "0.2");
const RULES = [OLD, NEW, PROMPT];

const condition = { reference: "self.prompt.q", comparator: "equals" };
const treatmentFile = (stagebook?: unknown): UpgradeRuleInput => ({
  kind: "treatment",
  file: {
    ...(stagebook === undefined ? {} : { stagebook }),
    treatments: [
      {
        gameStages: [
          {
            elements: [
              { conditions: [{ ...condition, value: FIXTURE_VALUE }] },
            ],
          },
        ],
      },
    ],
  },
});
const CONDITION_PATH = [
  "treatments",
  0,
  "gameStages",
  0,
  "elements",
  0,
  "conditions",
  0,
];

const promptFile = (stagebook?: string): UpgradeRuleInput => {
  const parsed = promptFileSchema.safeParse(
    `---\ntype: noResponse\nnotes: ${FIXTURE_VALUE}\n${stagebook ? `stagebook: "${stagebook}"\n` : ""}---\n# Hi\n`,
  );
  if (!parsed.success) throw new Error("fixture prompt should parse");
  return { kind: "prompt", prompt: parsed.data };
};

const ids = (input: UpgradeRuleInput) =>
  collectUpgradeWarnings(input, RULES).map((w) => w.ruleId);

describe("collectUpgradeWarnings", () => {
  it("fires every rule on a file with no stagebook: field", () => {
    expect(ids(treatmentFile())).toEqual(["fixture-old", "fixture-new"]);
  });

  it("fires none on a file set to the current version", () => {
    expect(ids(treatmentFile(STAGEBOOK_VERSION))).toEqual([]);
  });

  it("fires only changes after the declared version", () => {
    expect(ids(treatmentFile("0.1"))).toEqual(["fixture-new"]);
  });

  it("treats a malformed version like no field, so nothing is hidden", () => {
    expect(ids(treatmentFile(0.1))).toEqual(["fixture-old", "fixture-new"]);
    expect(ids(treatmentFile("0.1.0"))).toEqual(["fixture-old", "fixture-new"]);
  });

  it("runs a rule only on the file kinds it applies to", () => {
    expect(ids(promptFile())).toEqual(["fixture-prompt"]);
    expect(ids(promptFile("0.1"))).toEqual(["fixture-prompt"]);
    expect(ids(promptFile(STAGEBOOK_VERSION))).toEqual([]);
  });

  it("never shows a rule a file kind outside its appliesTo", () => {
    // The fixtures check the kind themselves, so spy on a rule that doesn't.
    const detect = vi.fn(() => [{ path: [], message: "hit" }]);
    const treatmentOnly: UpgradeRule = {
      id: "treatment-only",
      introducedIn: "0.1",
      appliesTo: ["treatment"],
      detect,
    };
    expect(collectUpgradeWarnings(promptFile(), [treatmentOnly])).toEqual([]);
    expect(detect).not.toHaveBeenCalled();
    expect(
      collectUpgradeWarnings(treatmentFile(), [treatmentOnly]),
    ).toHaveLength(1);
  });

  it("reports a rule that throws as a warning and runs the others", () => {
    const broken: UpgradeRule = {
      id: "broken",
      introducedIn: "0.1",
      appliesTo: ["treatment"],
      detect: () => {
        throw new Error("boom");
      },
    };
    const warnings = collectUpgradeWarnings(treatmentFile(), [broken, NEW]);
    expect(warnings.map((w) => w.ruleId)).toEqual(["broken", "fixture-new"]);
    expect(warnings[0].path).toBeNull();
    expect(warnings[0].message).toBe(
      'Stagebook couldn\'t run its upgrade check "broken" on this file (boom). This is a bug in Stagebook; please report it.',
    );
  });

  it("returns one warning per affected construct, at its path", () => {
    const [warning] = collectUpgradeWarnings(treatmentFile(), [OLD]);
    expect(warning.path).toEqual(CONDITION_PATH);
  });

  it("names the change and the release, then ends with how to silence it", () => {
    const [warning] = collectUpgradeWarnings(treatmentFile(), [NEW]);
    expect(warning.message).toBe(
      `Fixture change fixture-new: \`equals\` against "${FIXTURE_VALUE}" now behaves differently. ` +
        `(Changed in Stagebook 0.2.) ` +
        `Review it, then set \`stagebook: "${STAGEBOOK_VERSION}"\` at the top of this file to silence this warning.`,
    );
  });

  it("tells a prompt file's author to set the field in its frontmatter", () => {
    const [warning] = collectUpgradeWarnings(promptFile(), [PROMPT]);
    expect(warning.message).toMatch(
      new RegExp(
        `set \`stagebook: "${STAGEBOOK_VERSION}"\` in this file's frontmatter to silence this warning\\.$`,
      ),
    );
  });
});

describe("production upgrade rules", () => {
  it("have unique kebab-case ids", () => {
    const seen = new Set<string>();
    for (const rule of upgradeRules) {
      expect(rule.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(seen.has(rule.id)).toBe(false);
      seen.add(rule.id);
    }
  });

  it("are introduced in a release this validator implements", () => {
    // Otherwise setting `stagebook:` to STAGEBOOK_VERSION, as the warning
    // says, wouldn't silence the rule.
    for (const rule of upgradeRules) {
      expect(rule.introducedIn).toMatch(/^\d+\.\d+$/);
      expect(
        compareStagebookVersions(rule.introducedIn, STAGEBOOK_VERSION),
      ).toBeLessThanOrEqual(0);
      expect(rule.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it("are each described in the researcher upgrade guide", () => {
    const guide = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../docs/researcher/upgrading.md",
      ),
      "utf8",
    );
    for (const rule of upgradeRules) {
      expect(guide).toContain(rule.id);
    }
  });
});
