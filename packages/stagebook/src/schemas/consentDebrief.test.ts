import { describe, expect, test } from "vitest";
import {
  treatmentFileSchema,
  ADVANCEMENT_ELEMENT_MESSAGE,
} from "./treatment.js";
import { validateTreatmentFileReferences } from "./validateReferences.js";
import { collectStorageKeyCollisions } from "./storageKeyCollisions.js";
import { checkPromptLocaleConsistency } from "./localeConsistency.js";
import { validateResolvedTreatmentFile } from "./resolved.js";
import { checkUnsatisfiableConditions } from "./unsatisfiableConditions.js";
import { promptFileSchema } from "./promptFile.js";

/**
 * Consent & debrief as first-class units (#481, Phase 1).
 *
 * The settled model (see the #481 comment thread / ADR):
 *   - top-level `consent:` array of arms { name, locale?, steps } — host
 *     selects one arm by name; arm names unique WITHIN the collection only
 *   - per-treatment `debrief:` steps — inherit the treatment's locale and
 *     its key scope (like exitSequence)
 *   - consent responses ride the normal machinery in the flat key
 *     namespace: collision-checked against EVERY intro sequence and EVERY
 *     treatment (no pairing exists for consent)
 *   - consent is a closed reference scope: nothing outside consent may
 *     reference a consent key (audit-only, by policy), and consent steps
 *     may not reference later-phase data (consent runs first)
 */

// --- fixture builders --------------------------------------------------------

function promptEl(name: string): Record<string, unknown> {
  return { type: "prompt", file: `${name}.prompt.md`, name };
}

function consentArm(
  name: string,
  elementNames: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    ...extra,
    steps: [
      {
        name: `${name}-info`,
        elements: [
          ...elementNames.map(promptEl),
          { type: "submitButton", name: `${name}-agree` },
        ],
      },
    ],
  };
}

function seq(name: string, elementNames: string[]): Record<string, unknown> {
  return {
    name,
    introSteps: [
      {
        name: `${name}-step`,
        elements: [
          ...elementNames.map(promptEl),
          { type: "submitButton", name: `${name}-next` },
        ],
      },
    ],
  };
}

function minimalTreatment(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "t",
    playerCount: 1,
    compatibleIntroSequences: [],
    gameStages: [
      {
        name: "s1",
        duration: 60,
        elements: [{ type: "submitButton", name: "done" }],
      },
    ],
    ...overrides,
  };
}

function refCondition(key: string): Record<string, unknown> {
  return { reference: `self.prompt.${key}`, comparator: "exists" };
}

// --- schema ------------------------------------------------------------------

describe("schema: top-level consent collection", () => {
  test("consent arms with name/locale/steps validate", () => {
    const result = treatmentFileSchema.safeParse({
      consent: [
        consentArm("consent-en", ["ack"], { locale: "en" }),
        consentArm("consent-he", ["ack_he"], { locale: "he" }),
      ],
      treatments: [minimalTreatment()],
    });
    expect(result.success).toBe(true);
  });

  test("consent step without an advancement element → error", () => {
    const result = treatmentFileSchema.safeParse({
      consent: [
        {
          name: "c",
          steps: [{ name: "info", elements: [promptEl("ack")] }],
        },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.success
      ? []
      : result.error.issues.map((i) => i.message);
    expect(messages).toContain(ADVANCEMENT_ELEMENT_MESSAGE);
  });

  test("shared prompt in a consent step → error", () => {
    const result = treatmentFileSchema.safeParse({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              elements: [
                { ...promptEl("ack"), shared: true },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("position-targeting fields on consent elements → error (pre-assignment, single participant)", () => {
    const result = treatmentFileSchema.safeParse({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              elements: [
                { ...promptEl("ack"), showToPositions: [0] },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("duplicate consent arm names → error; arm may share a name with a treatment or intro sequence", () => {
    const dup = treatmentFileSchema.safeParse({
      consent: [consentArm("default", ["a1"]), consentArm("default", ["a2"])],
    });
    expect(dup.success).toBe(false);

    const crossCollection = treatmentFileSchema.safeParse({
      consent: [consentArm("default", ["ack"])],
      introSequences: [seq("default", ["color"])],
      treatments: [
        minimalTreatment({
          name: "default",
          compatibleIntroSequences: ["default"],
        }),
      ],
    });
    expect(crossCollection.success).toBe(true);
  });

  test("gating pattern: submit button conditioned on a same-step consent checkbox validates", () => {
    const result = treatmentFileSchema.safeParse({
      consent: [
        {
          name: "consent-en",
          steps: [
            {
              name: "info",
              elements: [
                promptEl("acknowledge"),
                {
                  type: "submitButton",
                  buttonText: "I consent",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("schema: per-treatment debrief", () => {
  test("debrief steps validate and require an advancement element", () => {
    const ok = treatmentFileSchema.safeParse({
      treatments: [
        minimalTreatment({
          debrief: [
            {
              name: "study-purpose",
              elements: [promptEl("purpose"), { type: "submitButton" }],
            },
          ],
        }),
      ],
    });
    expect(ok.success).toBe(true);

    const bad = treatmentFileSchema.safeParse({
      treatments: [
        minimalTreatment({
          debrief: [{ name: "study-purpose", elements: [promptEl("purpose")] }],
        }),
      ],
    });
    expect(bad.success).toBe(false);
  });
});

// --- references: consent is a closed scope ------------------------------------

describe("references: consent closed scope", () => {
  test("consent step referencing later-phase data (intro or game) → error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("color")],
                },
              ],
            },
          ],
        },
      ],
      introSequences: [seq("a", ["color"])],
      treatments: [minimalTreatment({ compatibleIntroSequences: ["a"] })],
    });
    expect(
      issues.some(
        (i) =>
          i.path[0] === "consent" && /later phase|consent/i.test(i.message),
      ),
    ).toBe(true);
  });

  test("within-arm reference to an earlier consent step is legal", () => {
    const issues = validateTreatmentFileReferences({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              elements: [promptEl("acknowledge"), { type: "submitButton" }],
            },
            {
              name: "confirm",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(issues).toHaveLength(0);
  });

  test("game-stage reference to a consent-only key → audit-only error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [consentArm("c", ["acknowledge"])],
      treatments: [
        minimalTreatment({
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [
                {
                  type: "submitButton",
                  name: "done",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        }),
      ],
    });
    const issue = issues.find((i) => /audit-only/i.test(i.message));
    expect(issue).toBeDefined();
  });

  test("intro-step reference to a consent-only key → audit-only error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [consentArm("c", ["acknowledge"])],
      introSequences: [
        {
          name: "a",
          introSteps: [
            {
              name: "w",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        },
      ],
      treatments: [minimalTreatment({ compatibleIntroSequences: ["a"] })],
    });
    expect(issues.some((i) => /audit-only/i.test(i.message))).toBe(true);
  });
});

// --- references: debrief joins the treatment flow -----------------------------

describe("references: debrief", () => {
  test("debrief may reference game-stage data; earlier phases may not reference debrief keys", () => {
    const issues = validateTreatmentFileReferences({
      treatments: [
        minimalTreatment({
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [
                promptEl("verdict"),
                { type: "submitButton", name: "done" },
                // forward ref into debrief — must be flagged
              ],
            },
            {
              name: "s2",
              duration: 60,
              elements: [
                {
                  type: "submitButton",
                  name: "d2",
                  conditions: [refCondition("reaction")],
                },
              ],
            },
          ],
          debrief: [
            {
              name: "purpose",
              elements: [
                promptEl("reaction"),
                {
                  type: "submitButton",
                  conditions: [refCondition("verdict")], // backward — legal
                },
              ],
            },
          ],
        }),
      ],
    });
    // game→debrief forward ref flagged; debrief→game backward ref clean
    expect(issues.some((i) => /later/i.test(i.message))).toBe(true);
    expect(
      issues.filter((i) => i.path.join(".").includes("debrief")),
    ).toHaveLength(0);
  });

  test("debrief reference to intro data is subject to the pairing positive check", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("b", ["shape"])],
      treatments: [
        minimalTreatment({
          compatibleIntroSequences: ["a", "b"],
          debrief: [
            {
              name: "purpose",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("color")], // b doesn't provide
                },
              ],
            },
          ],
        }),
      ],
    });
    const issue = issues.find((i) => /not provided by/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"b"');
  });
});

// --- collisions ----------------------------------------------------------------

describe("collisions: consent × everything; debrief in treatment scope", () => {
  test("consent key colliding with any intro sequence key → flagged regardless of pairing", () => {
    const collisions = collectStorageKeyCollisions({
      consent: [consentArm("c", ["shared_key"])],
      introSequences: [seq("a", ["shared_key"])],
      treatments: [minimalTreatment({ compatibleIntroSequences: [] })],
    });
    expect(collisions.length).toBeGreaterThan(0);
  });

  test("consent key colliding with a treatment (debrief) key → flagged", () => {
    const collisions = collectStorageKeyCollisions({
      consent: [consentArm("c", ["shared_key"])],
      treatments: [
        minimalTreatment({
          debrief: [
            {
              name: "d",
              elements: [promptEl("shared_key"), { type: "submitButton" }],
            },
          ],
        }),
      ],
    });
    expect(collisions.length).toBeGreaterThan(0);
  });

  test("consent-arm × consent-arm key reuse is legal (participant sees one arm)", () => {
    const collisions = collectStorageKeyCollisions({
      consent: [
        consentArm("c-en", ["acknowledge"]),
        consentArm("c-he", ["acknowledge"]),
      ],
    });
    expect(collisions).toHaveLength(0);
  });

  test("within-arm duplicate keys are still collisions", () => {
    const collisions = collectStorageKeyCollisions({
      consent: [consentArm("c", ["ack", "ack"])],
    });
    expect(collisions.length).toBeGreaterThan(0);
  });

  test("debrief key duplicating a game-stage key within the treatment → collision", () => {
    const collisions = collectStorageKeyCollisions({
      treatments: [
        minimalTreatment({
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [promptEl("k"), { type: "submitButton", name: "done" }],
            },
          ],
          debrief: [
            { name: "d", elements: [promptEl("k"), { type: "submitButton" }] },
          ],
        }),
      ],
    });
    expect(collisions.length).toBeGreaterThan(0);
  });
});

// --- locale consistency ---------------------------------------------------------

describe("locale: consent arms use their own locale; debrief uses the treatment's", () => {
  test("consent arm prompt in the wrong locale → mismatch against the ARM", () => {
    const mismatches = checkPromptLocaleConsistency(
      {
        consent: [consentArm("consent-he", ["ack"], { locale: "he" })],
      },
      new Map([["ack.prompt.md", "en"]]),
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].containerName).toBe("consent-he");
    expect(mismatches[0].containerLocale).toBe("he");
  });

  test("debrief prompt checked against the treatment locale", () => {
    const mismatches = checkPromptLocaleConsistency(
      {
        treatments: [
          minimalTreatment({
            locale: "he",
            debrief: [
              {
                name: "d",
                elements: [promptEl("purpose"), { type: "submitButton" }],
              },
            ],
          }),
        ],
      },
      new Map([["purpose.prompt.md", "en"]]),
    );
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].containerKind).toBe("treatment");
  });
});

// --- resolved (post-fill) --------------------------------------------------------

describe("resolved: consent and debrief post-fill shapes", () => {
  const resolvedStep = {
    name: "s",
    elements: [{ type: "submitButton", name: "b" }],
  };

  test("resolved file with consent + debrief passes", () => {
    const { success, issues } = validateResolvedTreatmentFile({
      consent: [{ name: "c", locale: "en", steps: [resolvedStep] }],
      treatments: [
        {
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: [],
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [{ type: "submitButton", name: "done" }],
            },
          ],
          debrief: [resolvedStep],
        },
      ],
    });
    expect(issues).toHaveLength(0);
    expect(success).toBe(true);
  });

  test("leaked ${...} in a consent arm locale → error post-fill", () => {
    const { success } = validateResolvedTreatmentFile({
      consent: [{ name: "c", locale: "${locale}", steps: [resolvedStep] }],
    });
    expect(success).toBe(false);
  });
});

// --- coverage-review additions -------------------------------------------------

describe("audit-only rule fires at every non-consent site", () => {
  test("exit-step reference to a consent-only key → audit-only error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [consentArm("c", ["acknowledge"])],
      treatments: [
        minimalTreatment({
          exitSequence: [
            {
              name: "e",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        }),
      ],
    });
    const issue = issues.find((i) => /audit-only/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.path.slice(0, 3)).toEqual(["treatments", 0, "exitSequence"]);
  });

  test("debrief-step reference to a consent-only key → audit-only error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [consentArm("c", ["acknowledge"])],
      treatments: [
        minimalTreatment({
          debrief: [
            {
              name: "d",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("acknowledge")],
                },
              ],
            },
          ],
        }),
      ],
    });
    const issue = issues.find((i) => /audit-only/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.path.slice(0, 3)).toEqual(["treatments", 0, "debrief"]);
  });

  test("groupComposition reference to a consent-only key → audit-only error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [consentArm("c", ["acknowledge"])],
      treatments: [
        minimalTreatment({
          playerCount: 2,
          groupComposition: [
            {
              position: 0,
              title: "x",
              conditions: [refCondition("acknowledge")],
            },
          ],
        }),
      ],
    });
    expect(issues.some((i) => /audit-only/i.test(i.message))).toBe(true);
  });

  test("key produced by BOTH consent and intro: collision fires, audit-only stands down", () => {
    const file = {
      consent: [consentArm("c", ["color"])],
      introSequences: [
        {
          name: "a",
          introSteps: [
            {
              name: "s",
              elements: [promptEl("color"), { type: "submitButton" }],
            },
          ],
        },
      ],
      treatments: [
        minimalTreatment({
          compatibleIntroSequences: ["a"],
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [
                {
                  type: "submitButton",
                  name: "done",
                  conditions: [refCondition("color")],
                },
              ],
            },
          ],
        }),
      ],
    };
    expect(validateTreatmentFileReferences(file)).toHaveLength(0);
    const collisions = collectStorageKeyCollisions(file);
    expect(
      collisions.some(
        (c) =>
          c.key === "prompt_color" &&
          /consent arm "c" × introSequence "a"/.test(c.message),
      ),
    ).toBe(true);
  });
});

describe("consent scope details", () => {
  test("consent arm referencing ANOTHER arm's key → unknown-ref with consent-arm wording", () => {
    const issues = validateTreatmentFileReferences({
      consent: [
        consentArm("c-en", ["ack_en"]),
        {
          name: "c-he",
          steps: [
            {
              name: "info",
              elements: [
                {
                  type: "submitButton",
                  conditions: [refCondition("ack_en")],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].path.slice(0, 2)).toEqual(["consent", 1]);
    expect(issues[0].message).toMatch(/doesn't match any prompt element/);
    expect(issues[0].message).toContain("this consent arm");
  });

  test("stage-level always-skip (Rule 2) applies inside consent steps", () => {
    const issues = validateTreatmentFileReferences({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              conditions: [
                {
                  reference: "self.prompt.ack",
                  comparator: "equals",
                  value: "yes",
                },
              ],
              elements: [promptEl("ack"), { type: "submitButton" }],
            },
          ],
        },
      ],
    });
    expect(
      issues.some((i) => /always skip the stage at load/.test(i.message)),
    ).toBe(true);
  });
});

describe("consent template content types", () => {
  test("invalid content under contentType consentArm → prefixed step-rule error", () => {
    const result = treatmentFileSchema.safeParse({
      templates: [
        {
          name: "bad-arm",
          contentType: "consentArm",
          content: {
            name: "c",
            steps: [{ name: "info", elements: [promptEl("ack")] }],
          },
        },
      ],
      consent: [{ template: "bad-arm" }],
    });
    expect(result.success).toBe(false);
    const messages = result.success
      ? []
      : result.error.issues.map((i) => i.message);
    expect(
      messages.some((m) =>
        m.startsWith("Invalid content for contentType 'consentArm':"),
      ),
    ).toBe(true);
  });

  test("template-driven consent arms with placeholder names skip the source-pass uniqueness check", () => {
    const result = treatmentFileSchema.safeParse({
      templates: [
        {
          name: "arm",
          contentType: "consentArm",
          content: {
            name: "consent ${locale}",
            locale: "${locale}",
            steps: [
              {
                name: "info",
                elements: [promptEl("ack"), { type: "submitButton" }],
              },
            ],
          },
        },
      ],
      consent: [
        { template: "arm", fields: { locale: "en" } },
        { template: "arm", fields: { locale: "en" } },
      ],
    });
    const uniquenessIssues = result.success
      ? []
      : result.error.issues.filter((i) =>
          /already used by an earlier consent arm/.test(i.message),
        );
    expect(uniquenessIssues).toHaveLength(0);
  });

  test("resolved layer catches duplicate arm names post-expansion", () => {
    const { success, issues } = validateResolvedTreatmentFile({
      consent: [
        {
          name: "consent en",
          locale: "en",
          steps: [
            { name: "info", elements: [{ type: "submitButton", name: "b" }] },
          ],
        },
        {
          name: "consent en",
          locale: "en",
          steps: [
            { name: "info", elements: [{ type: "submitButton", name: "b" }] },
          ],
        },
      ],
    });
    expect(success).toBe(false);
    expect(
      issues.some((i) =>
        /already used by an earlier consent arm/.test(i.message),
      ),
    ).toBe(true);
  });
});

describe("whole-value template invocations at step-list positions don't throw", () => {
  // Pre-existing latent crash on main for introSteps/exitSequence,
  // guarded when the shared step-refine landed: the chained superRefine
  // receives the raw {template: ...} object, not the expanded array.
  test("safeParse returns diagnostics (not a throw) for template-valued step lists", () => {
    for (const file of [
      { consent: [{ name: "c", steps: { template: "t" } }] },
      {
        treatments: [minimalTreatment({ debrief: { template: "t" } })],
      },
      {
        introSequences: [{ name: "a", introSteps: { template: "t" } }],
        treatments: [minimalTreatment({ compatibleIntroSequences: ["a"] })],
      },
      {
        treatments: [minimalTreatment({ exitSequence: { template: "t" } })],
      },
    ]) {
      expect(() => treatmentFileSchema.safeParse(file)).not.toThrow();
    }
  });
});

describe("resolved-layer uniqueness message hardening (Copilot review)", () => {
  test("oversized control-laden duplicate names are truncated and stripped post-fill", () => {
    const hostile = `${"x".repeat(200)}\u001b[2J\nname`;
    const step = {
      name: "s",
      elements: [{ type: "submitButton", name: "b" }],
    };
    const { success, issues } = validateResolvedTreatmentFile({
      consent: [
        { name: hostile, steps: [step] },
        { name: hostile, steps: [step] },
      ],
    });
    expect(success).toBe(false);
    const dup = issues.find((i) =>
      /already used by an earlier consent arm/.test(i.message),
    );
    expect(dup).toBeDefined();
    expect(dup!.message.length).toBeLessThan(300);
    expect(dup!.message).not.toContain("\u001b");
  });
});

// --- Codex review round (#501) -------------------------------------------------

describe("sampleId is pre-game in consent steps", () => {
  test("consent condition on attributes.sampleId → error", () => {
    const issues = validateTreatmentFileReferences({
      consent: [
        {
          name: "c",
          steps: [
            {
              name: "info",
              elements: [
                {
                  type: "submitButton",
                  conditions: [
                    {
                      reference: "self.attributes.sampleId",
                      comparator: "exists",
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const issue = issues.find((i) => /sampleId/.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("consent step");
  });
});

describe("resolved consent-arm names must be concrete", () => {
  test("leaked ${...} in an arm name → tagged error, filtered in authoring contexts", () => {
    const step = {
      name: "s",
      elements: [{ type: "submitButton", name: "b" }],
    };
    const file = {
      consent: [{ name: "consent ${locale}", locale: "en", steps: [step] }],
    };
    const strict = validateResolvedTreatmentFile(file);
    expect(strict.success).toBe(false);
    expect(
      strict.issues.every((i) => i.reason === "unresolved-placeholder"),
    ).toBe(true);
    const lax = validateResolvedTreatmentFile(file, { skipUnresolved: true });
    expect(lax.issues).toHaveLength(0);
  });
});

describe("dead-gate rule (#480) covers consent and debrief steps", () => {
  const ackPrompt = promptFileSchema.parse(
    `---\ntype: multipleChoice\nselect: multiple\n---\nPick\n---\n- I have read and understood\n`,
  );
  const singlePrompt = promptFileSchema.parse(
    `---\ntype: multipleChoice\n---\nPick\n---\n- Yes\n- No\n`,
  );
  const gate = (value: string) => ({
    reference: "self.prompt.ack.value",
    comparator: "includes",
    value,
  });

  test("consent gate whose value matches no option → flagged", () => {
    const issues = checkUnsatisfiableConditions(
      {
        consent: [
          {
            name: "c",
            steps: [
              {
                name: "info",
                elements: [
                  { type: "prompt", file: "ack.prompt.md", name: "ack" },
                  { type: "submitButton", conditions: [gate("I consent!!")] },
                ],
              },
            ],
          },
        ],
      },
      new Map([["ack.prompt.md", singlePrompt]]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path[0]).toBe("consent");
  });

  test("debrief gate whose value matches no option → flagged", () => {
    const issues = checkUnsatisfiableConditions(
      {
        treatments: [
          minimalTreatment({
            debrief: [
              {
                name: "d",
                elements: [
                  { type: "prompt", file: "ack.prompt.md", name: "ack" },
                  { type: "submitButton", conditions: [gate("nope")] },
                ],
              },
            ],
          }),
        ],
      },
      new Map([["ack.prompt.md", singlePrompt]]),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path.join(".")).toContain("debrief");
  });

  test("multi-select acknowledgement stays out of scope (documented v1 non-goal)", () => {
    const issues = checkUnsatisfiableConditions(
      {
        consent: [
          {
            name: "c",
            steps: [
              {
                name: "info",
                elements: [
                  { type: "prompt", file: "ack.prompt.md", name: "ack" },
                  { type: "submitButton", conditions: [gate("anything")] },
                ],
              },
            ],
          },
        ],
      },
      new Map([["ack.prompt.md", ackPrompt]]),
    );
    expect(issues).toHaveLength(0);
  });
});
