import { describe, expect, test, vi } from "vitest";
import { checkSharedPromptValidationWithLoader } from "./sharedPromptValidation.js";

const fileWith = (file = "q.prompt.md") => ({
  treatments: [
    {
      name: "t",
      gameStages: [
        { name: "s", elements: [{ type: "prompt", shared: true, file }] },
      ],
    },
  ],
});
const source =
  "---\ntype: openResponse\nrequired: true\n---\nQuestion\n---\n>\n";

describe("shared prompt validation loader", () => {
  test("loads and parses prompt metadata", async () => {
    expect(
      await checkSharedPromptValidationWithLoader({
        fileObj: fileWith(),
        loadPrompt: async () => source,
      }),
    ).toHaveLength(1);
  });
  test.each([
    "/private/secret.prompt.md",
    "a/../secret.prompt.md",
    "a\\secret.prompt.md",
    "https://example.com/q.prompt.md",
  ])("never loads rejected or remote path %s", async (file) => {
    const loadPrompt = vi.fn(async () => source);
    expect(
      await checkSharedPromptValidationWithLoader({
        fileObj: fileWith(file),
        loadPrompt,
      }),
    ).toEqual([]);
    expect(loadPrompt).not.toHaveBeenCalled();
  });
  test.each([null, "not a prompt"])(
    "skips unavailable or malformed %j",
    async (value) => {
      expect(
        await checkSharedPromptValidationWithLoader({
          fileObj: fileWith(),
          loadPrompt: async () => value,
        }),
      ).toEqual([]);
    },
  );
  test("skips a throwing loader", async () => {
    expect(
      await checkSharedPromptValidationWithLoader({
        fileObj: fileWith(),
        loadPrompt: async () => {
          throw new Error("missing");
        },
      }),
    ).toEqual([]);
  });
});
