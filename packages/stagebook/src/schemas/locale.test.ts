import { describe, test, expect } from "vitest";
import {
  localeSchema,
  fileSchema,
  promptFilePathSchema,
  baseTreatmentSchema,
} from "./treatment.js";
import { resolvedTreatmentSchema } from "./resolved.js";
import { promptMetadataSchema } from "./promptFile.js";

// ---------------------------------------------------------------------------
// localeSchema — BCP-47 tag SHAPE (not catalog membership; see ADR
// docs/decisions/2026-06-localization.md decision #9)
// ---------------------------------------------------------------------------

describe("localeSchema", () => {
  test.each(["en", "he", "he-IL", "zh-Hant", "es-419", "ase"])(
    "accepts well-formed tag %s",
    (tag) => {
      expect(localeSchema.safeParse(tag).success).toBe(true);
    },
  );

  test.each([
    "hebrew", // full language name, not a tag
    "e", // primary subtag too short
    "h3", // digits in the primary subtag
    "he_IL", // underscore separator
    "he-", // trailing separator
    "", // empty
    "${locale}", // placeholder — only valid where explicitly or'd in
  ])("rejects malformed tag %s", (tag) => {
    expect(localeSchema.safeParse(tag).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Treatment-level locale field (pre-fill: literal or ${field} placeholder)
// ---------------------------------------------------------------------------

function minimalTreatment(extra: Record<string, unknown> = {}) {
  return {
    name: "t1",
    playerCount: 1,
    gameStages: [
      {
        name: "stage1",
        duration: 10,
        elements: [{ type: "prompt", file: "prompts/intro.prompt.md" }],
      },
    ],
    ...extra,
  };
}

describe("baseTreatmentSchema.locale", () => {
  test("locale is optional (absent = English)", () => {
    const result = baseTreatmentSchema.safeParse(minimalTreatment());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBeUndefined();
  });

  test("accepts a literal locale", () => {
    const result = baseTreatmentSchema.safeParse(
      minimalTreatment({ locale: "he" }),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe("he");
  });

  test("accepts a ${field} placeholder (single-source template arm)", () => {
    const result = baseTreatmentSchema.safeParse(
      minimalTreatment({ locale: "${locale}" }),
    );
    expect(result.success).toBe(true);
  });

  test("rejects a malformed locale", () => {
    const result = baseTreatmentSchema.safeParse(
      minimalTreatment({ locale: "hebrew" }),
    );
    expect(result.success).toBe(false);
  });
});

describe("resolvedTreatmentSchema.locale (post-fill)", () => {
  const resolvedBase = {
    name: "t1",
    playerCount: 1,
    gameStages: [
      {
        name: "stage1",
        duration: 10,
        elements: [{ type: "prompt", file: "prompts/intro.prompt.md" }],
      },
    ],
  };

  test("accepts a concrete locale and absence", () => {
    expect(
      resolvedTreatmentSchema.safeParse({ ...resolvedBase, locale: "he" })
        .success,
    ).toBe(true);
    expect(resolvedTreatmentSchema.safeParse(resolvedBase).success).toBe(true);
  });

  test("rejects a leaked ${field} placeholder after fill", () => {
    expect(
      resolvedTreatmentSchema.safeParse({
        ...resolvedBase,
        locale: "${locale}",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt frontmatter locale
// ---------------------------------------------------------------------------

describe("prompt frontmatter locale", () => {
  test("accepts locale on any prompt type via shared baseMetadataFields", () => {
    expect(
      promptMetadataSchema.safeParse({ type: "noResponse", locale: "he" })
        .success,
    ).toBe(true);
    expect(
      promptMetadataSchema.safeParse({ type: "openResponse", locale: "en" })
        .success,
    ).toBe(true);
  });

  test("locale is optional (absent = English)", () => {
    expect(promptMetadataSchema.safeParse({ type: "noResponse" }).success).toBe(
      true,
    );
  });

  test("rejects a malformed frontmatter locale", () => {
    expect(
      promptMetadataSchema.safeParse({ type: "noResponse", locale: "hebrew" })
        .success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fileSchema `..` traversal gate (security; ADR acceptance condition)
// ---------------------------------------------------------------------------

describe("fileSchema parent-directory traversal gate", () => {
  test.each([
    "../secret.prompt.md",
    "prompts/../../etc/passwd.prompt.md",
    "prompts/${locale}/../../x.prompt.md", // placeholder path still gated
    "..",
  ])("rejects %s", (path) => {
    expect(fileSchema.safeParse(path).success).toBe(false);
  });

  test.each([
    "prompts/en/intro.prompt.md",
    "prompts/${locale}/intro.prompt.md",
    "media/clip..mp4", // `..` inside a segment is not traversal
    "prompts/..hidden/x.prompt.md",
  ])("accepts %s", (path) => {
    expect(fileSchema.safeParse(path).success).toBe(true);
  });

  test("URLs are exempt (scheme paths are normalized by URL parsing)", () => {
    expect(
      fileSchema.safeParse("https://cdn.example.com/a/../b.mp4").success,
    ).toBe(true);
  });

  test("the gate also applies through promptFilePathSchema", () => {
    expect(promptFilePathSchema.safeParse("../x.prompt.md").success).toBe(
      false,
    );
    expect(
      promptFilePathSchema.safeParse("prompts/he/x.prompt.md").success,
    ).toBe(true);
  });

  test("post-fill: a crafted locale value resolving to traversal is rejected", () => {
    // Simulates `prompts/${locale}/x.prompt.md` with locale = "../.."
    expect(fileSchema.safeParse("prompts/../../x.prompt.md").success).toBe(
      false,
    );
  });
});
