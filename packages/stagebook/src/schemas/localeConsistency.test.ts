import { describe, test, expect } from "vitest";
import {
  collectReferencedPromptFiles,
  checkPromptLocaleConsistency,
  checkConsentLocaleCoverage,
} from "./localeConsistency.js";

function treatmentFile(
  treatments: {
    name: string;
    locale?: string;
    files?: string[];
    exitFiles?: string[];
  }[],
) {
  return {
    treatments: treatments.map((t) => ({
      name: t.name,
      playerCount: 1,
      ...(t.locale !== undefined ? { locale: t.locale } : {}),
      gameStages: [
        {
          name: "stage1",
          duration: 10,
          elements: (t.files ?? []).map((file) => ({ type: "prompt", file })),
        },
      ],
      ...(t.exitFiles
        ? {
            exitSequence: [
              {
                name: "exit1",
                elements: t.exitFiles.map((file) => ({
                  type: "prompt",
                  file,
                })),
              },
            ],
          }
        : {}),
    })),
  };
}

describe("collectReferencedPromptFiles", () => {
  test("collects unique relative prompt paths from gameStages and exitSequence", () => {
    const file = treatmentFile([
      {
        name: "t1",
        files: ["prompts/a.prompt.md", "prompts/b.prompt.md"],
        exitFiles: ["prompts/exit.prompt.md", "prompts/a.prompt.md"],
      },
    ]);
    expect(collectReferencedPromptFiles(file).sort()).toEqual([
      "prompts/a.prompt.md",
      "prompts/b.prompt.md",
      "prompts/exit.prompt.md",
    ]);
  });

  test("excludes scheme-bearing paths and non-prompt elements", () => {
    const file = {
      treatments: [
        {
          name: "t1",
          playerCount: 1,
          gameStages: [
            {
              name: "s",
              duration: 5,
              elements: [
                { type: "prompt", file: "https://x.example/p.prompt.md" },
                { type: "prompt", file: "asset://p.prompt.md" },
                { type: "mediaPlayer", file: "media/clip.mp4" },
                { type: "prompt", file: "prompts/local.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectReferencedPromptFiles(file)).toEqual([
      "prompts/local.prompt.md",
    ]);
  });

  test("is defensive over malformed input", () => {
    expect(collectReferencedPromptFiles(null)).toEqual([]);
    expect(collectReferencedPromptFiles("nope")).toEqual([]);
    expect(collectReferencedPromptFiles({ treatments: "nope" })).toEqual([]);
    expect(
      collectReferencedPromptFiles({ treatments: [{ gameStages: [null] }] }),
    ).toEqual([]);
  });
});

describe("checkPromptLocaleConsistency", () => {
  test("en treatment + untagged prompt: no mismatch (both default en)", () => {
    const file = treatmentFile([
      { name: "t-en", files: ["prompts/a.prompt.md"] },
    ]);
    const locales = new Map([["prompts/a.prompt.md", undefined]]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });

  test("he treatment + untagged prompt: mismatch (untagged counts as en)", () => {
    const file = treatmentFile([
      { name: "t-he", locale: "he", files: ["prompts/a.prompt.md"] },
    ]);
    const locales = new Map([["prompts/a.prompt.md", undefined]]);
    const issues = checkPromptLocaleConsistency(file, locales);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      containerKind: "treatment",
      containerName: "t-he",
      containerLocale: "he",
      promptFile: "prompts/a.prompt.md",
      promptLocale: "en",
    });
    expect(issues[0]?.message).toContain('locale "en"');
  });

  test("he treatment + he-tagged prompt: no mismatch", () => {
    const file = treatmentFile([
      { name: "t-he", locale: "he", files: ["prompts/he/a.prompt.md"] },
    ]);
    const locales = new Map([["prompts/he/a.prompt.md", "he"]]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });

  test("compares by primary subtag: he-IL treatment matches he prompt", () => {
    const file = treatmentFile([
      { name: "t", locale: "he-IL", files: ["prompts/a.prompt.md"] },
    ]);
    const locales = new Map([["prompts/a.prompt.md", "he"]]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });

  test("en treatment + he-tagged prompt: mismatch (stale copy direction)", () => {
    const file = treatmentFile([
      { name: "t-en", files: ["prompts/a.prompt.md"] },
    ]);
    const locales = new Map([["prompts/a.prompt.md", "he"]]);
    const issues = checkPromptLocaleConsistency(file, locales);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      containerLocale: "en",
      promptLocale: "he",
    });
  });

  test("paths absent from the map are skipped (host didn't load them)", () => {
    const file = treatmentFile([
      { name: "t-he", locale: "he", files: ["prompts/a.prompt.md"] },
    ]);
    expect(checkPromptLocaleConsistency(file, new Map())).toEqual([]);
  });

  test("exitSequence prompts are checked too", () => {
    const file = treatmentFile([
      { name: "t-he", locale: "he", exitFiles: ["prompts/exit.prompt.md"] },
    ]);
    const locales = new Map([["prompts/exit.prompt.md", "en"]]);
    expect(checkPromptLocaleConsistency(file, locales)).toHaveLength(1);
  });

  test("same prompt under two arms: only the mismatching arm fires", () => {
    const file = treatmentFile([
      { name: "t-en", files: ["prompts/shared.prompt.md"] },
      { name: "t-he", locale: "he", files: ["prompts/shared.prompt.md"] },
    ]);
    const locales = new Map([["prompts/shared.prompt.md", "en"]]);
    const issues = checkPromptLocaleConsistency(file, locales);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.containerName).toBe("t-he");
  });

  test("same prompt referenced twice in one treatment reports once", () => {
    const file = treatmentFile([
      {
        name: "t-he",
        locale: "he",
        files: ["prompts/q.prompt.md"],
        exitFiles: ["prompts/q.prompt.md"],
      },
    ]);
    const locales = new Map([["prompts/q.prompt.md", undefined]]);
    expect(checkPromptLocaleConsistency(file, locales)).toHaveLength(1);
  });

  test("a leaked ${...} treatment locale is skipped (schema reports the leak)", () => {
    const file = treatmentFile([
      { name: "t", locale: "${locale}", files: ["prompts/q.prompt.md"] },
    ]);
    const locales = new Map([["prompts/q.prompt.md", "he"]]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });
});

describe("intro sequences (pre-assignment phase)", () => {
  function fileWithIntro(
    seqs: { name: string; locale?: string; files: string[] }[],
  ) {
    return {
      introSequences: seqs.map((q) => ({
        name: q.name,
        ...(q.locale !== undefined ? { locale: q.locale } : {}),
        introSteps: [
          {
            name: "step1",
            elements: q.files.map((file) => ({ type: "prompt", file })),
          },
        ],
      })),
    };
  }

  test("checks intro prompts against the intro sequence's own locale", () => {
    const file = fileWithIntro([
      { name: "intro-he", locale: "he", files: ["prompts/consent.prompt.md"] },
    ]);
    const locales = new Map([["prompts/consent.prompt.md", undefined]]);
    const issues = checkPromptLocaleConsistency(file, locales);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      containerKind: "intro sequence",
      containerName: "intro-he",
      containerLocale: "he",
      promptLocale: "en",
    });
    expect(issues[0]?.message).toContain('intro sequence "intro-he"');
  });

  test("passes when the intro prompt matches the sequence locale", () => {
    const file = fileWithIntro([
      {
        name: "intro-he",
        locale: "he",
        files: ["prompts/he/consent.prompt.md"],
      },
    ]);
    const locales = new Map([["prompts/he/consent.prompt.md", "he"]]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });

  test("collects intro prompt files too", () => {
    const file = fileWithIntro([
      { name: "intro-en", files: ["prompts/welcome.prompt.md"] },
    ]);
    expect(collectReferencedPromptFiles(file)).toEqual([
      "prompts/welcome.prompt.md",
    ]);
  });

  test("an intro sequence does not inherit a treatment's locale", () => {
    // he treatment + en intro sequence in one file: the en intro prompt is
    // fine against the en intro, NOT flagged against the he treatment.
    const file = {
      introSequences: [
        {
          name: "intro-en",
          locale: "en",
          introSteps: [
            {
              name: "s",
              elements: [{ type: "prompt", file: "prompts/intro.prompt.md" }],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "study-he",
          locale: "he",
          playerCount: 1,
          gameStages: [
            {
              name: "g",
              duration: 5,
              elements: [{ type: "prompt", file: "prompts/he/q.prompt.md" }],
            },
          ],
        },
      ],
    };
    const locales = new Map([
      ["prompts/intro.prompt.md", "en"],
      ["prompts/he/q.prompt.md", "he"],
    ]);
    expect(checkPromptLocaleConsistency(file, locales)).toEqual([]);
  });
});

describe("checkConsentLocaleCoverage (#529, i18n-completeness)", () => {
  function fileWithConsent(spec: {
    treatments?: { name: string; locale?: string }[];
    consent?: { name: string; locale?: string }[];
  }): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      treatments: (spec.treatments ?? []).map((t) => ({
        name: t.name,
        playerCount: 1,
        ...(t.locale !== undefined ? { locale: t.locale } : {}),
        gameStages: [{ name: "g", duration: 5, elements: [] }],
      })),
    };
    if (spec.consent !== undefined) {
      obj.consent = spec.consent.map((a) => ({
        name: a.name,
        ...(a.locale !== undefined ? { locale: a.locale } : {}),
        steps: [{ name: "s", elements: [] }],
      }));
    }
    return obj;
  }

  test("treatment locale with no matching consent arm: warns", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
      consent: [{ name: "gdpr", locale: "en" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ locale: "he", treatments: ["t-he"] });
    expect(gaps[0]?.message).toContain('locale "he"');
    expect(gaps[0]?.message).toContain("`locale: he`");
    expect(gaps[0]?.message).toContain("warning, not an error");
  });

  test("matching consent arm present: clean", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
      consent: [
        { name: "gdpr-en", locale: "en" },
        { name: "gdpr-he", locale: "he" },
      ],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("omitted locales both default to en: clean", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t" }],
      consent: [{ name: "gdpr" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("en treatment (locale omitted) uncovered by an he-only consent: warns for en", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t" }],
      consent: [{ name: "gdpr-he", locale: "he" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ locale: "en", treatments: ["t"] });
  });

  test("repeated consent-arm locale is handled (arm locale may repeat)", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
      consent: [
        { name: "gdpr-he", locale: "he" },
        { name: "irb-he", locale: "he" },
      ],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("consent absent entirely: no warning (feature is opt-in)", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("consent present but empty: no warning (feature is opt-in)", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
      consent: [],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("per-locale dedup: two treatments share the missing locale, one warning", () => {
    const file = fileWithConsent({
      treatments: [
        { name: "t-he-a", locale: "he" },
        { name: "t-he-b", locale: "he" },
      ],
      consent: [{ name: "gdpr", locale: "en" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.locale).toBe("he");
    expect(gaps[0]?.treatments).toEqual(["t-he-a", "t-he-b"]);
    // Plural noun AND verb agreement pinned together (guards the plural branch
    // against regressing to the singular "declares").
    expect(gaps[0]?.message).toContain(
      'Treatments "t-he-a", "t-he-b" declare locale "he"',
    );
  });

  test("multiple uncovered locales each warn once, in first-seen order", () => {
    const file = fileWithConsent({
      treatments: [
        { name: "t-he", locale: "he" },
        { name: "t-ar", locale: "ar" },
      ],
      consent: [{ name: "gdpr", locale: "en" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    // Not sorted: the gaps array preserves the order locales are first seen
    // among the treatments (he before ar), for stable diagnostic output.
    expect(gaps.map((g) => g.locale)).toEqual(["he", "ar"]);
  });

  test("compares by primary subtag: he-IL treatment covered by he arm", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t", locale: "he-IL" }],
      consent: [{ name: "gdpr", locale: "he" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("compares by primary subtag: he treatment covered by he-IL arm", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t", locale: "he" }],
      consent: [{ name: "gdpr", locale: "he-IL" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("a leaked ${...} treatment locale is skipped (schema reports the leak)", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t", locale: "${locale}" }],
      consent: [{ name: "gdpr", locale: "en" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("a leaked ${...} consent-arm locale does not count as coverage", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t-he", locale: "he" }],
      consent: [{ name: "gdpr", locale: "${locale}" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.locale).toBe("he");
  });

  test("locale match is case-insensitive (HE arm covers he treatment)", () => {
    const file = fileWithConsent({
      treatments: [{ name: "t", locale: "he" }],
      consent: [{ name: "gdpr", locale: "HE" }],
    });
    expect(checkConsentLocaleCoverage(file)).toEqual([]);
  });

  test("a malformed arm in a non-empty consent does not suppress a real gap", () => {
    // consent is non-empty (opt-in fires), but the only arm is a non-record.
    // It contributes no coverage, so the he treatment still warns — and the
    // walk stays defensive (no throw) over the garbage arm.
    const file = {
      treatments: [
        {
          name: "t-he",
          playerCount: 1,
          locale: "he",
          gameStages: [{ name: "g", duration: 5, elements: [] }],
        },
      ],
      consent: [null],
    };
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.locale).toBe("he");
  });

  test("singular vs plural phrasing in the message", () => {
    const file = fileWithConsent({
      treatments: [{ name: "solo", locale: "he" }],
      consent: [{ name: "gdpr", locale: "en" }],
    });
    const gaps = checkConsentLocaleCoverage(file);
    expect(gaps[0]?.message).toContain('Treatment "solo" declares');
  });

  test("is defensive over malformed input", () => {
    expect(checkConsentLocaleCoverage(null)).toEqual([]);
    expect(checkConsentLocaleCoverage("nope")).toEqual([]);
    expect(checkConsentLocaleCoverage({ consent: "nope" })).toEqual([]);
    expect(
      checkConsentLocaleCoverage({ treatments: "nope", consent: [null] }),
    ).toEqual([]);
    expect(
      checkConsentLocaleCoverage({ treatments: [null], consent: [{}] }),
    ).toEqual([]);
  });
});
