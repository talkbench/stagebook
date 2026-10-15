import { describe, expect, test } from "vitest";
import { discussionSchema, treatmentSchema } from "./treatment.js";

describe("discussion layout seat keys (#796)", () => {
  const layoutDefinition = {
    grid: { rows: 1, cols: 1 },
    feeds: [{ source: { type: "self" }, displayRegion: { rows: 0, cols: 0 } }],
  };
  const discussion = {
    chatType: "video",
    showNickname: true,
    showTitle: true,
  };
  const treatment = (layout?: Record<string, typeof layoutDefinition>) => ({
    name: "dyad",
    playerCount: 2,
    compatibleIntroSequences: [],
    gameStages: [
      {
        name: "conversation",
        duration: 60,
        elements: [{ type: "submitButton" }],
        discussion: { ...discussion, layout },
      },
    ],
  });

  test.each(["0", "1", "10", "100"])(
    "accepts canonical decimal key %j",
    (key) => {
      expect(
        discussionSchema.safeParse({
          ...discussion,
          layout: { [key]: layoutDefinition },
        }).success,
      ).toBe(true);
    },
  );

  test.each([
    "007",
    "00",
    " 1",
    "1 ",
    "",
    " ",
    "1e0",
    "0x1",
    "1.0",
    "+1",
    "-0",
    "-1",
    "1.5",
    "seat",
  ])("rejects non-canonical key %j at that layout entry", (key) => {
    const result = discussionSchema.safeParse({
      ...discussion,
      layout: { [key]: layoutDefinition },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ["layout", key],
          message:
            "Layout keys must be zero-based nonnegative integers in canonical decimal notation (0, 1, 2, ...).",
        }),
      );
    }
  });

  test.each(["2", "5"])(
    "rejects seat %s outside a two-player treatment",
    (key) => {
      const result = treatmentSchema.safeParse(
        treatment({ [key]: layoutDefinition }),
      );
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toContainEqual(
          expect.objectContaining({
            path: ["gameStages", 0, "discussion", "layout", key],
            message: `layout index ${key} in discussion of stage "conversation" exceeds playerCount of 2.`,
          }),
        );
      }
    },
  );

  test.each([
    undefined,
    {},
    { "1": layoutDefinition },
    { "0": layoutDefinition, "1": layoutDefinition },
  ])("accepts omitted, empty, partial, and complete layouts (%#)", (layout) => {
    expect(treatmentSchema.safeParse(treatment(layout)).success).toBe(true);
  });
});
