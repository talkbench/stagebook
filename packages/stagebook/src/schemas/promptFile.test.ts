import { expect, test, describe } from "vitest";
import {
  promptMetadataSchema,
  metadataTypeSchema,
  metadataRefineSchema,
  metadataLogicalSchema,
  validateSliderLabels,
  promptFileSchema,
  splitOnTopLevelHrules,
} from "./promptFile.js";

// Back-compat aliases all point at `promptMetadataSchema` after #243; the
// pre-#243 dual-schema workaround is gone. We exercise the canonical name
// here, but keep one cross-check that the aliases still resolve to the
// same schema.
test("metadata back-compat aliases resolve to promptMetadataSchema", () => {
  expect(metadataTypeSchema).toBe(promptMetadataSchema);
  expect(metadataRefineSchema).toBe(promptMetadataSchema);
  expect(metadataLogicalSchema).toBe(promptMetadataSchema);
});

// ----------- Frontmatter — discriminated union per type ------------

describe("promptMetadataSchema", () => {
  test("openResponse with rows is valid", () => {
    const result = promptMetadataSchema.safeParse({
      name: "Welcome",
      type: "openResponse",
      rows: 3,
    });
    expect(result.success).toBe(true);
  });

  test("noResponse with just name + type is valid", () => {
    const result = promptMetadataSchema.safeParse({
      name: "Welcome",
      type: "noResponse",
    });
    expect(result.success).toBe(true);
  });

  test("name field is optional", () => {
    const result = promptMetadataSchema.safeParse({ type: "openResponse" });
    expect(result.success).toBe(true);
  });

  test("missing type is rejected", () => {
    const result = promptMetadataSchema.safeParse({ name: "x" });
    expect(result.success).toBe(false);
  });

  test("invalid type value is rejected", () => {
    const result = promptMetadataSchema.safeParse({
      name: "x",
      type: "invalidType",
    });
    expect(result.success).toBe(false);
  });

  test("rows on multipleChoice is rejected (strict-keys)", () => {
    // After #243 each per-type schema is `.strict()`; a field that lives on
    // another branch (here `rows`, only on openResponse) fails strict-key
    // validation rather than running through a separate cross-field rule.
    const result = promptMetadataSchema.safeParse({
      name: "x",
      type: "multipleChoice",
      rows: 3,
    });
    expect(result.success).toBe(false);
  });

  test("select on openResponse is rejected (strict-keys)", () => {
    const result = promptMetadataSchema.safeParse({
      name: "x",
      type: "openResponse",
      select: "single",
    });
    expect(result.success).toBe(false);
  });

  test("shuffleOptions (legacy spelling) is rejected — use `shuffle` (#243)", () => {
    const result = promptMetadataSchema.safeParse({
      name: "x",
      type: "multipleChoice",
      shuffleOptions: true,
    });
    expect(result.success).toBe(false);
  });

  test("shuffle (renamed from shuffleOptions in #243) is accepted", () => {
    const result = promptMetadataSchema.safeParse({
      name: "x",
      type: "multipleChoice",
      shuffle: true,
    });
    expect(result.success).toBe(true);
  });

  test("listSorter accepts `shuffle`", () => {
    const result = promptMetadataSchema.safeParse({
      type: "listSorter",
      shuffle: true,
    });
    expect(result.success).toBe(true);
  });

  test("select: 'undefined' (legacy enum value) is rejected — omit field for default", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      select: "undefined",
    });
    expect(result.success).toBe(false);
  });

  test("multipleChoice without select defaults to 'single'", () => {
    const result = promptMetadataSchema.safeParse({ type: "multipleChoice" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "multipleChoice") {
      expect(result.data.select).toBe("single");
      expect(result.data.layout).toBe("vertical");
    }
  });

  test("openResponse: minLength > maxLength is rejected", () => {
    const result = promptMetadataSchema.safeParse({
      type: "openResponse",
      minLength: 100,
      maxLength: 50,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("minLength cannot be greater than maxLength"),
        ),
      ).toBe(true);
    }
  });

  test("slider: min/max/interval all required (strict)", () => {
    expect(
      promptMetadataSchema.safeParse({ type: "slider", max: 100, interval: 1 })
        .success,
    ).toBe(false);
    expect(
      promptMetadataSchema.safeParse({ type: "slider", min: 0, interval: 1 })
        .success,
    ).toBe(false);
    expect(
      promptMetadataSchema.safeParse({ type: "slider", min: 0, max: 100 })
        .success,
    ).toBe(false);
    expect(
      promptMetadataSchema.safeParse({
        type: "slider",
        min: 0,
        max: 100,
        interval: 1,
      }).success,
    ).toBe(true);
  });

  test("slider: min >= max rejected", () => {
    const result = promptMetadataSchema.safeParse({
      type: "slider",
      min: 100,
      max: 100,
      interval: 1,
    });
    expect(result.success).toBe(false);
  });

  test("slider: min + interval > max rejected", () => {
    const result = promptMetadataSchema.safeParse({
      type: "slider",
      min: 0,
      max: 10,
      interval: 20,
    });
    expect(result.success).toBe(false);
  });

  test("slider: legacy labelPts frontmatter key is rejected (#243 — labels are body lines now)", () => {
    const result = promptMetadataSchema.safeParse({
      type: "slider",
      min: 0,
      max: 100,
      interval: 1,
      labelPts: [0, 50, 100],
    });
    expect(result.success).toBe(false);
  });

  test("multipleChoice with layout: horizontal/vertical accepted", () => {
    expect(
      promptMetadataSchema.safeParse({
        type: "multipleChoice",
        layout: "horizontal",
      }).success,
    ).toBe(true);
    expect(
      promptMetadataSchema.safeParse({
        type: "multipleChoice",
        layout: "vertical",
      }).success,
    ).toBe(true);
  });

  test("layout outside vertical|horizontal rejected", () => {
    const result = promptMetadataSchema.safeParse({
      type: "multipleChoice",
      layout: "diagonal",
    });
    expect(result.success).toBe(false);
  });

  test("layout on openResponse rejected (strict-keys)", () => {
    const result = promptMetadataSchema.safeParse({
      type: "openResponse",
      layout: "horizontal",
    });
    expect(result.success).toBe(false);
  });

  test("unknown frontmatter key (typo) is rejected (strict-keys per type)", () => {
    // Typos like `tytle:` / `placholder:` / `interavl:` fail at preflight
    // because each branch is `.strict()`.
    expect(
      promptMetadataSchema.safeParse({ type: "openResponse", tytle: "x" })
        .success,
    ).toBe(false);
  });
});

// ----------- validateSliderLabels back-compat shim ------------

test("validateSliderLabels is a no-op after #243 (slider labels live in the body)", () => {
  const issues = validateSliderLabels(
    { type: "slider", min: 0, max: 100, interval: 1 },
    ["Low", "Mid", "High"],
  );
  expect(issues).toEqual([]);
});

// ----------- File-level parsing ------------

describe("promptFileSchema", () => {
  test("multipleChoice file parses correctly", () => {
    const markdown = `---
name: myPrompt
type: multipleChoice
---
Which option do you prefer?
---
- Option A
- Option B
- Option C`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.name).toBe("myPrompt");
      expect(result.data.metadata.type).toBe("multipleChoice");
      expect(result.data.body).toContain("Which option do you prefer?");
      expect(result.data.responseItems).toEqual([
        "Option A",
        "Option B",
        "Option C",
      ]);
      expect(result.data.sliderPoints).toEqual([]);
    }
  });

  test("openResponse file parses correctly", () => {
    const markdown = `---
name: openQ
type: openResponse
rows: 5
---
Please describe your experience.
---
> Write your response here`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual(["Write your response here"]);
    }
  });

  test("noResponse file is valid as a two-section file (#243 — no trailing ---)", () => {
    const markdown = `---
name: info
type: noResponse
---
This is informational text with no response needed.`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.type).toBe("noResponse");
      expect(result.data.responseItems).toEqual([]);
      expect(result.data.body).toContain("informational text");
    }
  });

  test("noResponse file with a stray third section is rejected (#243)", () => {
    const markdown = `---
name: info
type: noResponse
---
Body text.
---
- accidental list item`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes(
            "noResponse prompt must have exactly two sections",
          ),
        ),
      ).toBe(true);
    }
  });

  test("slider file with bare-number labels", () => {
    const markdown = `---
type: slider
min: 0
max: 100
interval: 1
---
Rate this.
---
- 0
- 50
- 100`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([0, 50, 100]);
      expect(result.data.responseItems).toEqual(["0", "50", "100"]);
    }
  });

  test("slider file with `<n>: <label>` form", () => {
    const markdown = `---
type: slider
min: 0
max: 100
interval: 1
---
Rate this.
---
- 0: Not familiar
- 50: Somewhat familiar
- 100: Very familiar`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([0, 50, 100]);
      expect(result.data.responseItems).toEqual([
        "Not familiar",
        "Somewhat familiar",
        "Very familiar",
      ]);
    }
  });

  test("slider file with mixed labeled and bare-number forms", () => {
    const markdown = `---
type: slider
min: 0
max: 100
interval: 1
---
Rate this.
---
- 0: Strongly disagree
- 25
- 50: Neutral
- 75
- 100: Strongly agree`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([0, 25, 50, 75, 100]);
      expect(result.data.responseItems).toEqual([
        "Strongly disagree",
        "25",
        "Neutral",
        "75",
        "Strongly agree",
      ]);
    }
  });

  test("slider labels can contain colons (everything after the first one is the label)", () => {
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate this.
---
- 5: Neutral: middle of the road`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual([
        "Neutral: middle of the road",
      ]);
    }
  });

  test("slider line whitespace around the colon is forgiving", () => {
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate.
---
-   5   :   Middle  `;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([5]);
      expect(result.data.responseItems).toEqual(["Middle"]);
    }
  });

  test("slider line with `<n>:` (colon, empty after) renders an empty label (#325)", () => {
    // Previously this fell back to the stringified number. The colon now
    // signals "labeled position, empty label string" — useful for putting
    // a tick at a snap point without rendering numeric text underneath.
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate.
---
- 5:`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([5]);
      expect(result.data.responseItems).toEqual([""]);
    }
  });

  test("slider line with `<n>: ` (colon + whitespace) also renders empty (#325)", () => {
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate.
---
- 5:   `;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual([""]);
    }
  });

  test("slider bare `- N` (no colon) still falls back to the number (#325)", () => {
    // Regression guard for the backward-compat half of the change: the
    // fallback only applies when there's no colon at all.
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate.
---
- 5`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual(["5"]);
    }
  });

  test("multipleChoice numeric `- N:` keeps the legacy fallback (#325 scoping)", () => {
    // The empty-label-after-colon change is scoped to sliders. For
    // multipleChoice numeric mode, an empty label would produce an
    // unlabeled radio (bad UX, no accessible name), so we keep the
    // legacy fallback to the stringified number.
    const markdown = `---
name: scale
type: multipleChoice
---
Rate it
---
- 1:
- 2:
- 3:`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responsePoints).toEqual([1, 2, 3]);
      expect(result.data.responseItems).toEqual(["1", "2", "3"]);
    }
  });

  test("slider with ticks-everywhere-but-labels-only-at-anchors (TIPI pattern, #325)", () => {
    // The motivating use case for #325: a 7-point Likert slider with
    // ticks at every snap point but text only at the endpoints and
    // midpoint. Previously required choosing between "all numeric
    // labels" (cluttered) or "anchors only" (no intermediate ticks).
    const markdown = `---
type: slider
min: 1
max: 7
interval: 1
---
How strongly do you agree?
---
- 1: Strongly disagree
- 2:
- 3:
- 4: Neutral
- 5:
- 6:
- 7: Strongly agree`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sliderPoints).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(result.data.responseItems).toEqual([
        "Strongly disagree",
        "",
        "",
        "Neutral",
        "",
        "",
        "Strongly agree",
      ]);
    }
  });

  test("slider line with non-numeric leading token is rejected", () => {
    const markdown = `---
type: slider
min: 0
max: 10
interval: 1
---
Rate.
---
- not-a-number: a label`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes("must start with a number"),
        ),
      ).toBe(true);
    }
  });

  test("multipleChoice with `>` lines is rejected (#243 — wrong marker for the type)", () => {
    const markdown = `---
type: multipleChoice
---
Pick one.
---
> Option A
> Option B`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes(
            `multipleChoice response lines must start with "- "`,
          ),
        ),
      ).toBe(true);
    }
  });

  test("openResponse with `-` lines is rejected (#243 — wrong marker for the type)", () => {
    const markdown = `---
type: openResponse
---
Describe.
---
- not a placeholder`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) =>
          i.message.includes(
            `openResponse placeholder lines must start with "> "`,
          ),
        ),
      ).toBe(true);
    }
  });

  test("listSorter with `-` lines is accepted", () => {
    const markdown = `---
type: listSorter
---
Rank these.
---
- Speed
- Cost
- Quality`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responseItems).toEqual(["Speed", "Cost", "Quality"]);
    }
  });

  test("fails on empty string", () => {
    const result = promptFileSchema.safeParse("");
    expect(result.success).toBe(false);
  });

  test("fails on whitespace-only string", () => {
    const result = promptFileSchema.safeParse("   \n  ");
    expect(result.success).toBe(false);
  });

  test("fails when missing --- delimiters", () => {
    const markdown = `name: foo
type: noResponse
Some body text`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
  });

  test("fails when body section is empty (noResponse)", () => {
    const markdown = `---
name: empty
type: noResponse
---
   `;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("body"))).toBe(
        true,
      );
    }
  });

  test("fails with invalid metadata type", () => {
    const markdown = `---
name: bad
type: invalidType
---
Some body.
---
- response`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
  });

  test("non-string input fails", () => {
    const result = promptFileSchema.safeParse(42);
    expect(result.success).toBe(false);
  });

  test("multipleChoice file with layout: horizontal", () => {
    const markdown = `---
type: multipleChoice
layout: horizontal
---
Do you agree?
---
- Yes
- No`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success && result.data.metadata.type === "multipleChoice") {
      expect(result.data.metadata.layout).toBe("horizontal");
    }
  });

  // ---------------------------------------------------------------------
  // #282 — numeric values for multipleChoice prompts
  // ---------------------------------------------------------------------

  describe("multipleChoice numeric mode (#282)", () => {
    test("parses `<number>: <label>` options into responsePoints + responseItems", () => {
      const markdown = `---
name: agreement
type: multipleChoice
---
How much do you agree?
---
- 1: Strongly disagree
- 2: Disagree
- 3: Neutral
- 4: Agree
- 5: Strongly agree`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([1, 2, 3, 4, 5]);
        expect(result.data.responseItems).toEqual([
          "Strongly disagree",
          "Disagree",
          "Neutral",
          "Agree",
          "Strongly agree",
        ]);
        expect(result.data.sliderPoints).toEqual([]);
      }
    });

    test("bare numbers are text mode; numeric mode requires an explicit colon (#289)", () => {
      // The colon is the numeric-mode signal. A bare `- 1` is shorthand for
      // `- 1: 1` (text label "1"), never a numeric scale point. Authors who
      // want numeric semantics (responsePoints) must write `- 1: <label>`.
      const markdown = `---
name: scale
type: multipleChoice
---
Rate it
---
- 1
- 2
- 3
- 4
- 5`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([]);
        expect(result.data.responseItems).toEqual(["1", "2", "3", "4", "5"]);
      }
    });

    test("comprehension check: numeric-looking labels with a text foil are text mode, not a mixing error (#289)", () => {
      // Real research pattern: an MCQ gate on a discrete fact whose options
      // happen to be small integers plus a non-numeric foil. These are
      // identifiers, not scale points, so the whole prompt is text mode and
      // `value: "2"` conditions keep working against the bare labels.
      const markdown = `---
name: num_speakers
type: multipleChoice
---
How many different people will tell you a story?
---
- 1
- 2
- 3
- 4
- It Varies`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([]);
        expect(result.data.responseItems).toEqual([
          "1",
          "2",
          "3",
          "4",
          "It Varies",
        ]);
      }
    });

    test("endpoints-only Likert opts into numeric mode with trailing colons (#289)", () => {
      // The migration path for a numeric scale that only labels its endpoints:
      // give every middle point a trailing colon so it reads as `<number>:`
      // (empty label falls back to the stringified number).
      const markdown = `---
name: agreement
type: multipleChoice
---
How much do you agree?
---
- 1: Strongly disagree
- 2:
- 3:
- 4:
- 5: Strongly agree`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([1, 2, 3, 4, 5]);
        expect(result.data.responseItems).toEqual([
          "Strongly disagree",
          "2",
          "3",
          "4",
          "Strongly agree",
        ]);
      }
    });

    test("non-integer values are accepted (any finite number)", () => {
      const markdown = `---
name: scale
type: multipleChoice
---
Rate it
---
- -1.5: Very low
- 0: Mid
- 2.5: High`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([-1.5, 0, 2.5]);
      }
    });

    test("text-only mode leaves responsePoints empty (back-compat)", () => {
      const markdown = `---
name: prefs
type: multipleChoice
---
Pick one
---
- Option A
- Option B
- Option C`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([]);
        expect(result.data.responseItems).toEqual([
          "Option A",
          "Option B",
          "Option C",
        ]);
      }
    });

    test("mixed numeric + text options is a validation error", () => {
      const markdown = `---
name: mixed
type: multipleChoice
---
Pick one
---
- 1: foo
- bar
- 3: baz`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes("mixes numeric and text"),
          ),
        ).toBe(true);
      }
    });

    test("a text label that contains a colon stays text, not numeric (#289)", () => {
      // The colon-as-numeric-signal rule must not trip on text labels that
      // happen to contain a colon — only a *number* before the first colon
      // counts. "Maybe" isn't finite, so this is plain text mode and the
      // label is preserved verbatim, colon and all.
      const markdown = `---
name: certainty
type: multipleChoice
---
Pick one
---
- Maybe: not sure
- Yes
- No`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([]);
        expect(result.data.responseItems).toEqual([
          "Maybe: not sure",
          "Yes",
          "No",
        ]);
      }
    });

    test("a single bare numeric option is text mode (#289)", () => {
      const markdown = `---
name: lone
type: multipleChoice
---
Pick one
---
- 1`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responsePoints).toEqual([]);
        expect(result.data.responseItems).toEqual(["1"]);
      }
    });

    test("explicit-numeric mixed with a bare number is an error, both orderings (#289)", () => {
      // The mixing rule is order-independent: a bare number (now text) next
      // to an explicit `- <number>: <label>` option errors regardless of
      // which comes first.
      const numericFirst = `---
name: mix_a
type: multipleChoice
---
Pick one
---
- 1: One
- 2`;
      const bareFirst = `---
name: mix_b
type: multipleChoice
---
Pick one
---
- 1
- 2: Two`;
      for (const markdown of [numericFirst, bareFirst]) {
        const result = promptFileSchema.safeParse(markdown);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(
            result.error.issues.some((i) =>
              i.message.includes("mixes numeric and text"),
            ),
          ).toBe(true);
        }
      }
    });

    test("duplicate numeric values are a validation error", () => {
      const markdown = `---
name: dup
type: multipleChoice
---
Pick one
---
- 1: first
- 1: second
- 2: third`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes("duplicate numeric value"),
          ),
        ).toBe(true);
      }
    });

    test("multi-select with numeric mode is rejected (single-select only in v1)", () => {
      const markdown = `---
name: multi
type: multipleChoice
select: multiple
---
Pick all that apply
---
- 1: One
- 2: Two
- 3: Three`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) =>
            i.message.includes("must be single-select"),
          ),
        ).toBe(true);
      }
    });

    test("multi-select with text-only mode still works (no regression)", () => {
      const markdown = `---
name: multi
type: multipleChoice
select: multiple
---
Pick all that apply
---
- One
- Two
- Three`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseItems).toEqual(["One", "Two", "Three"]);
        expect(result.data.responsePoints).toEqual([]);
      }
    });
  });

  // ---------------------------------------------------------------------
  // #282 — back-compat: sliderPoints still populated for sliders
  // ---------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // #181 — dropdown prompt type
  // ---------------------------------------------------------------------

  describe("dropdown", () => {
    test("dropdown with options + optional placeholder is valid", () => {
      const markdown = `---
name: language
type: dropdown
placeholder: "Pick one…"
---
What's your primary language?
---
- eng: English
- fra: French
- spa: Spanish`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.metadata.type).toBe("dropdown");
        expect(result.data.responseItems).toEqual([
          "eng: English",
          "fra: French",
          "spa: Spanish",
        ]);
      }
    });

    test("dropdown without placeholder is valid", () => {
      const markdown = `---
type: dropdown
---
Pick a number
---
- 1
- 2
- 3`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(true);
    });

    test("dropdown rejects unknown keys (strict)", () => {
      const result = promptMetadataSchema.safeParse({
        type: "dropdown",
        layout: "horizontal", // not a dropdown field
      });
      expect(result.success).toBe(false);
    });

    test("dropdown rejects `>` markers (those are openResponse-only)", () => {
      const markdown = `---
type: dropdown
---
Pick
---
> a
> b`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(false);
    });

    test("dropdown requires a third section", () => {
      const markdown = `---
type: dropdown
---
Pick`;
      const result = promptFileSchema.safeParse(markdown);
      expect(result.success).toBe(false);
    });
  });

  test("slider populates both responsePoints and (deprecated) sliderPoints", () => {
    const markdown = `---
name: heat
type: slider
min: 0
max: 100
interval: 1
---
How warm?
---
- 0: Cold
- 50: Mid
- 100: Hot`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.responsePoints).toEqual([0, 50, 100]);
      expect(result.data.sliderPoints).toEqual([0, 50, 100]);
      expect(result.data.responseItems).toEqual(["Cold", "Mid", "Hot"]);
    }
  });

  // ----------- metadata.name validation (#360) ------------

  test("frontmatter name with a slash is rejected at parse time", () => {
    const markdown = `---
name: foo/bar
type: noResponse
---
Body.`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
    if (!result.success) {
      // The error from `nameSchema`'s regex
      const msg = result.error.issues.map((i) => i.message).join(" | ");
      expect(msg).toMatch(/alphanumeric|special characters/i);
    }
  });

  test("frontmatter name over 64 chars is rejected at parse time", () => {
    const longName = "a".repeat(65);
    const markdown = `---
name: ${longName}
type: noResponse
---
Body.`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(false);
  });

  test("frontmatter name at the 64-char limit is accepted", () => {
    const okName = "a".repeat(64);
    const markdown = `---
name: ${okName}
type: noResponse
---
Body.`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.name).toBe(okName);
    }
  });
});

// ----------- Issue #380 — fenced code blocks containing `---` ------

// The pre-#380 splitter was a single regex split that matched any line
// of three-or-more hyphens anywhere in the file, including inside
// fenced code blocks. Researchers writing meta-documentation prompts
// (e.g. the component-gallery's per-component descriptions) couldn't
// quote stagebook's own prompt-file syntax inside a `noResponse`
// prompt without the inner `---` lines silently shredding the file
// into pseudo-sections.

describe("splitOnTopLevelHrules", () => {
  test("matches the legacy regex split on inputs without fences", () => {
    const input = "---\nmeta\n---\nbody\n---\nresponses";
    expect(splitOnTopLevelHrules(input)).toEqual(input.split(/^-{3,}$/gm));
  });

  test("leading `---` produces a leading empty-string section (back-compat)", () => {
    const input = "---\nmeta\n---\nbody";
    const sections = splitOnTopLevelHrules(input);
    expect(sections[0]).toBe("");
    expect(sections).toHaveLength(3);
  });

  test("ignores `---` lines inside a backtick-fenced code block", () => {
    const input = `---
type: noResponse
---
Some body.

\`\`\`yaml
---
type: multipleChoice
---
\`\`\`

More body.`;
    const sections = splitOnTopLevelHrules(input);
    // Three sections: leading empty, frontmatter, body. The two `---`
    // lines inside the fence must NOT have produced extra sections.
    expect(sections).toHaveLength(3);
    expect(sections[2]).toContain("```yaml");
    expect(sections[2]).toContain("type: multipleChoice");
  });

  test("toggles fence state in/out across multiple fenced blocks", () => {
    const input = `---
meta
---
\`\`\`
---
\`\`\`
between
\`\`\`yaml
---
\`\`\``;
    const sections = splitOnTopLevelHrules(input);
    // Two fences each containing one `---` line — both should be
    // suppressed. Result: leading empty, frontmatter, body.
    expect(sections).toHaveLength(3);
    expect(sections[2]).toContain("between");
  });

  test("a closing fence on the last line still toggles cleanly", () => {
    // Documents the current behavior — an unclosed fence (terminating
    // file inside the fence) suppresses any `---` from there to EOF.
    // Stagebook prompts always close their fences in practice; this
    // test pins the simple behavior so a future refactor doesn't
    // silently change it.
    const input = "---\nmeta\n---\nbody\n```\n---\nin fence";
    const sections = splitOnTopLevelHrules(input);
    expect(sections).toHaveLength(3);
    expect(sections[2]).toContain("in fence");
  });
});

describe("promptFileSchema — fenced code with `---` inside (#380)", () => {
  test("noResponse body containing a fenced code block with `---` parses", () => {
    const markdown = `---
type: noResponse
name: gallery_demo
---

# RadioGroup

Authoring shape:

\`\`\`yaml
---
type: multipleChoice
name: my_question
---
\`\`\`

That's the gist.`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.type).toBe("noResponse");
      // The body must include the fenced code block verbatim.
      expect(result.data.body).toContain("```yaml");
      expect(result.data.body).toContain("type: multipleChoice");
    }
  });

  test("multipleChoice prompt body containing fenced `---` still parses (responses follow)", () => {
    // Three-section format: frontmatter / body / responses. The fenced
    // `---` in the body must not be misread as the body/responses
    // boundary.
    const markdown = `---
type: multipleChoice
name: q1
---

Pick one. The Stagebook authoring shape is:

\`\`\`yaml
---
type: noResponse
---
\`\`\`

Now your answer:

---

- alpha
- bravo`;
    const result = promptFileSchema.safeParse(markdown);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata.type).toBe("multipleChoice");
      expect(result.data.body).toContain("```yaml");
      expect(result.data.responseItems).toEqual(["alpha", "bravo"]);
    }
  });
});
