import { describe, expect, test } from "vitest";
import { treatmentFileSchema } from "./treatment.js";
import { validateTreatmentFileReferences } from "./validateReferences.js";
import { collectStorageKeyCollisions } from "./storageKeyCollisions.js";
import { validateResolvedTreatmentFile } from "./resolved.js";
import { validateTreatmentSource } from "../validate/validateTreatment.js";

/**
 * Treatment-level `introSequences:` pairing (#499).
 *
 * Covers the four cooperating pieces:
 *   - schema: the field is required on every treatment (breaking)
 *   - walker: name resolution + the positive per-pair reference check
 *   - collisions: intro × treatment cross-pairs narrow to declared pairs
 *   - resolved: post-fill leak checks
 */

// --- fixture builders ------------------------------------------------------

function promptEl(name: string): Record<string, unknown> {
  return { type: "prompt", file: `${name}.prompt.md`, name };
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

function treatment(opts: {
  name?: string;
  introSequences?: unknown;
  gameStages?: Record<string, unknown>[];
  omitIntroSequences?: boolean;
}): Record<string, unknown> {
  const t: Record<string, unknown> = {
    name: opts.name ?? "t",
    playerCount: 1,
    gameStages: opts.gameStages ?? [
      {
        name: "s1",
        duration: 60,
        elements: [{ type: "submitButton", name: "done" }],
      },
    ],
  };
  if (!opts.omitIntroSequences) {
    t.introSequences = opts.introSequences ?? [];
  }
  return t;
}

/** Stage whose element is gated on an intro-provided prompt answer. */
function stageReferencing(key: string): Record<string, unknown> {
  return {
    name: "s1",
    duration: 60,
    elements: [
      {
        type: "submitButton",
        name: "done",
        conditions: [
          {
            reference: `self.prompt.${key}`,
            comparator: "exists",
          },
        ],
      },
    ],
  };
}

// --- schema: required field ------------------------------------------------

describe("schema: introSequences is required on every treatment", () => {
  test("treatment without introSequences → error mentioning the field", () => {
    const result = treatmentFileSchema.safeParse({
      treatments: [treatment({ omitIntroSequences: true })],
    });
    expect(result.success).toBe(false);
    const messages = result.success
      ? []
      : result.error.issues.map((i) => i.message);
    expect(
      messages.some((m) => /must declare `?introSequences`?/i.test(m)),
    ).toBe(true);
  });

  test("introSequences: [] is accepted", () => {
    const result = treatmentFileSchema.safeParse({
      treatments: [treatment({ introSequences: [] })],
    });
    expect(result.success).toBe(true);
  });

  test("whole-field ${...} placeholder is accepted pre-fill", () => {
    const result = treatmentFileSchema.safeParse({
      treatments: [treatment({ introSequences: "${intros}" })],
    });
    expect(result.success).toBe(true);
  });

  test("per-item ${...} placeholder is accepted pre-fill", () => {
    const result = treatmentFileSchema.safeParse({
      introSequences: [seq("a", ["color"])],
      treatments: [treatment({ introSequences: ["${pathway}"] })],
    });
    expect(result.success).toBe(true);
  });
});

// --- walker: name resolution ------------------------------------------------

describe("walker: introSequences name resolution", () => {
  test("dangling sequence name → error naming treatment and sequence", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [treatment({ name: "tx", introSequences: ["a", "ghost"] })],
    });
    const issue = issues.find((i) =>
      i.path.join(".").endsWith("treatments.0.introSequences.1"),
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"tx"');
    expect(issue?.message).toContain('"ghost"');
    expect(issue?.message).toMatch(/lists intro sequence/);
  });

  test("duplicate entry → issue worded as a duplicate (warning severity downstream)", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [treatment({ introSequences: ["a", "a"] })],
    });
    const issue = issues.find((i) =>
      i.path.join(".").endsWith("treatments.0.introSequences.1"),
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/duplicate/i);
  });

  test("duplicate entry surfaces as a WARNING through validateTreatmentSource", () => {
    const src = `
introSequences:
  - name: a
    introSteps:
      - name: step
        elements:
          - { type: prompt, file: color.prompt.md, name: color }
          - type: submitButton
treatments:
  - name: t
    playerCount: 1
    introSequences: [a, a]
    gameStages:
      - name: s1
        duration: 60
        elements:
          - { type: submitButton, name: done }
`;
    const { diagnostics } = validateTreatmentSource(src);
    const dup = diagnostics.find((d) => /duplicate entry/i.test(d.message));
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("warning");
  });

  test("dangling-only declaration → dangling error AND unknown-ref error (no union fallback)", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [
        treatment({
          introSequences: ["ghost"],
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues.some((i) => /lists intro sequence/.test(i.message))).toBe(
      true,
    );
    expect(issues.some((i) => /doesn't match any/i.test(i.message))).toBe(true);
  });

  test("duplicate + dangling combined → one dangling (idx 0), one duplicate (idx 1)", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [treatment({ introSequences: ["ghost", "ghost"] })],
    });
    const dangling = issues.filter((i) =>
      /but no intro sequence with that name/.test(i.message),
    );
    const dups = issues.filter((i) => /duplicate entry/.test(i.message));
    expect(dangling).toHaveLength(1);
    expect(dangling[0].path.join(".")).toBe("treatments.0.introSequences.0");
    expect(dups).toHaveLength(1);
    expect(dups[0].path.join(".")).toBe("treatments.0.introSequences.1");
  });

  test("no introSequences collection in file → name checks are skipped", () => {
    const issues = validateTreatmentFileReferences({
      treatments: [treatment({ introSequences: ["ghost"] })],
    });
    expect(
      issues.filter((i) => /lists intro sequence/.test(i.message)),
    ).toHaveLength(0);
  });
});

// --- walker: positive per-pair reference check -------------------------------

describe("walker: references must resolve in every listed sequence", () => {
  test("key provided by all listed sequences → no issue", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("b", ["color"])],
      treatments: [
        treatment({
          introSequences: ["a", "b"],
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues).toHaveLength(0);
  });

  test("key missing from one listed sequence → error naming that sequence", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("b", ["shape"])],
      treatments: [
        treatment({
          introSequences: ["a", "b"],
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    const issue = issues.find((i) => /not provided by/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"b"');
    expect(issue?.message).not.toContain('"a"');
  });

  test("key provided only by a non-listed sequence → unknown-ref error with a hint", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("c", ["shape"])],
      treatments: [
        treatment({
          introSequences: ["a"],
          gameStages: [stageReferencing("shape")],
        }),
      ],
    });
    const issue = issues.find((i) => /doesn't match any/i.test(i.message));
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"c"');
  });

  test("introSequences: [] with an intro-style reference → unknown-ref error", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [
        treatment({
          introSequences: [],
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues.some((i) => /doesn't match any/i.test(i.message))).toBe(true);
  });

  test("key produced by an earlier own game stage → listed sequences need not provide it", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("b", [])],
      treatments: [
        treatment({
          introSequences: ["a", "b"],
          gameStages: [
            {
              name: "produce",
              duration: 60,
              elements: [promptEl("color"), { type: "submitButton" }],
            },
            stageReferencing("color"),
          ],
        }),
      ],
    });
    expect(
      issues.filter((i) => /not provided by/i.test(i.message)),
    ).toHaveLength(0);
  });

  test("positive check fires at groupComposition and exit-step sites too", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"]), seq("b", ["shape"])],
      treatments: [
        {
          name: "t",
          playerCount: 1,
          introSequences: ["a", "b"],
          groupComposition: [
            {
              position: 0,
              title: "x",
              conditions: [
                { reference: "self.prompt.color", comparator: "exists" },
              ],
            },
          ],
          gameStages: [
            {
              name: "s1",
              duration: 60,
              elements: [{ type: "submitButton", name: "done" }],
            },
          ],
          exitSequence: [
            {
              name: "exit1",
              elements: [
                {
                  type: "submitButton",
                  name: "bye",
                  conditions: [
                    { reference: "self.prompt.color", comparator: "exists" },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const pairingIssues = issues.filter((i) =>
      /not provided by/i.test(i.message),
    );
    expect(pairingIssues.map((i) => i.path.join("."))).toEqual([
      "treatments.0.groupComposition.0.conditions.0.reference",
      "treatments.0.exitSequence.0.elements.0.conditions.0.reference",
    ]);
  });

  test("whole-field placeholder → positive check and name checks are skipped", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [
        treatment({
          introSequences: "${intros}",
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues).toHaveLength(0);
  });

  test("per-item placeholder → positive check skipped, concrete dangling names still flagged", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [
        treatment({
          introSequences: ["${pathway}", "ghost"],
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues.some((i) => /lists intro sequence/.test(i.message))).toBe(
      true,
    );
    expect(
      issues.filter((i) => /not provided by/i.test(i.message)),
    ).toHaveLength(0);
  });

  test("missing field → walker falls back to union (schema owns the requiredness error)", () => {
    const issues = validateTreatmentFileReferences({
      introSequences: [seq("a", ["color"])],
      treatments: [
        treatment({
          omitIntroSequences: true,
          gameStages: [stageReferencing("color")],
        }),
      ],
    });
    expect(issues).toHaveLength(0);
  });
});

// --- collisions: narrowed to declared pairs ----------------------------------

describe("collisions: intro × treatment cross-pairs narrow to declared pairs", () => {
  const fileWithSharedKey = (declared: unknown) => ({
    introSequences: [seq("a", ["color"]), seq("b", ["shape"])],
    treatments: [
      {
        name: "t",
        playerCount: 1,
        introSequences: declared,
        gameStages: [
          {
            name: "s1",
            duration: 60,
            // `shape` collides with sequence b only.
            elements: [promptEl("shape"), { type: "submitButton" }],
          },
        ],
      },
    ],
  });

  test("collision with a declared sequence → flagged", () => {
    const collisions = collectStorageKeyCollisions(fileWithSharedKey(["b"]));
    expect(collisions.length).toBeGreaterThan(0);
  });

  test("collision only with a non-declared sequence → not flagged", () => {
    const collisions = collectStorageKeyCollisions(fileWithSharedKey(["a"]));
    expect(collisions).toHaveLength(0);
  });

  test("placeholder declaration → cross-pair check skipped for that treatment", () => {
    const collisions = collectStorageKeyCollisions(
      fileWithSharedKey("${intros}"),
    );
    expect(collisions).toHaveLength(0);
  });
});

// --- resolved: post-fill leak checks -----------------------------------------

describe("resolved: introSequences must be concrete post-fill", () => {
  const resolvedStage = {
    name: "s1",
    duration: 60,
    elements: [{ type: "submitButton", name: "done" }],
  };

  test("leaked whole-field placeholder → error", () => {
    const { success } = validateResolvedTreatmentFile({
      treatments: [
        {
          name: "t",
          playerCount: 1,
          introSequences: "${intros}",
          gameStages: [resolvedStage],
        },
      ],
    });
    expect(success).toBe(false);
  });

  test("leaked per-item placeholder → error", () => {
    const { success } = validateResolvedTreatmentFile({
      treatments: [
        {
          name: "t",
          playerCount: 1,
          introSequences: ["${pathway}"],
          gameStages: [resolvedStage],
        },
      ],
    });
    expect(success).toBe(false);
  });

  test("missing field post-fill → error", () => {
    const { success } = validateResolvedTreatmentFile({
      treatments: [{ name: "t", playerCount: 1, gameStages: [resolvedStage] }],
    });
    expect(success).toBe(false);
  });

  test("concrete names → clean", () => {
    const { success, issues } = validateResolvedTreatmentFile({
      treatments: [
        {
          name: "t",
          playerCount: 1,
          introSequences: ["a"],
          gameStages: [resolvedStage],
        },
      ],
    });
    expect(issues).toHaveLength(0);
    expect(success).toBe(true);
  });
});

// --- resolved: both leak forms share the can't-prove posture ------------------

describe("resolved: placeholder leaks are tagged for authoring contexts", () => {
  const resolvedStage = {
    name: "s1",
    duration: 60,
    elements: [{ type: "submitButton", name: "done" }],
  };
  const fileWith = (introSequences: unknown) => ({
    treatments: [
      {
        name: "t",
        playerCount: 1,
        introSequences,
        gameStages: [resolvedStage],
      },
    ],
  });

  test("whole-field and per-item leaks are both filtered under skipUnresolved", () => {
    for (const leak of ["${intros}", ["${pathway}"]]) {
      const lax = validateResolvedTreatmentFile(fileWith(leak), {
        skipUnresolved: true,
      });
      expect(lax.issues).toHaveLength(0);
      const strict = validateResolvedTreatmentFile(fileWith(leak));
      expect(strict.success).toBe(false);
      expect(
        strict.issues.every((i) => i.reason === "unresolved-placeholder"),
      ).toBe(true);
    }
  });

  test("wrong-typed value keeps the guidance message pre-fill", () => {
    const result = treatmentFileSchema.safeParse({
      treatments: [
        {
          name: "t",
          playerCount: 1,
          introSequences: 5,
          gameStages: [resolvedStage],
        },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.success
      ? []
      : result.error.issues.map((i) => i.message);
    expect(messages.some((m) => /must declare `introSequences:`/.test(m))).toBe(
      true,
    );
  });
});
