import { describe, expect, test } from "vitest";
import { promptFileSchema } from "./promptFile.js";
import { checkExpressionTypes } from "./expressionTypes.js";

const textPrompt = promptFileSchema.parse(
  "---\ntype: openResponse\n---\nAnswer.\n---\n> Your answer",
);
const numberPrompt = promptFileSchema.parse(
  "---\ntype: numericResponse\n---\nAnswer.",
);
const prompts = new Map([
  ["text.prompt.md", textPrompt],
  ["number.prompt.md", numberPrompt],
  ["other-number.prompt.md", numberPrompt],
]);
const producer = (file: string, shared = false) => ({
  type: "prompt",
  name: "answer",
  file,
  shared,
});
const leaf = (reference = "self.prompt.answer.value", value: unknown = 2) => ({
  reference,
  comparator: "equals",
  value,
});
const treatment = (file: string, conditions: unknown = leaf()) => ({
  name: file,
  gameStages: [
    {
      name: "s",
      elements: [producer(file), { type: "submitButton", conditions }],
    },
  ],
});
const errors = (file: unknown) =>
  checkExpressionTypes(file, prompts).filter(
    (issue) => issue.severity === "error",
  );

describe("per-treatment expression typing", () => {
  test("A4 rejects text against number and number against text", () => {
    const issues = errors({
      treatments: [
        treatment("text.prompt.md"),
        treatment("number.prompt.md", leaf(undefined, "2")),
      ],
    });
    expect(issues).toHaveLength(2);
    expect(issues[0].path.slice(0, 2)).toEqual(["treatments", 0]);
    expect(issues[1].path.slice(0, 2)).toEqual(["treatments", 1]);
    expect(issues[0].message).toContain(
      "conditions.md#prompts-that-save-numbers",
    );
  });
  test("does not conflate producers in separate treatments", () => {
    expect(
      checkExpressionTypes(
        {
          treatments: [
            treatment("number.prompt.md"),
            treatment("text.prompt.md", leaf(undefined, "2")),
          ],
        },
        prompts,
      ),
    ).toEqual([]);
  });
  test("same-type producers in one treatment remain known", () => {
    const t = treatment("number.prompt.md");
    t.gameStages[0].elements.push(producer("other-number.prompt.md"));
    expect(checkExpressionTypes({ treatments: [t] }, prompts)).toEqual([]);
  });
  test("disagreeing producers warn instead of choosing a type", () => {
    const t = treatment("number.prompt.md");
    t.gameStages[0].elements.push(producer("text.prompt.md"));
    const issues = checkExpressionTypes({ treatments: [t] }, prompts);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "warning",
      reason: "disagreeingProducers",
    });
  });
  test("warns with a named unreadable-prompt reason", () => {
    const issues = checkExpressionTypes(
      { treatments: [treatment("unreadable.prompt.md")] },
      prompts,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: "warning",
      reason: "unreadablePrompt",
    });
    expect(issues[0].message).toContain("unreadable.prompt.md");
  });
  test("warns about untyped sources and prompt fields without making them errors", () => {
    const t = treatment("number.prompt.md", {
      all: [
        leaf("self.attributes.custom", "x"),
        leaf("self.prompt.answer.isValid", true),
      ],
    });
    const issues = checkExpressionTypes({ treatments: [t] }, prompts);
    expect(issues.map((issue) => issue.reason)).toEqual([
      "unknownHostField",
      "unknownPromptField",
    ]);
    expect(issues.every((issue) => issue.severity === "warning")).toBe(true);
  });
  test("shared and player producers are separate stores", () => {
    const t = treatment("text.prompt.md", leaf("shared.prompt.answer", 2));
    t.gameStages[0].elements.push(producer("number.prompt.md", true));
    expect(checkExpressionTypes({ treatments: [t] }, prompts)).toEqual([]);
  });
  test("group leaves use the per-seat prompt type", () => {
    const good = { all: leaf("everyone.prompt.answer", 2) };
    const bad = { all: leaf("everyone.prompt.answer", "2") };
    expect(
      errors({ treatments: [treatment("number.prompt.md", good)] }),
    ).toEqual([]);
    expect(
      errors({ treatments: [treatment("number.prompt.md", bad)] }),
    ).toHaveLength(1);
  });
  test("checks reference types inside numeric operators", () => {
    const gate = {
      nonDecreasing: [0, { sum: [{ reference: "self.prompt.answer" }, 1] }],
    };
    expect(
      errors({ treatments: [treatment("text.prompt.md", gate)] }),
    ).toHaveLength(1);
  });
  test("ignores literal payloads that resemble references", () => {
    expect(
      checkExpressionTypes(
        {
          treatments: [
            treatment("number.prompt.md", {
              allEqual: [
                { literal: ["reference", "self.attributes.custom"] },
                { literal: ["reference", "self.attributes.custom"] },
              ],
            }),
          ],
        },
        prompts,
      ),
    ).toEqual([]);
  });
});

describe("declared host reference types", () => {
  const check = (conditions: unknown) =>
    checkExpressionTypes(
      { treatments: [treatment("number.prompt.md", conditions)] },
      prompts,
    );

  test.each([
    ["self.attributes.isKnownVpn", true],
    ["self.attributes.screenWidth", 1024],
    ["self.entryUrl.params.condition", "2"],
    ["self.submitButton.next.time", 100],
    ["self.timeline.selection.length", 2],
    ["self.timeline.selection.0.start", 4],
    ["self.timeline.selection.0.time", 4],
    ["self.trackedLink.link.totalTimeAwaySeconds", 3],
    ["self.trackedLink.link.events.0.timestamp", 4],
    ["self.trackedLink.link.lastEventType", "click"],
  ])("reads the declared type of %s without a warning", (reference, value) => {
    expect(check(leaf(reference, value))).toEqual([]);
  });

  test.each([
    ["self.attributes.isKnownVpn", 1],
    ["self.submitButton.next.time", "100"],
    ["self.timeline.selection.length", "2"],
    ["self.timeline.selection.0.start", "4"],
    ["self.trackedLink.link.totalTimeAwaySeconds", "3"],
  ])("rejects a known host type mismatch at %s", (reference, value) => {
    const issues = check(leaf(reference, value));
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
    expect(issues.some((issue) => issue.severity === "warning")).toBe(false);
  });

  test("URL parameter strings reject numeric comparison in either operand order", () => {
    const reference = { reference: "self.entryUrl.params.condition" };
    for (const operands of [
      [reference, 2],
      [2, reference],
    ])
      expect(check({ allEqual: operands })).toEqual([
        expect.objectContaining({ severity: "error" }),
      ]);
  });

  test("applies host types to each group leaf", () => {
    expect(
      check({ all: leaf("everyone.attributes.isKnownVpn", true) }),
    ).toEqual([]);
    expect(check({ all: leaf("everyone.attributes.isKnownVpn", 1) })).toEqual([
      expect.objectContaining({ severity: "error" }),
    ]);
  });

  test.each([
    "self.attributes.custom.nested",
    "self.submitButton.next.custom",
    "self.timeline.selection.0.custom",
  ])("keeps passthrough field %s gradual", (reference) => {
    expect(check(leaf(reference, "x"))).toEqual([
      expect.objectContaining({
        severity: "warning",
        reason: "unknownHostField",
      }),
    ]);
  });

  test.each(["self.qualtrics.exit.sessionId", "self.discussion.chat.count"])(
    "warns only when source %s has no schema",
    (reference) => {
      expect(check(leaf(reference, "x"))).toEqual([
        expect.objectContaining({
          severity: "warning",
          reason: "missingSourceSchema",
        }),
      ]);
    },
  );

  test.each([
    "self.attributes.isKnownVpn.value",
    "self.submitButton.next.time.extra",
    "self.timeline.selection.length.extra",
    "self.trackedLink.link.events.0.timestamp.extra",
    "self.entryUrl.params.condition.extra",
    "self.prompt.answer.value.extra",
  ])("rejects an impossible path through %s", (reference) => {
    const issues = check({ reference, comparator: "exists" });
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("path");
  });

  test("allows whole-record presence but rejects records as typed operands", () => {
    const reference = "self.submitButton.next";
    expect(check({ reference, comparator: "exists" })).toEqual([]);
    expect(
      check({ allEqual: [{ reference }, { reference }] }).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
    expect(
      check({ nonDecreasing: [{ reference }, 1] }).some(
        (issue) => issue.severity === "error",
      ),
    ).toBe(true);
  });

  test("still keeps non-value prompt fields gradual", () => {
    expect(check(leaf("self.prompt.answer.isValid", true))).toEqual([
      expect.objectContaining({
        severity: "warning",
        reason: "unknownPromptField",
      }),
    ]);
  });
});

describe("intro, consent, and assignment type scopes", () => {
  const sequence = (name: string, file: string) => ({
    name,
    introSteps: [{ name: "intro", elements: [producer(file)] }],
  });
  test("checks each treatment against only its compatible intros", () => {
    const file = {
      introSequences: [
        sequence("text", "text.prompt.md"),
        sequence("number", "number.prompt.md"),
      ],
      treatments: [
        {
          name: "t",
          compatibleIntroSequences: ["number"],
          gameStages: [{ name: "s", conditions: leaf("0.prompt.answer", 2) }],
        },
      ],
    };
    expect(checkExpressionTypes(file, prompts)).toEqual([]);
    file.treatments[0].compatibleIntroSequences = ["text"];
    expect(errors(file)).toHaveLength(1);
  });
  test("checks groupComposition and intro element gates", () => {
    const file = {
      introSequences: [
        {
          name: "intro",
          introSteps: [
            {
              name: "s",
              elements: [producer("text.prompt.md"), { conditions: leaf() }],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "t",
          compatibleIntroSequences: ["intro"],
          groupComposition: [{ position: 0, conditions: leaf() }],
        },
      ],
    };
    expect(errors(file).map((issue) => issue.path[0])).toEqual([
      "treatments",
      "introSequences",
    ]);
  });
  test("consent arms remain isolated from treatment and intro producers", () => {
    const file = {
      treatments: [treatment("number.prompt.md")],
      consent: [
        {
          name: "consent",
          steps: [
            { elements: [producer("text.prompt.md"), { conditions: leaf() }] },
          ],
        },
      ],
    };
    expect(errors(file)).toHaveLength(1);
    expect(errors(file)[0].path[0]).toBe("consent");
  });
  test("does not type-check unused template bodies as concrete treatments", () => {
    expect(
      checkExpressionTypes(
        {
          templates: [
            { content: { conditions: leaf("self.attributes.custom") } },
          ],
        },
        prompts,
      ),
    ).toEqual([]);
  });
});

describe("expression type traversal resource bounds", () => {
  test("does not emit exponentially many warnings for rejected alias graphs", () => {
    let conditions: unknown = leaf("self.attributes.custom", "x");
    for (let depth = 0; depth < 15; depth++)
      conditions = { all: [conditions, conditions] };
    expect(
      checkExpressionTypes(
        { treatments: [treatment("text.prompt.md", conditions)] },
        prompts,
      ).length,
    ).toBe(0);
  });

  test("does not recurse into a rejected over-depth tree", () => {
    let conditions: unknown = leaf("self.attributes.custom", "x");
    for (let depth = 0; depth < 3000; depth++)
      conditions = { all: [conditions] };
    expect(
      checkExpressionTypes(
        { treatments: [treatment("text.prompt.md", conditions)] },
        prompts,
      ),
    ).toEqual([]);
  });
});
