import { describe, it, expect, vi } from "vitest";
import { checkPromptLocaleConsistencyWithLoader } from "./localeConsistency.js";

/**
 * Host-side wiring for the locale-consistency rule. The pure rule has its
 * own exhaustive suite (`schemas/localeConsistency.test.ts`); this verifies
 * the I/O layer that feeds it: which paths get loaded, how unreadable /
 * unparseable / schema-rejected prompts are handled, and that the loaded
 * frontmatter locale reaches the rule.
 */

const treatment = (locale: string | undefined, file: string) => ({
  treatments: [
    {
      name: "t",
      ...(locale === undefined ? {} : { locale }),
      gameStages: [{ name: "g", elements: [{ type: "prompt", file }] }],
    },
  ],
});

const promptWithLocale = (locale: string | undefined) =>
  `---\ntype: noResponse\n${locale === undefined ? "" : `locale: ${locale}\n`}---\nbody\n`;

describe("checkPromptLocaleConsistencyWithLoader", () => {
  it("flags an untagged prompt referenced by a non-English treatment", async () => {
    const loadPrompt = vi.fn(async () => promptWithLocale(undefined));
    const mismatches = await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "intro.prompt.md"),
      loadPrompt,
    });
    expect(loadPrompt).toHaveBeenCalledWith("intro.prompt.md");
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      containerLocale: "he",
      promptLocale: "en",
      promptFile: "intro.prompt.md",
    });
  });

  it("passes when prompt locale matches the treatment", async () => {
    const mismatches = await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "intro.prompt.md"),
      loadPrompt: async () => promptWithLocale("he"),
    });
    expect(mismatches).toEqual([]);
  });

  it("skips prompts the loader can't read (returns null)", async () => {
    const mismatches = await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "missing.prompt.md"),
      loadPrompt: async () => null,
    });
    expect(mismatches).toEqual([]);
  });

  it("skips prompts whose loader throws", async () => {
    const mismatches = await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "boom.prompt.md"),
      loadPrompt: async () => {
        throw new Error("network");
      },
    });
    expect(mismatches).toEqual([]);
  });

  it("skips prompts that don't parse as prompt files", async () => {
    const mismatches = await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "junk.prompt.md"),
      loadPrompt: async () => "this is not a valid prompt file",
    });
    expect(mismatches).toEqual([]);
  });

  it("never loads a schema-rejected path (absolute / traversal)", async () => {
    const loadPrompt = vi.fn(async () => promptWithLocale(undefined));
    await checkPromptLocaleConsistencyWithLoader({
      fileObj: treatment("he", "/etc/passwd"),
      loadPrompt,
    });
    expect(loadPrompt).not.toHaveBeenCalled();
  });

  it("loads each unique referenced prompt once", async () => {
    const loadPrompt = vi.fn(async () => promptWithLocale("en"));
    await checkPromptLocaleConsistencyWithLoader({
      fileObj: {
        treatments: [
          {
            name: "t",
            locale: "en",
            gameStages: [
              {
                name: "a",
                elements: [{ type: "prompt", file: "p.prompt.md" }],
              },
              {
                name: "b",
                elements: [{ type: "prompt", file: "p.prompt.md" }],
              },
            ],
          },
        ],
      },
      loadPrompt,
    });
    expect(loadPrompt).toHaveBeenCalledTimes(1);
  });
});
