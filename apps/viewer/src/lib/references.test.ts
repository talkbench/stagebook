import { describe, it, expect } from "vitest";
import { extractStageReferences } from "./references";

describe("extractStageReferences", () => {
  it("extracts condition references from elements", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "q2",
        file: "prompts/q2.prompt.md",
        conditions: [
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toContain("self.prompt.q1");
  });

  it("extracts display element references", () => {
    const elements = [
      {
        type: "display" as const,
        name: "showVote",
        reference: "0.prompt.vote",
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toContain("0.prompt.vote");
  });

  it("extracts multiple references and deduplicates", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "q2",
        file: "prompts/q2.prompt.md",
        conditions: [
          { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
          { reference: "self.prompt.q1", comparator: "equals", value: "no" },
          {
            reference: "self.survey.TIPI.result.score",
            comparator: "isAbove",
            value: 3,
          },
        ],
      },
      {
        type: "display" as const,
        name: "d1",
        reference: "self.prompt.q1",
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual(["self.prompt.q1", "self.survey.TIPI.result.score"]);
  });

  it("returns empty array for elements with no references", () => {
    const elements = [
      { type: "submitButton" as const, buttonText: "Next" },
      {
        type: "prompt" as const,
        name: "q1",
        file: "prompts/q1.prompt.md",
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual([]);
  });

  // -- Boolean-tree conditions (post-#235) --

  it("extracts references from `all:` operator nodes", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "p",
        file: "p.prompt.md",
        conditions: [
          {
            all: [
              {
                reference: "0.prompt.continue_with_partner",
                comparator: "equals",
                value: "Yes",
              },
              {
                reference: "1.prompt.continue_with_partner",
                comparator: "equals",
                value: "Yes",
              },
            ],
          },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual([
      "0.prompt.continue_with_partner",
      "1.prompt.continue_with_partner",
    ]);
  });

  it("extracts references from `any:` operator nodes", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "p",
        file: "p.prompt.md",
        conditions: [
          {
            any: [
              {
                reference: "0.prompt.x",
                comparator: "doesNotEqual",
                value: "Yes",
              },
              { reference: "1.prompt.x", comparator: "doesNotExist" },
            ],
          },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual(["0.prompt.x", "1.prompt.x"]);
  });

  it("extracts references from `none:` operator nodes", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "p",
        file: "p.prompt.md",
        conditions: [
          {
            none: [{ reference: "shared.survey.tipi", comparator: "exists" }],
          },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual(["shared.survey.tipi"]);
  });

  it("extracts references from nested operator trees", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "p",
        file: "p.prompt.md",
        conditions: [
          {
            all: [
              { reference: "0.prompt.a", comparator: "equals", value: "y" },
              {
                any: [
                  { reference: "1.prompt.b", comparator: "exists" },
                  {
                    none: [
                      { reference: "shared.prompt.c", comparator: "exists" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual(["0.prompt.a", "1.prompt.b", "shared.prompt.c"]);
  });

  it("deduplicates across operator children and sibling leaves", () => {
    const elements = [
      {
        type: "prompt" as const,
        name: "p",
        file: "p.prompt.md",
        conditions: [
          { reference: "self.prompt.q1", comparator: "equals", value: "y" },
          {
            all: [
              {
                reference: "self.prompt.q1",
                comparator: "doesNotEqual",
                value: "n",
              },
              { reference: "0.prompt.q2", comparator: "exists" },
            ],
          },
        ],
      },
    ];
    const refs = extractStageReferences(elements);
    expect(refs).toEqual(["self.prompt.q1", "0.prompt.q2"]);
  });
});
