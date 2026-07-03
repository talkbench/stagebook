import { describe, expect, test } from "vitest";
import {
  treatmentFileSchema,
  ADVANCEMENT_ELEMENT_MESSAGE,
} from "./treatment.js";
import { validateTreatmentFileReferences } from "./validateReferences.js";
import { collectStorageKeyCollisions } from "./storageKeyCollisions.js";
import { checkPromptLocaleConsistency } from "./localeConsistency.js";
import { validateResolvedTreatmentFile } from "./resolved.js";

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
    introSequences: [],
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
        minimalTreatment({ name: "default", introSequences: ["default"] }),
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
      treatments: [minimalTreatment({ introSequences: ["a"] })],
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
      treatments: [minimalTreatment({ introSequences: ["a"] })],
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
          introSequences: ["a", "b"],
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
      treatments: [minimalTreatment({ introSequences: [] })],
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
          introSequences: [],
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
