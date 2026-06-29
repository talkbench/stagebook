import { describe, expect, test } from "vitest";
import { treatmentFileSchema } from "./treatment.js";
import { validateTreatmentFileReferences } from "./validateReferences.js";

// Helpers — build minimal-valid treatment files with targeted modifications.
// We use the full treatmentFileSchema in some tests to confirm that issues
// surface through the schema's superRefine (i.e. they'd cause red squiggles
// in the VS Code extension), and call the walker directly in others to
// avoid noise from other schema rules.

interface StageConfig {
  name: string;
  duration?: number;
  conditions?: Record<string, unknown>[];
  elements: Record<string, unknown>[];
}

function baseFile(opts: {
  introSteps?: StageConfig[];
  gameStages?: StageConfig[];
  exitSequence?: StageConfig[];
  groupComposition?: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    introSequences: [
      {
        name: "seq",
        introSteps: opts.introSteps ?? [
          { name: "welcome", elements: [{ type: "submitButton" }] },
        ],
      },
    ],
    treatments: [
      {
        name: "t",
        playerCount: 2,
        gameStages: opts.gameStages ?? [
          {
            name: "s1",
            duration: 60,
            elements: [{ type: "submitButton" }],
          },
        ],
        ...(opts.exitSequence ? { exitSequence: opts.exitSequence } : {}),
        ...(opts.groupComposition
          ? { groupComposition: opts.groupComposition }
          : {}),
      },
    ],
  };
}

function pickForwardRefIssue(
  issues: { path: (string | number)[]; message: string }[],
  pathSuffix: string,
) {
  return issues.find(
    (i) => i.path.join(".").endsWith(pathSuffix) && /later/i.test(i.message),
  );
}

function pickAlwaysSkipIssue(
  issues: { path: (string | number)[]; message: string }[],
  pathSuffix: string,
) {
  return issues.find(
    (i) =>
      i.path.join(".").endsWith(pathSuffix) &&
      /always skip the stage at load/i.test(i.message),
  );
}

describe("Rule 1 — no forward references", () => {
  test("stage-level condition referencing a future stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.laterAnswer",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.conditions.0.reference",
      ),
    ).toBeDefined();
  });

  test("element-level condition referencing a future stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "submitButton",
              conditions: [
                {
                  reference: "self.prompt.laterAnswer",
                  comparator: "equals",
                  value: "yes",
                },
              ],
            },
          ],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.elements.0.conditions.0.reference",
      ),
    ).toBeDefined();
  });

  test("display element.reference pointing at a later stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "display", reference: "self.prompt.laterAnswer" },
            { type: "submitButton" },
          ],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.elements.0.reference",
      ),
    ).toBeDefined();
  });

  test("trackedLink urlParams[i].reference pointing at a later stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "trackedLink",
              name: "signup",
              url: "https://example.org",
              displayText: "Go",
              urlParams: [
                { key: "answer", reference: "self.prompt.laterAnswer" },
              ],
            },
          ],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.elements.0.urlParams.0.reference",
      ),
    ).toBeDefined();
  });

  test("qualtrics urlParams[i].reference pointing at a later stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "qualtrics",
              url: "https://upenn.qualtrics.com/jfe/form/SV_x",
              urlParams: [{ key: "x", reference: "self.prompt.laterAnswer" }],
            },
          ],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.elements.0.urlParams.0.reference",
      ),
    ).toBeDefined();
  });

  test("discussion.conditions[i].reference pointing at a later stage → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          discussion: {
            chatType: "text",
            showNickname: true,
            showTitle: false,
            conditions: [
              {
                reference: "shared.prompt.laterAnswer",
                comparator: "equals",
                value: "yes",
              },
            ],
          },
          elements: [{ type: "submitButton" }],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "laterAnswer",
              file: "p.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    } as never);
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickForwardRefIssue(
        issues,
        "treatments.0.gameStages.0.discussion.conditions.0.reference",
      ),
    ).toBeDefined();
  });

  test("groupComposition condition referencing game-stage data → rejected (stricter)", () => {
    const file = baseFile({
      groupComposition: [
        {
          position: 0,
          title: "Confederate",
          conditions: [
            {
              reference: "self.prompt.gameStageAnswer",
              comparator: "equals",
              value: "yes",
            },
          ],
        },
        {
          position: 1,
          title: "Participant",
          conditions: [
            {
              reference: "self.prompt.gameStageAnswer",
              comparator: "doesNotEqual",
              value: "yes",
            },
          ],
        },
      ],
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "gameStageAnswer",
              file: "q.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hits = issues.filter((i) => /groupComposition/i.test(i.message));
    expect(hits.length).toBe(2);
  });

  test("groupComposition condition referencing intro data → accepted", () => {
    const file = baseFile({
      introSteps: [
        {
          name: "survey_step",
          elements: [
            {
              type: "prompt",
              name: "partyAffiliation",
              file: "pa.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
      groupComposition: [
        {
          position: 0,
          title: "D",
          conditions: [
            {
              reference: "self.prompt.partyAffiliation",
              comparator: "equals",
              value: "democrat",
            },
          ],
        },
        {
          position: 1,
          title: "R",
          conditions: [
            {
              reference: "self.prompt.partyAffiliation",
              comparator: "equals",
              value: "republican",
            },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("intro-step condition referencing game-stage data → rejected (cross-phase forward)", () => {
    // Intro always runs before game, so a reference FROM intro TO game is
    // always falsy at runtime. Caught via the laterPhaseKeys set.
    const file = baseFile({
      introSteps: [
        {
          name: "welcome",
          conditions: [
            {
              reference: "self.prompt.gameAnswer",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
      ],
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "prompt", name: "gameAnswer", file: "g.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find(
      (i) =>
        i.path.join(".") ===
          "introSequences.0.introSteps.0.conditions.0.reference" &&
        /later phase/i.test(i.message),
    );
    expect(hit).toBeDefined();
  });

  test("intro-step display.reference targeting game-stage data → rejected", () => {
    const file = baseFile({
      introSteps: [
        {
          name: "welcome",
          elements: [
            { type: "display", reference: "self.prompt.gameAnswer" },
            { type: "submitButton" },
          ],
        },
      ],
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "prompt", name: "gameAnswer", file: "g.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find(
      (i) =>
        i.path.join(".") ===
          "introSequences.0.introSteps.0.elements.0.reference" &&
        /later phase/i.test(i.message),
    );
    expect(hit).toBeDefined();
  });

  test("survey produces a storage key from surveyName when name is absent", () => {
    // Element.tsx derives the storage key as
    // `survey_${element.name ?? element.surveyName}`. The walker has to
    // match, otherwise forward references to `survey.<surveyName>` slip
    // through when authors omit the optional `name`.
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            {
              type: "display",
              reference: "self.survey.MySurvey.result.answer",
            },
            { type: "submitButton" },
          ],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            // no `name:` — storage key derives from surveyName
            { type: "survey", surveyName: "MySurvey" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find(
      (i) =>
        i.path.join(".") === "treatments.0.gameStages.0.elements.0.reference" &&
        /later/i.test(i.message),
    );
    expect(hit).toBeDefined();
  });

  test("external references (entryUrl.params.x, attributes.x) accepted at every site", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: [
            {
              reference: "shared.entryUrl.params.cohort",
              comparator: "equals",
              value: "a",
            },
          ],
          elements: [
            {
              type: "display",
              reference: "self.attributes.stableParticipantId",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  const hasSampleIdIssue = (issues: { message: string }[]): boolean =>
    issues.some((i) => /attributes\.sampleId/.test(i.message));

  test("attributes.sampleId is rejected in an intro step (#473)", () => {
    // In an intro step it's empty at runtime (assigned at game start).
    const introFile = baseFile({
      introSteps: [
        {
          name: "i1",
          elements: [
            { type: "display", reference: "self.attributes.sampleId" },
          ],
        },
      ],
    });
    expect(hasSampleIdIssue(validateTreatmentFileReferences(introFile))).toBe(
      true,
    );
  });

  test("attributes.sampleId is rejected in groupComposition (#473)", () => {
    // groupComposition runs before any stage — sampleId doesn't exist yet.
    const gcFile = baseFile({
      groupComposition: [
        {
          position: 0,
          conditions: [
            { reference: "self.attributes.sampleId", comparator: "exists" },
          ],
        },
      ],
    });
    expect(hasSampleIdIssue(validateTreatmentFileReferences(gcFile))).toBe(
      true,
    );
  });

  test("attributes.sampleId is accepted in a game stage (#473)", () => {
    const gameFile = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "display", reference: "self.attributes.sampleId" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    expect(hasSampleIdIssue(validateTreatmentFileReferences(gameFile))).toBe(
      false,
    );
  });

  test("attributes.sampleId is accepted in an exit step (#473)", () => {
    // Exit runs after the game — sampleId has been assigned.
    const exitFile = baseFile({
      exitSequence: [
        {
          name: "e1",
          elements: [
            { type: "display", reference: "self.attributes.sampleId" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    expect(hasSampleIdIssue(validateTreatmentFileReferences(exitFile))).toBe(
      false,
    );
  });

  test("non-sampleId attributes fields are NOT gated pre-game (#473)", () => {
    // Only the sampleId subpath is phase-restricted; other attributes come
    // from connect and are valid anywhere, including intro.
    const introFile = baseFile({
      introSteps: [
        {
          name: "i1",
          elements: [
            { type: "display", reference: "self.attributes.country" },
            {
              type: "display",
              reference: "self.attributes.stableParticipantId",
            },
          ],
        },
      ],
    });
    expect(validateTreatmentFileReferences(introFile).length).toBe(0);
  });

  test("earlier-stage reference accepted", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "prompt", name: "early", file: "e.prompt.md" },
            { type: "submitButton" },
          ],
        },
        {
          name: "s2",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.early",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("exit-stage reference to game-stage data accepted", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          elements: [
            { type: "prompt", name: "main", file: "m.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
      exitSequence: [
        {
          name: "debrief",
          conditions: [
            {
              reference: "shared.prompt.main",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });
});

describe("Unknown-reference detection", () => {
  test("element-level condition referencing a non-existent timeline → rejected as typo", () => {
    // Regression: a typo like `timeline.storySegment2` for an actual
    // element named `storySegment` previously passed validation because
    // the target wasn't in producedAt (so the walker returned early).
    const file = baseFile({
      gameStages: [
        {
          name: "story",
          duration: 60,
          elements: [
            {
              type: "mediaPlayer",
              file: "asset://x.mp4",
              name: "story",
            },
            {
              type: "timeline",
              source: "story",
              name: "storySegment",
              selectionType: "range",
            },
            {
              type: "submitButton",
              conditions: [
                {
                  reference: "self.timeline.storySegment2",
                  comparator: "exists",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const typo = issues.find(
      (i) =>
        i.path.join(".").endsWith("elements.2.conditions.0.reference") &&
        /doesn't match any timeline element/i.test(i.message),
    );
    expect(typo).toBeDefined();
  });

  test("stage-level condition referencing a non-existent prompt → rejected as typo", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.nonexistent",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const typo = issues.find(
      (i) =>
        /doesn't match any prompt element/i.test(i.message) &&
        i.message.includes("nonexistent"),
    );
    expect(typo).toBeDefined();
  });

  test("reference whose target is produced by a template → flagged on source pass (strict-by-default)", () => {
    // The reference's producer is inside a template's `content`,
    // not in the consuming treatment's gameStages. Per the #321
    // strict-by-default change, the schema's reference checker no
    // longer treats "produced anywhere in the file" as reachable —
    // the producer has to be in the treatment's reachable set
    // (intros + own stages + own exit). On the unfilled source pass
    // (templates not yet expanded), this fires.
    //
    // This is the canonical templating-artifact case: on the
    // HYDRATED form (after fillTemplates injects the template's
    // content into the treatment), the producer IS reachable and
    // no error fires. The diff orchestrator routes the source-pass
    // diagnostic to its `sourceOnly` bucket and the editor surfaces
    // it as a warning, not an error. Callers that want to
    // distinguish artifacts from real bugs should use the orchestrator
    // (`runValidationDiff`) rather than calling
    // `validateTreatmentFileReferences` directly on raw source.
    const file = {
      templates: [
        {
          name: "storyStage",
          contentType: "stage",
          content: {
            name: "templated",
            duration: 60,
            elements: [
              {
                type: "prompt",
                name: "templatedPrompt",
                file: "p.prompt.md",
              },
              { type: "submitButton" },
            ],
          },
        },
      ],
      introSequences: [
        {
          name: "seq",
          introSteps: [{ name: "a", elements: [{ type: "submitButton" }] }],
        },
      ],
      treatments: [
        {
          name: "t",
          playerCount: 1,
          gameStages: [
            {
              name: "uses",
              duration: 60,
              elements: [
                {
                  type: "display",
                  reference: "self.prompt.templatedPrompt",
                },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    };
    const issues = validateTreatmentFileReferences(file);
    // The strict rule fires on source-pass for this case.
    const unknown = issues.find((i) => i.message.includes("templatedPrompt"));
    expect(unknown).toBeDefined();
  });

  test("discussion.* references are not flagged as unknown (we don't model their storage keys)", () => {
    // Regression: before the fix, `discussion.anyName.x` would fall
    // through the walker as "unknown" because no discussion keys live
    // in producedAt/globalProducedKeys. Leave discussion refs alone.
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          elements: [
            {
              type: "submitButton",
              conditions: [
                {
                  reference: "self.discussion.someRoom.messages",
                  comparator: "exists",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("external references still skip unknown-reference check", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          elements: [
            {
              type: "display",
              reference: "self.entryUrl.params.neverDeclared",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });
});

describe("Rule 2 — stage-level always-skip-at-load (current-stage refs only)", () => {
  test("stage-level condition `doesNotExist` on current-stage ref → accepted", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "speed_round",
          duration: 60,
          conditions: [
            {
              reference: "shared.submitButton.speedSubmit",
              comparator: "doesNotExist",
            },
          ],
          elements: [{ type: "submitButton", name: "speedSubmit" }],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("stage-level condition `exists` on current-stage ref → rejected (always skip)", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "gated",
          duration: 60,
          conditions: [
            {
              reference: "shared.submitButton.s",
              comparator: "exists",
            },
          ],
          elements: [{ type: "submitButton", name: "s" }],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickAlwaysSkipIssue(
        issues,
        "treatments.0.gameStages.0.conditions.0.reference",
      ),
    ).toBeDefined();
  });

  test("stage-level condition `equals` on current-stage ref → rejected", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "gated",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.currentAnswer",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [
            {
              type: "prompt",
              name: "currentAnswer",
              file: "c.prompt.md",
            },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(
      pickAlwaysSkipIssue(
        issues,
        "treatments.0.gameStages.0.conditions.0.reference",
      ),
    ).toBeDefined();
  });

  test("element-level condition `equals` on current-stage ref → accepted (gating pattern)", () => {
    // Submit button appears only after the prompt is answered — the
    // exact pattern the always-skip rule must NOT reject at element level.
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "currentAnswer",
              file: "c.prompt.md",
            },
            {
              type: "submitButton",
              conditions: [
                {
                  reference: "self.prompt.currentAnswer",
                  comparator: "equals",
                  value: "yes",
                },
              ],
            },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("display.reference to current-stage data → accepted (shows when data arrives)", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "currentAnswer",
              file: "c.prompt.md",
            },
            { type: "display", reference: "self.prompt.currentAnswer" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });

  test("urlParams with current-stage reference → accepted", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s",
          duration: 60,
          elements: [
            {
              type: "prompt",
              name: "currentAnswer",
              file: "c.prompt.md",
            },
            {
              type: "trackedLink",
              name: "link",
              url: "https://example.org",
              displayText: "Go",
              urlParams: [{ key: "a", reference: "self.prompt.currentAnswer" }],
            },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    expect(issues.length).toBe(0);
  });
});

describe("Rule 2 with boolean-tree operators (#235)", () => {
  // Rule 2's per-leaf simulation is sound only when the leaf is reached
  // without traversing `any:` or `none:`. Inside those operators a
  // single non-true leaf doesn't doom the tree (a sibling can carry
  // it). The implementation gates Rule 2 on a path-traversal check.

  test("flat-array (implicit-all) leaf still triggers Rule 2 — backward compat", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.q",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [
            { type: "prompt", name: "q", file: "q.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find((i) =>
      /always skip the stage at load/i.test(i.message),
    );
    expect(hit).toBeDefined();
  });

  test("explicit `all:` operator leaf still triggers Rule 2 (`all` is equivalent to flat array)", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: {
            all: [
              {
                reference: "shared.prompt.q",
                comparator: "equals",
                value: "yes",
              },
            ],
          } as unknown as Record<string, unknown>[],
          elements: [
            { type: "prompt", name: "q", file: "q.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find((i) =>
      /always skip the stage at load/i.test(i.message),
    );
    expect(hit).toBeDefined();
  });

  test("leaf inside `any:` does NOT trigger Rule 2 (sibling can carry the operator)", () => {
    // `any: [{equals: yes}, {equals: yes}]` evaluates to undefined at
    // load (both children unknown), but a sibling becoming true would
    // flip the operator true. Rule 2's per-leaf simulation can't see
    // the sibling, so it conservatively skips this case rather than
    // false-positiving.
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: {
            any: [
              {
                reference: "shared.prompt.q",
                comparator: "equals",
                value: "yes",
              },
              {
                reference: "shared.prompt.r",
                comparator: "equals",
                value: "yes",
              },
            ],
          } as unknown as Record<string, unknown>[],
          elements: [
            { type: "prompt", name: "q", file: "q.prompt.md" },
            { type: "prompt", name: "r", file: "r.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find((i) =>
      /always skip the stage at load/i.test(i.message),
    );
    expect(hit).toBeUndefined();
  });

  test("leaf inside `none:` does NOT trigger Rule 2", () => {
    // Same reasoning: `none: [{equals: yes}]` is the canonical
    // "render-until-somebody-answers" pattern; the leaf isn't true at
    // load but the operator wraps the semantics.
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: {
            none: [
              {
                reference: "shared.prompt.q",
                comparator: "equals",
                value: "yes",
              },
            ],
          } as unknown as Record<string, unknown>[],
          elements: [
            { type: "prompt", name: "q", file: "q.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find((i) =>
      /always skip the stage at load/i.test(i.message),
    );
    expect(hit).toBeUndefined();
  });

  test("leaf inside nested `all > any` does NOT trigger Rule 2 (path traverses non-all operator)", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: {
            all: [
              {
                any: [
                  {
                    reference: "shared.prompt.q",
                    comparator: "equals",
                    value: "yes",
                  },
                ],
              },
            ],
          } as unknown as Record<string, unknown>[],
          elements: [
            { type: "prompt", name: "q", file: "q.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const issues = validateTreatmentFileReferences(file);
    const hit = issues.find((i) =>
      /always skip the stage at load/i.test(i.message),
    );
    expect(hit).toBeUndefined();
  });
});

describe("treatmentFileSchema surfaces walker issues via superRefine (red-squiggle path)", () => {
  test("forward reference produces a zod issue whose path targets the reference", () => {
    const file = baseFile({
      gameStages: [
        {
          name: "s1",
          duration: 60,
          conditions: [
            {
              reference: "shared.prompt.later",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements: [{ type: "submitButton" }],
        },
        {
          name: "s2",
          duration: 60,
          elements: [
            { type: "prompt", name: "later", file: "p.prompt.md" },
            { type: "submitButton" },
          ],
        },
      ],
    });
    const result = treatmentFileSchema.safeParse(file);
    expect(result.success).toBe(false);
    if (!result.success) {
      const hit = result.error.issues.find(
        (i) =>
          i.path.join(".") ===
            "treatments.0.gameStages.0.conditions.0.reference" &&
          /later/i.test(i.message),
      );
      expect(hit).toBeDefined();
    }
  });
});
