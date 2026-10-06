import { describe, expect, test } from "vitest";
import { readReference } from "../utils/readReference.js";
import { checkExpressionTypes } from "./expressionTypes.js";
import { promptFileSchema } from "./promptFile.js";

const prompts = new Map([
  [
    "text.prompt.md",
    promptFileSchema.parse(
      "---\ntype: openResponse\n---\nAnswer.\n---\n> Your answer",
    ),
  ],
]);
const file = (reference: string, value: unknown) => ({
  treatments: [
    {
      name: "t",
      gameStages: [
        {
          name: "s",
          elements: [
            { type: "prompt", name: "answer", file: "text.prompt.md" },
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

describe("static and runtime string path parity", () => {
  test.each([
    ["self.prompt.answer.value.length", 2],
    ["self.prompt.answer.value.0", "\ud83d"],
    ["self.prompt.answer.value.1.length", 1],
    ["self.entryUrl.params.code.length", 3],
    ["self.entryUrl.params.code.0", "a"],
    ["self.entryUrl.params.code.1.length", 1],
    ["self.attributes.stableParticipantId.length", 3],
    ["self.attributes.stableParticipantId.0", "i"],
  ] as const)("types the present runtime value at %s", (reference, value) => {
    const records: Record<string, unknown> = {
      prompt_answer: { value: "🙂" },
      entryUrl: { params: { code: "abc" } },
      attributes: { stableParticipantId: "id1" },
    };
    const get = (key: string) => [records[key]];
    expect(readReference(reference, get)).toBe(value);
    expect(checkExpressionTypes(file(reference, value), prompts)).toEqual([]);
    const wrongType = typeof value === "number" ? String(value) : 1;
    expect(
      checkExpressionTypes(file(reference, wrongType), prompts).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
  });

  test.each([
    "self.prompt.answer.value.01",
    "self.prompt.answer.value.length.0",
    "self.prompt.answer.value.toLowerCase",
    "self.entryUrl.params.code.01",
    "self.entryUrl.params.code.constructor",
    "self.attributes.stableParticipantId.length.extra",
  ])("rejects a path outside own string properties: %s", (reference) => {
    expect(
      checkExpressionTypes(file(reference, 1), prompts).some(
        (issue) => issue.severity === "error" && issue.message.includes("path"),
      ),
    ).toBe(true);
  });
});
