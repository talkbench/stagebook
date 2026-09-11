import { describe, it, expect } from "vitest";
import { validatePromptSource } from "./validatePrompt.js";

describe("validatePromptSource", () => {
  describe("valid prompt files", () => {
    it("returns no diagnostics for a valid multipleChoice prompt", () => {
      const src = `---
name: test_prompt
type: multipleChoice
---
What is your favorite color?
---
- Red
- Blue
- Green`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });

    it("returns no diagnostics for a valid noResponse prompt (#243 — two-section file)", () => {
      const src = `---
name: test_info
type: noResponse
---
Please read the following instructions carefully.
`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });

    it("returns no diagnostics for a valid openResponse prompt", () => {
      const src = `---
name: test_open
type: openResponse
---
Please describe your experience.
---
> Your response here`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("structural errors", () => {
    it("reports error for missing --- delimiters", () => {
      const src = `Just some text without delimiters`;
      const result = validatePromptSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
      expect(result.diagnostics[0].message).toMatch(/section|delimiter/i);
    });

    it("reports error for only two delimiters on a multipleChoice prompt (third section required)", () => {
      const src = `---
name: test
type: multipleChoice
---
Body text but no third section`;
      const result = validatePromptSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].message).toMatch(
        /section|delimiter|response/i,
      );
    });

    it("reports error for empty file", () => {
      const result = validatePromptSource("");
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("metadata errors", () => {
    it("reports error for missing type field", () => {
      const src = `---
name: test_prompt
---
Body text`;
      const result = validatePromptSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("reports error for invalid type value", () => {
      const src = `---
name: test_prompt
type: invalidType
---
Body text`;
      const result = validatePromptSource(src);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(result.diagnostics[0].severity).toBe("error");
    });

    it("reports error for rows on non-openResponse type (strict-keys per #243)", () => {
      const src = `---
name: test_prompt
type: multipleChoice
rows: 3
---
Pick one
---
- A
- B`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("rows"),
        }),
      );
    });
  });

  describe("response errors", () => {
    it("reports error for invalid response line format", () => {
      const src = `---
name: test_prompt
type: multipleChoice
---
Pick one
---
Red
Blue`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringMatching(/response line|must start with/i),
        }),
      );
    });
  });

  describe("error position mapping", () => {
    it("maps metadata errors to the metadata section", () => {
      const src = `---
name: test_prompt
type: invalidType
---
Body text`;
      const result = validatePromptSource(src);
      const metadataErrors = result.diagnostics.filter(
        (d) =>
          d.range !== null && d.range.startLine >= 1 && d.range.startLine <= 3,
      );
      expect(metadataErrors.length).toBeGreaterThan(0);
    });

    it("maps response errors to the response section", () => {
      const src = `---
name: test_prompt
type: multipleChoice
---
Pick one
---
bad line`;
      const result = validatePromptSource(src);
      const responseErrors = result.diagnostics.filter(
        (d) => d.range !== null && d.range.startLine >= 6,
      );
      expect(responseErrors.length).toBeGreaterThan(0);
    });
  });

  describe("extra delimiter warning", () => {
    it("warns when more than 3 --- delimiters appear in a 3-section prompt", () => {
      // Stray `---` inside the body of a 3-section type is the classic
      // "tried to use --- as a horizontal rule" footgun. After #243 the
      // schema also rejects it (3-section types expect exactly one
      // section delimiter between body and responses), but the explicit
      // warning steers authors to *** / ___ instead.
      const src = `---
name: test_prompt
type: multipleChoice
---
Pick one
---
then a horizontal rule
---
- A
- B`;
      const result = validatePromptSource(src);
      const warnings = result.diagnostics.filter(
        (d) => d.severity === "warning",
      );
      expect(warnings.length).toBeGreaterThanOrEqual(1);
      expect(warnings[0].message).toMatch(/horizontal rule|\*\*\*|___/i);
    });
  });

  describe("slider type", () => {
    it("returns no diagnostics for a valid slider prompt (#243 — labels in body, `- <n>: <label>`)", () => {
      const src = `---
name: test_slider
type: slider
min: 0
max: 100
interval: 10
---
Rate your agreement.
---
- 0: Low
- 100: High`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports errors when slider is missing required fields (#243 — strict required)", () => {
      const src = `---
name: test_slider
type: slider
---
Rate something.
---
- 0: Low`;
      const result = validatePromptSource(src);
      const messages = result.diagnostics.map((d) => d.message);
      // After #243 the discriminated-union branch declares min/max/interval
      // as required (not optional), so missing them triggers Zod's
      // "Required" message rather than a custom per-field message.
      expect(messages.filter((m) => m === "Required").length).toBe(3);
    });
  });

  describe("listSorter type", () => {
    it("returns no diagnostics for a valid listSorter prompt (#243 — `-` marker required)", () => {
      const src = `---
name: test_sort
type: listSorter
---
Rank these items.
---
- Item A
- Item B
- Item C`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("metadata YAML parse failure", () => {
    it("reports error for malformed YAML in metadata", () => {
      const src = `---
name: test_prompt
type: [unclosed bracket
---
Body text`;
      const result = validatePromptSource(src);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining("parse metadata YAML"),
          severity: "error",
        }),
      );
    });
  });

  describe("CRLF line endings", () => {
    it("handles CRLF line endings correctly", () => {
      const src =
        "---\r\nname: test_prompt\r\ntype: multipleChoice\r\n---\r\nPick one\r\n---\r\n- A\r\n- B";
      const result = validatePromptSource(src);
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe("metadata field position mapping", () => {
    it.each(["\n", "\r\n", "\r"])(
      "maps metadata field errors with %j line endings",
      (eol) => {
        const src = `---
name: test_prompt
type: multipleChoice
rows: 3
---
Pick one
---
- A
- B`.replaceAll("\n", eol);
        const result = validatePromptSource(src);
        const rowsError = result.diagnostics.find((d) =>
          d.message.includes("rows"),
        );
        expect(rowsError).toBeDefined();
        // "rows:" is on line 3 (0-indexed)
        expect(rowsError!.range!.startLine).toBe(3);
      },
    );
  });
});

describe("openResponse placeholder overflow warning (#590)", () => {
  function prompt(
    lines: string[],
    rows?: number,
    body = "Describe your experience.",
  ) {
    return [
      "---",
      "type: openResponse",
      ...(rows === undefined ? [] : [`rows: ${String(rows)}`]),
      "---",
      body,
      "---",
      "",
      ...lines.map((line) => `> ${line}`),
    ].join("\n");
  }

  it("warns on a long hint and locates the placeholder, while keeping the file valid", () => {
    const hint =
      "Describe what happened, how you felt, and what you would do differently next time. ".repeat(
        3,
      );
    const source = prompt([hint], 2);
    const diagnostics = validatePromptSource(source).diagnostics;
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringMatching(/Placeholder may overflow rows: 2/),
        range: {
          startLine: 7,
          startCol: 0,
          endLine: 7,
          endCol: hint.length + 2,
        },
      }),
    ]);
    expect(diagnostics[0].message).toMatch(/approximate/i);
    expect(diagnostics[0].message).toContain("prompt body");
    expect(diagnostics[0].message).toContain("width");
  });

  it("counts explicit line breaks, including a blank placeholder line", () => {
    expect(
      validatePromptSource(prompt(["First hint", "", "Second hint"], 2))
        .diagnostics,
    ).toEqual([expect.objectContaining({ severity: "warning" })]);
  });

  it("uses the runtime default of five rows when rows is omitted", () => {
    expect(
      validatePromptSource(
        prompt(Array.from({ length: 5 }, () => "A short hint")),
      ).diagnostics,
    ).toEqual([]);
    expect(
      validatePromptSource(
        prompt(Array.from({ length: 6 }, () => "A short hint")),
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({ message: expect.stringContaining("rows: 5") }),
    ]);
  });

  it("stops warning when the author gives the same hint more room", () => {
    const lines = ["A short hint", "Another short hint", "One more hint"];
    expect(validatePromptSource(prompt(lines, 2)).diagnostics).toHaveLength(1);
    expect(validatePromptSource(prompt(lines, 3)).diagnostics).toEqual([]);
  });

  it("allows short, empty, and omitted placeholder content", () => {
    for (const lines of [["Type here"], [""], []]) {
      expect(validatePromptSource(prompt(lines, 1)).diagnostics).toEqual([]);
    }
  });

  it("counts Unicode code points rather than UTF-16 code units in the rough estimate", () => {
    expect(
      validatePromptSource(prompt(["😀".repeat(50)], 1)).diagnostics,
    ).toEqual([]);
  });

  it("does not add a speculative warning to an invalid prompt", () => {
    const diagnostics = validatePromptSource(
      prompt(["A long hint. ".repeat(40)], 0),
    ).diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === "error")).toBe(true);
  });

  it("does not treat long choice labels as placeholders", () => {
    const source = `---\ntype: multipleChoice\n---\nChoose one.\n---\n- ${"A long option. ".repeat(40)}`;
    expect(validatePromptSource(source).diagnostics).toEqual([]);
  });

  it("locates the hint after a body code fence", () => {
    const source = prompt(
      ["A long hint. ".repeat(40)],
      1,
      "Example:\n```markdown\n---\n> example only\n```\nNow answer.",
    );
    const diagnostics = validatePromptSource(source).diagnostics;
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        range: expect.objectContaining({ startLine: 12 }),
      }),
    ]);
  });
});

it.each(["\n", "\r\n", "\r"])(
  "locates a placeholder warning with %j line endings (#590)",
  (eol) => {
    const source = [
      "---",
      "type: openResponse",
      "rows: 1",
      "---",
      "Answer.",
      "---",
      "> First",
      "> Second",
    ].join(eol);
    expect(validatePromptSource(source).diagnostics).toEqual([
      expect.objectContaining({
        severity: "warning",
        range: { startLine: 6, startCol: 0, endLine: 6, endCol: 7 },
      }),
    ]);
  },
);
