import { describe, expect, test } from "vitest";
import { promptFileSchema, promptMetadataSchema } from "./promptFile.js";

describe("numericResponse metadata and sections (#687)", () => {
  test.each([
    {},
    { required: true, min: 18, max: 99, integer: true, suffix: "years" },
    { min: -0.5, prefix: "$", name: "estimate", notes: "note", locale: "he" },
    { max: 0, required: false, integer: false },
    { min: 7, max: 7 },
    { min: 1e-98 },
    { prefix: "x".repeat(32), suffix: "y".repeat(32) },
  ])("accepts %j", (fields) => {
    expect(
      promptMetadataSchema.parse({ type: "numericResponse", ...fields }),
    ).toEqual({ type: "numericResponse", ...fields });
  });

  test.each([
    "rows",
    "minLength",
    "maxLength",
    "interval",
    "placeholder",
    "shuffle",
    "select",
    "showValue",
  ])("rejects unrelated %s", (key) => {
    const parsed = promptMetadataSchema.safeParse({
      type: "numericResponse",
      [key]: 1,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues[0].code).toBe("unrecognized_keys");
  });

  test.each([
    [{ min: 3, max: 2 }, "min"],
    [{ integer: true, min: 0.5 }, "min"],
    [{ integer: true, max: -0.5 }, "max"],
    [{ min: Infinity }, "min"],
    [{ max: -Infinity }, "max"],
    [{ min: NaN }, "min"],
    [{ prefix: "x".repeat(33) }, "prefix"],
    [{ suffix: "a\nb" }, "suffix"],
    [{ prefix: "a\rb" }, "prefix"],
    [{ suffix: "a\u2028b" }, "suffix"],
    [{ prefix: "a\u2029b" }, "prefix"],
  ] as const)("rejects invalid %j at %s", (fields, path) => {
    const parsed = promptMetadataSchema.safeParse({
      type: "numericResponse",
      ...fields,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.some((issue) => issue.path[0] === path)).toBe(
        true,
      );
  });

  test("parses exactly frontmatter and body without response items", () => {
    expect(
      promptFileSchema.parse(
        "---\ntype: numericResponse\nrequired: true\nmin: 18\n---\nHow old are you?\n",
      ),
    ).toEqual({
      metadata: { type: "numericResponse", required: true, min: 18 },
      body: "How old are you?",
      responseItems: [],
      responsePoints: [],
      sliderPoints: [],
    });
  });

  test.each(["---\n", "---\n> placeholder\n", "---\n- 5\n"])(
    "rejects a third section %j",
    (extra) => {
      const parsed = promptFileSchema.safeParse(
        `---\ntype: numericResponse\n---\nQuestion\n${extra}`,
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: ["responses"],
              message:
                "numericResponse prompt must have exactly two sections (frontmatter + body). Drop the trailing `---` and any third section.",
            }),
          ]),
        );
    },
  );

  test.each([".inf", "-.inf", ".nan"])(
    "rejects non-finite YAML bound %s",
    (bound) => {
      const parsed = promptFileSchema.safeParse(
        `---\ntype: numericResponse\nmin: ${bound}\n---\nQuestion\n`,
      );
      expect(parsed.success).toBe(false);
      if (!parsed.success)
        expect(parsed.error.issues[0].path).toEqual(["metadata", "min"]);
    },
  );
});
