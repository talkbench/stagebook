import { describe, expect, test, vi } from "vitest";
import { checkExpressionTypesWithLoader } from "./expressionTypes.js";

const source = "---\ntype: openResponse\n---\nAnswer.\n---\n> Your answer";
const study = (file: string) => ({
  treatments: [
    {
      gameStages: [
        {
          elements: [
            { type: "prompt", name: "answer", file },
            {
              type: "submitButton",
              conditions: {
                reference: "self.prompt.answer",
                comparator: "equals",
                value: 2,
              },
            },
          ],
        },
      ],
    },
  ],
});

describe("expression type prompt loading", () => {
  test("loads local prompts and retains both errors and warnings", async () => {
    const loadPrompt = vi.fn().mockResolvedValue(source);
    const issues = await checkExpressionTypesWithLoader({
      fileObj: study("question.prompt.md"),
      loadPrompt,
    });
    expect(loadPrompt).toHaveBeenCalledTimes(1);
    expect(loadPrompt).toHaveBeenCalledWith("question.prompt.md");
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
  });
  test.each([
    "https://example.com/question.prompt.md",
    "asset://question.prompt.md",
    "/etc/question.prompt.md",
    "a/../question.prompt.md",
    "a\\question.prompt.md",
  ])("does not load a rejected or remote path %s", async (file) => {
    const loadPrompt = vi.fn();
    const issues = await checkExpressionTypesWithLoader({
      fileObj: study(file),
      loadPrompt,
    });
    expect(loadPrompt).not.toHaveBeenCalled();
    expect(issues[0]).toMatchObject({
      severity: "warning",
      reason: "unreadablePrompt",
    });
  });
  test.each([null, "not a prompt"])(
    "unavailable or invalid prompt %s gets a named warning",
    async (loaded) => {
      const issues = await checkExpressionTypesWithLoader({
        fileObj: study("question.prompt.md"),
        loadPrompt: async () => loaded,
      });
      expect(issues[0]).toMatchObject({
        severity: "warning",
        reason: "unreadablePrompt",
      });
    },
  );
  test("loader failures become warnings", async () => {
    const issues = await checkExpressionTypesWithLoader({
      fileObj: study("question.prompt.md"),
      loadPrompt: async () => {
        throw new Error("unreadable");
      },
    });
    expect(issues[0]).toMatchObject({
      severity: "warning",
      reason: "unreadablePrompt",
    });
  });
});
