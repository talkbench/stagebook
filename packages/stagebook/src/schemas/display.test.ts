import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { elementSchema, getValidKeysForElementType } from "./treatment.js";
import {
  resolvedElementSchema,
  validateResolvedTreatmentFile,
} from "./resolved.js";
import { fillTemplates, substituteFields } from "../templates/fillTemplates.js";

describe.each([
  ["authoring", elementSchema],
  ["resolved", resolvedElementSchema],
] as const)("%s display source validation (#810)", (_name, schema) => {
  test.each(["mm-hmm", "", '*oh* <b>no</b>\n"really"', 42, 0])(
    "preserves text %j",
    (text) => {
      expect(schema.parse({ type: "display", text })).toEqual({
        type: "display",
        text,
      });
    },
  );

  test("still accepts reference-only displays", () => {
    expect(
      schema.safeParse({ type: "display", reference: "0.prompt.answer" })
        .success,
    ).toBe(true);
  });

  test.each([{}, { text: "" }, { text: 0 }, { text: "hello" }])(
    "requires exactly one source: %j",
    (fields) => {
      const result = schema.safeParse({
        type: "display",
        ...("text" in fields ? { reference: "0.prompt.answer" } : {}),
        ...fields,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find(
          (issue) => issue.code === "custom",
        );
        expect(issue?.path).toEqual(["text"]);
        expect(issue?.message).toContain("exactly one");
      }
    },
  );

  test.each([true, false, null, [], {}, Infinity, NaN])(
    "rejects unsupported text %j",
    (text) => {
      expect(schema.safeParse({ type: "display", text }).success).toBe(false);
    },
  );
});

test("display authoring keys include text", () => {
  expect(getValidKeysForElementType("display")).toContain("text");
});

describe("task-supplied display text", () => {
  test.each(["mm-hmm", "", '*oh* <b>no</b>\n"really"', 42, 0])(
    "substitutes and validates %j without losing its type",
    (transcript) => {
      const element: unknown = elementSchema.parse(
        parseYaml('type: display\ntext: "${transcript}"'),
      );
      const expected = { type: "display", text: transcript };
      expect(
        resolvedElementSchema.parse(
          substituteFields({ content: element, fields: { transcript } }),
        ),
      ).toEqual(expected);
      const filled = fillTemplates({
        templates: [],
        obj: element,
        additionalFields: { transcript },
      });
      expect(filled.unresolvedFields).toEqual([]);
      expect(resolvedElementSchema.parse(filled.result)).toEqual(expected);
    },
  );

  test.each([true, null, {}, []])(
    "rejects unsupported substituted text %j",
    (transcript) => {
      const filled = fillTemplates({
        templates: [],
        obj: { type: "display", text: "${transcript}" },
        additionalFields: { transcript },
      });
      expect(resolvedElementSchema.safeParse(filled.result).success).toBe(
        false,
      );
    },
  );

  test("distinguishes an unbound task field from an empty transcript", () => {
    const study = (text: string) => ({
      treatments: [
        {
          name: "annotation",
          playerCount: 1,
          compatibleIntroSequences: [],
          gameStages: [
            {
              name: "clip",
              duration: 60,
              elements: [{ type: "display", text }],
            },
          ],
        },
      ],
    });
    expect(validateResolvedTreatmentFile(study("")).success).toBe(true);
    const result = validateResolvedTreatmentFile(study("${transcript}"));
    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "unresolved-placeholder",
          path: ["treatments", 0, "gameStages", 0, "elements", 0, "text"],
        }),
      ]),
    );
  });
});
