import { describe, test, expect } from "vitest";
import {
  localeSchema,
  fileSchema,
  promptFilePathSchema,
  baseTreatmentSchema,
} from "./treatment.js";
import {
  resolvedTreatmentSchema,
  resolvedTreatmentFileSchema,
} from "./resolved.js";
import { introSequenceSchema } from "./treatment.js";
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
  // Interior `..` (a parent-directory segment after a real segment) is the
  // shape a crafted `${locale}` substitution produces in the idiomatic
  // `prompts/${locale}/x.prompt.md` pattern — rejected.
  test.each([
    "prompts/../../etc/passwd.prompt.md",
    "prompts/${locale}/../../x.prompt.md", // placeholder path still gated
    "a/../b.prompt.md", // interior even though it stays in-tree
  ])("rejects interior traversal %s", (path) => {
    expect(fileSchema.safeParse(path).success).toBe(false);
  });

  // A LEADING run of `..` is what `resolveImports` mechanically produces for
  // templates imported from a parent directory (`imports: ../shared/…`) —
  // a documented, test-pinned layout. Permitted.
  test.each([
    "../shared/prompts/x.prompt.md",
    "../../shared/x.prompt.md",
    "../secret.prompt.md",
  ])("permits leading parent-relative %s (import rewriting)", (path) => {
    expect(fileSchema.safeParse(path).success).toBe(true);
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
    expect(
      promptFilePathSchema.safeParse("prompts/../../x.prompt.md").success,
    ).toBe(false);
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

  test("known residual: a path STARTING with a placeholder can fill to leading ..", () => {
    // `${x}/q.prompt.md` filled with x="../../secret" gives an all-leading-..
    // path, indistinguishable from import rewriting at this layer. Host
    // loaders sandbox reads to the study root (getTextContent contract);
    // documented in the fileSchema refine + ADR security section.
    expect(fileSchema.safeParse("../../secret/q.prompt.md").success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Intro-sequence locale (pre-assignment phase carries its own locale)
// ---------------------------------------------------------------------------

describe("introSequenceSchema.locale", () => {
  function minimalIntro(extra: Record<string, unknown> = {}) {
    return {
      name: "intro1",
      introSteps: [{ name: "consent", elements: [{ type: "submitButton" }] }],
      ...extra,
    };
  }

  test("locale is optional (absent = English)", () => {
    const r = introSequenceSchema.safeParse(minimalIntro());
    expect(r.success).toBe(true);
  });

  test("accepts a literal and a ${field} placeholder", () => {
    expect(
      introSequenceSchema.safeParse(minimalIntro({ locale: "he" })).success,
    ).toBe(true);
    expect(
      introSequenceSchema.safeParse(minimalIntro({ locale: "${locale}" }))
        .success,
    ).toBe(true);
  });

  test("rejects a malformed locale", () => {
    expect(
      introSequenceSchema.safeParse(minimalIntro({ locale: "hebrew" })).success,
    ).toBe(false);
  });

  test("resolved intro file rejects a leaked ${field} placeholder", () => {
    const base = {
      introSequences: [
        {
          name: "intro1",
          locale: "${locale}",
          introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
        },
      ],
    };
    expect(resolvedTreatmentFileSchema.safeParse(base).success).toBe(false);
    const ok = {
      introSequences: [
        {
          name: "intro1",
          locale: "he",
          introSteps: [{ name: "s", elements: [{ type: "submitButton" }] }],
        },
      ],
    };
    expect(resolvedTreatmentFileSchema.safeParse(ok).success).toBe(true);
  });
});
