import { expect, test, describe } from "vitest";
import type { z } from "zod";
import { promptMetadataSchema, promptFileSchema } from "./promptFile.js";

// `body: none` (#718): a prompt whose response options, or an `ariaLabel`,
// stand in for the question. The flag is what tells a deliberate omission
// apart from an unfinished question.

function issues(result: z.SafeParseReturnType<unknown, unknown>) {
  return result.success ? [] : result.error.issues;
}

function issueAt(
  result: z.SafeParseReturnType<unknown, unknown>,
  ...path: (string | number)[]
) {
  return issues(result).find(
    (issue) => JSON.stringify(issue.path) === JSON.stringify(path),
  );
}

describe("body: none metadata", () => {
  test("a bodyless checkbox prompt needs no ariaLabel", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      select: "multiple",
      layout: "horizontal",
      body: "none",
    });
    expect(result.success).toBe(true);
  });

  test("a bodyless checkbox prompt may still name its group", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      select: "multiple",
      body: "none",
      ariaLabel: "Materials",
    });
    expect(result.success).toBe(true);
  });

  test("a bodyless radio prompt needs an ariaLabel to name its group", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      body: "none",
    });
    expect(result.success).toBe(false);
    expect(issueAt(result, "ariaLabel")?.message).toContain("radio");
    expect(
      promptMetadataSchema.safeParse({
        type: "multipleChoice",
        body: "none",
        ariaLabel: "Materials shown",
      }).success,
    ).toBe(true);
  });

  test.each(["dropdown", "openResponse", "numericResponse"])(
    "a bodyless %s needs an ariaLabel",
    (type) => {
      const missing = promptMetadataSchema.safeParse({ type, body: "none" });
      expect(missing.success).toBe(false);
      const message = issueAt(missing, "ariaLabel")?.message ?? "";
      expect(message).toContain(`${type} prompts`);
      expect(message).toContain("ariaLabel");
      expect(
        promptMetadataSchema.safeParse({
          type,
          body: "none",
          ariaLabel: "Notes on this recording",
        }).success,
      ).toBe(true);
    },
  );

  test("ariaLabel without body: none is rejected", () => {
    const result = promptMetadataSchema.safeParse({
      type: "openResponse",
      ariaLabel: "Notes",
    });
    expect(result.success).toBe(false);
    expect(issueAt(result, "ariaLabel")?.message).toContain("body: none");
  });

  test("required: true is rejected with body: none", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      select: "multiple",
      body: "none",
      required: true,
    });
    expect(result.success).toBe(false);
    expect(issueAt(result, "required")?.message).toContain("body: none");
    expect(
      promptMetadataSchema.safeParse({
        type: "multipleChoice",
        select: "multiple",
        body: "none",
        required: false,
      }).success,
    ).toBe(true);
  });

  test.each(["hidden", "", true, null])(
    "body only accepts none (got %j)",
    (body) => {
      const result = promptMetadataSchema.safeParse({
        type: "multipleChoice",
        select: "multiple",
        body,
      });
      expect(result.success).toBe(false);
      expect(issueAt(result, "body")?.message).toBe(
        "`body` accepts only `none`",
      );
    },
  );

  test("ariaLabel must be a non-blank single line within 100 characters", () => {
    const parse = (ariaLabel: string) =>
      promptMetadataSchema.safeParse({
        type: "openResponse",
        body: "none",
        ariaLabel,
      }).success;
    expect(parse("x".repeat(100))).toBe(true);
    expect(parse("x".repeat(101))).toBe(false);
    expect(parse("")).toBe(false);
    expect(parse("   ")).toBe(false);
    // Invisible characters that `trim()` keeps would leave the control
    // effectively unnamed.
    expect(parse("\u200B")).toBe(false);
    expect(parse("\u0085")).toBe(false);
    expect(parse("Age 18+")).toBe(true);
    expect(parse("Notes\non this recording")).toBe(false);
    expect(parse("Notes\ron this recording")).toBe(false);
    expect(parse("Notes\u2028on this recording")).toBe(false);
  });

  test.each([
    ["slider", { min: 0, max: 10, interval: 1 }, "#689"],
    ["listSorter", {}, "listSorter"],
    ["noResponse", {}, "noResponse"],
  ])("%s explains why it rejects body and ariaLabel", (type, extra, hint) => {
    for (const key of ["body", "ariaLabel"]) {
      const result = promptMetadataSchema.safeParse({
        type,
        ...extra,
        [key]: key === "body" ? "none" : "Label",
      });
      expect(result.success).toBe(false);
      const message = issues(result)[0]?.message ?? "";
      // The reason names the key it's about, beyond the default message.
      expect(message).toContain("`" + key);
      expect(message).toContain(hint);
    }
  });

  test("the explanation doesn't hide other unknown keys", () => {
    const result = promptMetadataSchema.safeParse({
      type: "slider",
      min: 0,
      max: 10,
      interval: 1,
      tytle: "x",
      body: "none",
    });
    const message = issues(result)[0]?.message ?? "";
    expect(message).toContain("tytle");
    expect(message).toContain("#689");
  });

  test("an unknown key named like an Object.prototype member keeps the default error", () => {
    const result = promptMetadataSchema.safeParse({
      type: "noResponse",
      toString: "x",
    });
    expect(result.success).toBe(false);
    expect(typeof issues(result)[0]?.message).toBe("string");
    expect(issues(result)[0]?.message).toContain("toString");
  });
});

describe("body: none files", () => {
  test("a horizontal row of bodyless checkboxes parses with an empty body", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
layout: horizontal
body: none
notes: No question text; the option labels are the prompt.
---

---

- Show briefing materials
- Show strategy notes`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("");
      expect(result.data.responseItems).toEqual([
        "Show briefing materials",
        "Show strategy notes",
      ]);
      expect(result.data.metadata).toMatchObject({
        body: "none",
        layout: "horizontal",
      });
    }
  });

  test("a single bodyless checkbox parses", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
body: none
---
---
- This recording has technical errors that prevent analysis`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual([
        "This recording has technical errors that prevent analysis",
      ]);
    }
  });

  test("a bodyless openResponse keeps its placeholder section", () => {
    const result = promptFileSchema.safeParse(`---
type: openResponse
body: none
ariaLabel: Notes on this recording
---

---

> Anything else we should know?`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("");
      expect(result.data.responseItems).toEqual([
        "Anything else we should know?",
      ]);
    }
  });

  test("a bodyless numericResponse is frontmatter alone", () => {
    const result = promptFileSchema.safeParse(`---
type: numericResponse
body: none
ariaLabel: Age in years
suffix: years
---
`);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.body).toBe("");
  });

  test("body: none with text in the body section is rejected", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
body: none
---
Which materials do you want?
---
- Briefing`);
    expect(result.success).toBe(false);
    const message = issueAt(result, "body")?.message ?? "";
    expect(message).toContain("body: none");
    expect(message).toContain("notes:");
  });

  test("the Markdown-comment workaround counts as body text", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
body: none
---

[//]: # (No body text: the option labels are the prompt.)

---
- Briefing`);
    expect(result.success).toBe(false);
    expect(issueAt(result, "body")).toBeDefined();
  });

  test("dropping the empty body section points at the missing delimiter", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
body: none
---
- Briefing
- Strategy`);
    expect(result.success).toBe(false);
    const message = issueAt(result, "body")?.message ?? "";
    expect(message).toContain("empty body section");
    expect(message).toContain("---");
  });

  test("an empty body without the flag is an error that names the flag", () => {
    // The issue's original file (#718).
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
---

---
- This recording has technical errors that prevent analysis`);
    expect(result.success).toBe(false);
    const message = issueAt(result, "body")?.message ?? "";
    expect(message).toMatch(/^Prompt body section is empty/);
    expect(message).toContain("body: none");
  });

  // Files with an empty body section, one per type.
  const emptyBody = {
    multipleChoice: "---\ntype: multipleChoice\n---\n\n---\n- A",
    dropdown: "---\ntype: dropdown\n---\n\n---\n- A",
    openResponse: "---\ntype: openResponse\n---\n\n---\n> Hint",
    numericResponse: "---\ntype: numericResponse\n---\n",
    slider:
      "---\ntype: slider\nmin: 0\nmax: 10\ninterval: 1\n---\n\n---\n- 0: a\n- 10: b",
    listSorter: "---\ntype: listSorter\n---\n\n---\n- A\n- B",
    noResponse: "---\ntype: noResponse\n---\n",
  };

  test.each([
    "multipleChoice",
    "dropdown",
    "openResponse",
    "numericResponse",
  ] as const)("an empty %s body suggests body: none", (type) => {
    const message =
      issueAt(promptFileSchema.safeParse(emptyBody[type]), "body")?.message ??
      "";
    expect(message).toMatch(/^Prompt body section is empty/);
    expect(message).toContain("body: none");
  });

  test.each(["slider", "listSorter", "noResponse"] as const)(
    "an empty %s body does not suggest body: none",
    (type) => {
      const message =
        issueAt(promptFileSchema.safeParse(emptyBody[type]), "body")?.message ??
        "";
      expect(message).toMatch(/^Prompt body section is empty/);
      expect(message).not.toContain("body: none");
    },
  );

  test("a bodyless numericResponse with body text says to remove it", () => {
    const result = promptFileSchema.safeParse(`---
type: numericResponse
body: none
ariaLabel: Age in years
---
How old are you?`);
    expect(result.success).toBe(false);
    const message = issueAt(result, "body")?.message ?? "";
    expect(message).toContain("notes:");
    expect(message).not.toContain("empty body section");
  });

  test("CRLF line endings and a whitespace-only body section parse", () => {
    const result = promptFileSchema.safeParse(
      "---\r\ntype: multipleChoice\r\nselect: multiple\r\nbody: none\r\n---\r\n \t \r\n---\r\n- Briefing\r\n- Strategy\r\n",
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("");
      expect(result.data.responseItems).toEqual(["Briefing", "Strategy"]);
    }
  });

  test("an ordinary prompt is unchanged", () => {
    const result = promptFileSchema.safeParse(`---
type: multipleChoice
select: multiple
---
Select all colors you like:
---
- Red
- Blue`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("Select all colors you like:");
      expect("body" in result.data.metadata).toBe(false);
      expect("ariaLabel" in result.data.metadata).toBe(false);
    }
  });
});
