import { describe, test, expect } from "vitest";
import {
  collectReferencedPromptFiles,
  checkPromptLocaleConsistency,
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
      treatmentName: "t-he",
      treatmentLocale: "he",
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
      treatmentLocale: "en",
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
    expect(issues[0]?.treatmentName).toBe("t-he");
  });
});
