import { describe, expect, test } from "vitest";
import {
  baseTreatmentSchema,
  consentArmSchema,
  discussionSchema,
  introExitStepSchema,
  introSequenceSchema,
  promptSchema,
  stageSchema,
  templateContextSchema,
  templateSchema,
} from "./treatment.js";
import { promptFileSchema, promptMetadataSchema } from "./promptFile.js";

// These outputs were checked against the Zod 3 schemas before the Zod 4
// migration. Keep missing fields, explicit undefined values, and defaults
// distinct: all three are observable by schema consumers.
describe("schema output compatibility", () => {
  test("optional element fields preserve omission and explicit undefined", () => {
    const input = { type: "prompt", file: "question.prompt.md" };
    expect(promptSchema.parse(input)).toStrictEqual(input);
    expect(promptSchema.parse({ ...input, notes: undefined })).toStrictEqual({
      ...input,
      notes: undefined,
    });
  });

  test("discussion defaults are materialized while explicit false is preserved", () => {
    const input = {
      chatType: "text",
      showNickname: false,
      showTitle: false,
      showSelfView: false,
    };
    expect(discussionSchema.parse(input)).toStrictEqual({
      ...input,
      showReportMissing: true,
      showAudioMute: true,
      showVideoMute: true,
    });
  });

  test.each([
    { type: "multipleChoice" },
    { type: "multipleChoice", select: undefined, layout: undefined },
  ])("multiple-choice defaults retain their parsed output: %j", (input) => {
    expect(promptMetadataSchema.parse(input)).toStrictEqual({
      type: "multipleChoice",
      select: "single",
      layout: "vertical",
    });
  });

  test("opaque template fields preserve explicit undefined values", () => {
    const input = { template: "question", fields: { value: undefined } };
    expect(templateContextSchema.parse(input)).toStrictEqual(input);
  });

  test.each([false, true])(
    "deferred template content preserves its authored presence: %s",
    (explicit) => {
      const input = {
        name: "question",
        contentType: "element",
        ...(explicit ? { content: undefined } : {}),
      };
      expect(templateSchema.parse(input)).toStrictEqual(input);
    },
  );

  test.each([
    [
      "treatment stages",
      baseTreatmentSchema,
      { name: "arm", playerCount: 1, compatibleIntroSequences: [] },
    ],
    ["step elements", introExitStepSchema, { name: "step" }],
    ["sequence steps", introSequenceSchema, { name: "sequence" }],
    ["consent steps", consentArmSchema, { name: "consent" }],
  ])(
    "deferred %s retain their legacy omitted-field behavior",
    (_, schema, input) => {
      expect(schema.parse(input)).toStrictEqual(input);
    },
  );

  test("missing stage elements retain the authored-field guidance", () => {
    const result = stageSchema.safeParse({ name: "round", duration: 10 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "custom",
        message: "Stage must have elements field (check elementsSchema).",
      }),
    );
  });

  test("prompt-file parsing retains empty response arrays and absent metadata", () => {
    expect(
      promptFileSchema.parse("---\ntype: noResponse\n---\nRead this text."),
    ).toStrictEqual({
      metadata: { type: "noResponse" },
      body: "Read this text.",
      responseItems: [],
      responsePoints: [],
      sliderPoints: [],
    });
  });

  test("strict authoring objects continue to reject unknown keys", () => {
    const results = [
      promptSchema.safeParse({
        type: "prompt",
        file: "question.prompt.md",
        unexpected: true,
      }),
      promptMetadataSchema.safeParse({ type: "noResponse", rows: 3 }),
      templateContextSchema.safeParse({ template: "question", unexpected: 1 }),
    ];
    for (const result of results) {
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "unrecognized_keys", path: [] }),
        ]),
      );
    }
  });
});
