import { describe, it, expect, vi } from "vitest";
import { checkUnsatisfiableConditionsWithLoader } from "./unsatisfiableConditions.js";

/**
 * Host-side wiring for the unsatisfiable-condition rule (#480). The pure rule
 * has its own exhaustive suite (`schemas/unsatisfiableConditions.test.ts`);
 * this verifies the I/O layer that feeds it: which paths get loaded, and how
 * unreadable / unparseable / schema-rejected prompts are handled.
 */

const mcPrompt = (options: string[]) =>
  `---\ntype: multipleChoice\n---\nPick\n---\n${options
    .map((o) => `- ${o}`)
    .join("\n")}\n`;

const treatment = (file: string, comparator: string, value: string) => ({
  treatments: [
    {
      name: "t",
      gameStages: [
        {
          name: "g",
          elements: [
            { type: "prompt", name: "q", file },
            {
              type: "submitButton",
              conditions: [{ reference: "self.prompt.q", comparator, value }],
            },
          ],
        },
      ],
    },
  ],
});

describe("checkUnsatisfiableConditionsWithLoader", () => {
  it("flags a dead gate, loading the referenced prompt", async () => {
    const loadPrompt = vi.fn(async () => mcPrompt(["Yes", "No"]));
    const issues = await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("q.prompt.md", "equals", "Maybe"),
      loadPrompt,
    });
    expect(loadPrompt).toHaveBeenCalledWith("q.prompt.md");
    expect(issues).toHaveLength(1);
    expect(issues[0].reference).toBe("self.prompt.q");
  });

  it("passes when the condition is satisfiable", async () => {
    const issues = await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("q.prompt.md", "equals", "Yes"),
      loadPrompt: async () => mcPrompt(["Yes", "No"]),
    });
    expect(issues).toEqual([]);
  });

  it("skips prompts the loader can't read (returns null)", async () => {
    const issues = await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("missing.prompt.md", "equals", "Maybe"),
      loadPrompt: async () => null,
    });
    expect(issues).toEqual([]);
  });

  it("skips prompts whose loader throws", async () => {
    const issues = await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("boom.prompt.md", "equals", "Maybe"),
      loadPrompt: async () => {
        throw new Error("network");
      },
    });
    expect(issues).toEqual([]);
  });

  it("skips prompts that don't parse as prompt files", async () => {
    const issues = await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("junk.prompt.md", "equals", "Maybe"),
      loadPrompt: async () => "this is not a valid prompt file",
    });
    expect(issues).toEqual([]);
  });

  it("never loads a schema-rejected path (absolute / traversal)", async () => {
    const loadPrompt = vi.fn(async () => mcPrompt(["Yes", "No"]));
    await checkUnsatisfiableConditionsWithLoader({
      fileObj: treatment("/etc/passwd", "equals", "Maybe"),
      loadPrompt,
    });
    expect(loadPrompt).not.toHaveBeenCalled();
  });

  it("loads each unique referenced prompt once", async () => {
    const loadPrompt = vi.fn(async () => mcPrompt(["Yes", "No"]));
    await checkUnsatisfiableConditionsWithLoader({
      fileObj: {
        treatments: [
          {
            name: "t",
            gameStages: [
              {
                name: "a",
                elements: [
                  { type: "prompt", name: "q", file: "p.prompt.md" },
                  {
                    type: "submitButton",
                    conditions: [
                      {
                        reference: "self.prompt.q",
                        comparator: "equals",
                        value: "Yes",
                      },
                    ],
                  },
                ],
              },
              {
                name: "b",
                elements: [
                  { type: "display", reference: "self.prompt.q.value" },
                ],
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
