import { describe, expect, test } from "vitest";
import { checkSharedPromptValidation } from "./sharedPromptValidation.js";
import { referenceSchema } from "./reference.js";

const shared = { type: "prompt", file: "q.prompt.md", shared: true };
const study = (element: unknown = shared) => ({
  treatments: [{ name: "t", gameStages: [{ name: "s", elements: [element] }] }],
});

describe("shared prompt constraints (#668)", () => {
  test.each([{ required: true }, { minLength: 0 }, { maxLength: 10 }])(
    "rejects declared %j",
    (constraints) => {
      const issues = checkSharedPromptValidation(
        study(),
        new Map([["q.prompt.md", { type: "openResponse", ...constraints }]]),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        promptFile: "q.prompt.md",
        path: ["treatments", 0, "gameStages", 0, "elements", 0, "file"],
      });
      expect(issues[0].message).toContain("shared");
      expect(issues[0].message).toContain(Object.keys(constraints)[0]);
    },
  );
  test("covers shared prompts other than openResponse", () => {
    expect(
      checkSharedPromptValidation(
        study(),
        new Map([["q.prompt.md", { type: "multipleChoice", required: true }]]),
      ),
    ).toHaveLength(1);
  });
  test.each([
    { type: "openResponse" },
    { type: "openResponse", required: false },
    { type: "multipleChoice", required: false },
  ])("allows unconstrained %j", (metadata) => {
    expect(
      checkSharedPromptValidation(
        study(),
        new Map([["q.prompt.md", metadata]]),
      ),
    ).toEqual([]);
  });
  test("allows player constraints and skips unreadable files", () => {
    const constraints = new Map([
      ["q.prompt.md", { required: true, minLength: 50 }],
    ]);
    expect(
      checkSharedPromptValidation(
        study({ ...shared, shared: false }),
        constraints,
      ),
    ).toEqual([]);
    expect(
      checkSharedPromptValidation(
        study({ type: "prompt", file: "q.prompt.md" }),
        constraints,
      ),
    ).toEqual([]);
    expect(checkSharedPromptValidation(study(), new Map())).toEqual([]);
    expect(checkSharedPromptValidation(null, constraints)).toEqual([]);
  });
  test("walks game, exit, intro and consent prompts but not uninstantiated templates", () => {
    const steps = [{ name: "s", elements: [shared] }];
    const file = {
      treatments: [{ name: "t", gameStages: steps, exitSequence: steps }],
      introSequences: [{ name: "i", introSteps: steps }],
      consent: [{ name: "c", steps }],
      templates: [{ content: shared }],
    };
    const issues = checkSharedPromptValidation(
      file,
      new Map([["q.prompt.md", { required: true }]]),
    );
    expect(issues.map((issue) => issue.path)).toEqual([
      ["treatments", 0, "gameStages", 0, "elements", 0, "file"],
      ["treatments", 0, "exitSequence", 0, "elements", 0, "file"],
      ["introSequences", 0, "introSteps", 0, "elements", 0, "file"],
      ["consent", 0, "steps", 0, "elements", 0, "file"],
    ]);
  });
});

describe("shared validity references (#668)", () => {
  test.each([
    "shared.prompt.q.isValid",
    { position: "shared", source: "prompt", name: "q", path: ["isValid"] },
  ])("rejects %j", (reference) => {
    const parsed = referenceSchema.safeParse(reference);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(JSON.stringify(parsed.error.issues)).toContain("isValid");
  });
  test.each([
    "self.prompt.q.isValid",
    "0.prompt.q.isValid",
    "shared.prompt.q.value",
    "shared.qualtrics.q.isValid",
  ])("allows %s", (reference) => {
    expect(referenceSchema.safeParse(reference).success).toBe(true);
  });
});
