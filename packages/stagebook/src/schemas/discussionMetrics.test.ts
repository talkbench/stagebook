import { describe, expect, test } from "vitest";
import { z } from "zod";
import { discussionSchema, getValidKeysForDiscussion } from "./treatment.js";
import { checkExpressionTypes } from "./expressionTypes.js";
import { validateResolvedTreatmentFile } from "./resolved.js";
import { readReference } from "../utils/readReference.js";
import { evaluateConditions } from "../utils/evaluateConditions.js";
import {
  checkHostRecord,
  createHostRecordSchemas,
  discussionMetricsSchema,
} from "./hostRecords.js";

const discussion = {
  name: "chat",
  chatType: "video",
  showNickname: false,
  showTitle: false,
};
const file = (reference: string, value: unknown) => ({
  treatments: [
    {
      name: "study",
      playerCount: 2,
      compatibleIntroSequences: [],
      gameStages: [
        {
          name: "talk",
          duration: 60,
          discussion,
          elements: [
            {
              type: "submitButton",
              conditions: { reference, comparator: "equals", value },
            },
          ],
        },
      ],
    },
  ],
});

describe("declared discussion metrics", () => {
  test("names a discussion without requiring names on existing discussions", () => {
    expect(discussionSchema.safeParse(discussion).success).toBe(true);
    expect(
      discussionSchema.safeParse({ ...discussion, name: undefined }).success,
    ).toBe(true);
    expect(getValidKeysForDiscussion()).toContain("name");
  });

  test("records observations without inventing values for unmeasured metrics", () => {
    expect(discussionMetricsSchema.parse({})).toEqual({});
    expect(
      checkHostRecord("discussion", { discussionFailed: true }).success,
    ).toBe(true);
    for (const value of [
      { discussionFailed: "true" },
      { cumulativeSpeakingTime: -1 },
      { cumulativeSpeakingTime: Infinity },
      { nope: 1 },
    ]) {
      expect(checkHostRecord("discussion", value).success).toBe(false);
    }
  });

  test("checks known types and lists declared fields for an unknown metric", () => {
    expect(
      checkExpressionTypes(
        file("self.discussion.chat.discussionFailed", true),
        new Map(),
      ),
    ).toEqual([]);
    expect(
      checkExpressionTypes(
        file("self.discussion.chat.discussionFailed", "yes"),
        new Map(),
      ).some((issue) => issue.severity === "error"),
    ).toBe(true);
    const issues = checkExpressionTypes(
      file("self.discussion.chat.nope", true),
      new Map(),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("discussionFailed");
    expect(issues[0].message).toContain("cumulativeSpeakingTime");
  });

  test("a saved named record resolves through the common reference boundary", () => {
    const stored = { discussionFailed: true };
    const conditions = file("self.discussion.chat.discussionFailed", true)
      .treatments[0].gameStages[0].elements[0].conditions;
    expect(
      evaluateConditions(conditions, {
        readReference: (reference) =>
          readReference(reference, (key, scope) =>
            key === "discussion_chat" && scope === "player" ? [stored] : [],
          ),
      }),
    ).toBe(true);
  });
});

describe("host field declarations", () => {
  test("declared record arrays share length semantics without enabling membership", () => {
    const hostSchemas = createHostRecordSchemas({
      discussion: {
        turns: z.array(z.object({ speaker: z.string() })).optional(),
      },
    });
    const study = file("self.discussion.chat.turns", 1);
    const gate = study.treatments[0].gameStages[0].elements[0].conditions;
    gate.comparator = "hasLengthAtLeast";
    expect(checkExpressionTypes(study, new Map(), { hostSchemas })).toEqual([]);
    expect(
      evaluateConditions(gate, { readReference: () => [{ speaker: "A" }] }),
    ).toBe(true);
    gate.comparator = "includes";
    expect(
      checkExpressionTypes(study, new Map(), { hostSchemas }).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
  });
  test("declares additional metrics and attributes without global registration", () => {
    const hostSchemas = createHostRecordSchemas({
      discussion: { turnCount: z.number().int().nonnegative().optional() },
      attributes: { cohort: z.string().optional() },
    });
    const study = file("self.discussion.chat.turnCount", 3);
    expect(checkExpressionTypes(study, new Map(), { hostSchemas })).toEqual([]);
    expect(validateResolvedTreatmentFile(study, { hostSchemas }).success).toBe(
      true,
    );
    expect(
      checkHostRecord("discussion", { turnCount: 3 }, { hostSchemas }).success,
    ).toBe(true);
    expect(
      checkExpressionTypes(
        file("self.discussion.chat.turnCount", "3"),
        new Map(),
        { hostSchemas },
      ).some((issue) => issue.severity === "error"),
    ).toBe(true);
    expect(
      checkExpressionTypes(file("self.attributes.cohort", "pilot"), new Map(), {
        hostSchemas,
      }),
    ).toEqual([]);
    expect(
      checkExpressionTypes(study, new Map()).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
    expect(
      checkExpressionTypes(file("self.attributes.cohort", "pilot"), new Map()),
    ).toEqual([
      expect.objectContaining({
        severity: "warning",
        reason: "unknownHostField",
      }),
    ]);
  });

  test("cannot replace built-in fields or introduce prototype paths", () => {
    expect(() =>
      createHostRecordSchemas({ discussion: { discussionFailed: z.string() } }),
    ).toThrow(/discussionFailed/);
    expect(() =>
      createHostRecordSchemas({
        attributes: { stableParticipantId: z.number() },
      }),
    ).toThrow(/stableParticipantId/);
    expect(() =>
      createHostRecordSchemas({ discussion: { constructor: z.string() } }),
    ).toThrow(/constructor/);
  });
});
