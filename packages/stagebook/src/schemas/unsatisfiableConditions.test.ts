import { describe, test, expect } from "vitest";
import { checkUnsatisfiableConditions } from "./unsatisfiableConditions.js";
import { promptFileSchema, type PromptFileType } from "./promptFile.js";

// --- Prompt-file builders (parsed via the real schema, so the value-domain
//     model under test matches what the runtime actually stores). ---

function parsePrompt(src: string): PromptFileType {
  return promptFileSchema.parse(src);
}

/** Single-select multipleChoice with text options. */
const mcText = (options: string[], select: "single" | "multiple" = "single") =>
  parsePrompt(
    `---\ntype: multipleChoice\nselect: ${select}\n---\nPick\n---\n${options
      .map((o) => `- ${o}`)
      .join("\n")}\n`,
  );

/** Numeric-mode (single-select) multipleChoice: `- <n>: <label>`. */
const mcNumeric = (points: [number, string][]) =>
  parsePrompt(
    `---\ntype: multipleChoice\n---\nPick\n---\n${points
      .map(([p, label]) => `- ${p}: ${label}`)
      .join("\n")}\n`,
  );

const slider = (min: number, max: number, points: number[]) =>
  parsePrompt(
    `---\ntype: slider\nmin: ${min}\nmax: ${max}\ninterval: 1\n---\nRate\n---\n${points
      .map((p) => `- ${p}: L${p}`)
      .join("\n")}\n`,
  );

const openResponse = (opts: { minLength?: number; maxLength?: number } = {}) =>
  parsePrompt(
    `---\ntype: openResponse\n${
      opts.minLength !== undefined ? `minLength: ${opts.minLength}\n` : ""
    }${
      opts.maxLength !== undefined ? `maxLength: ${opts.maxLength}\n` : ""
    }---\nWrite\n---\n> placeholder\n`,
  );

const dropdown = (options: string[]) =>
  parsePrompt(
    `---\ntype: dropdown\n---\nPick\n---\n${options
      .map((o) => `- ${o}`)
      .join("\n")}\n`,
  );

// --- Treatment-file builder: one prompt element + one gate element that
//     carries the condition under test. ---

interface Leaf {
  reference: unknown;
  comparator: string;
  value?: unknown;
}

function fileWith(
  condition: unknown,
  {
    promptName = "q",
    promptFile = "q.prompt.md",
    gate = "submitButton",
  }: { promptName?: string; promptFile?: string; gate?: string } = {},
) {
  return {
    treatments: [
      {
        name: "t",
        gameStages: [
          {
            name: "s",
            elements: [
              { type: "prompt", name: promptName, file: promptFile },
              { type: gate, conditions: condition },
            ],
          },
        ],
      },
    ],
  };
}

const domains = (entries: Record<string, PromptFileType>) =>
  new Map(Object.entries(entries));

const leaf = (comparator: string, value: unknown, name = "q"): Leaf => ({
  reference: `self.prompt.${name}`,
  comparator,
  value,
});

describe("checkUnsatisfiableConditions", () => {
  describe("provably-dead gates (flagged)", () => {
    test("flags `includes` whose value is a substring of no option (issue #480 example)", () => {
      const opts = [
        "To identify the core of your disagreement",
        "To convince your partner to adopt your perspective",
        "To understand your partner's perspective",
        "To explore possible ways forward that you both could live with",
      ];
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("includes", "joint solution")]),
        domains({ "q.prompt.md": mcText(opts) }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].reference).toBe("self.prompt.q");
      expect(issues[0].message).toContain("joint solution");
      expect(issues[0].message.toLowerCase()).toContain("never");
    });

    test("flags a dead condition on an arbitrary element (not just submitButton)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("includes", "similarities")], { gate: "display" }),
        domains({ "q.prompt.md": mcText(["look for 3 unexpected things"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags `equals` when the value matches no option", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Maybe")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags an out-of-domain numeric `equals` on a numeric multipleChoice", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 99)]),
        domains({
          "q.prompt.md": mcNumeric([
            [1, "Low"],
            [5, "High"],
          ]),
        }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags `isAtLeast` above every slider snap point", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isAtLeast", 200)]),
        domains({ "q.prompt.md": slider(0, 100, [0, 50, 100]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags `isOneOf` when no option is in the target set", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isOneOf", ["Maybe", "Dunno"])]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags `hasLengthAtLeast` when every option label is shorter", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtLeast", 100)]),
        domains({ "q.prompt.md": mcText(["ab", "cd"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags openResponse `hasLengthAtLeast` beyond maxLength", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtLeast", 50)]),
        domains({ "q.prompt.md": openResponse({ maxLength: 40 }) }),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toContain("40");
    });

    test("flags a dead leaf nested inside an `all:` operator", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith({ all: [leaf("equals", "Nope")] }),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags a dead condition on a dropdown", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Purple")]),
        domains({ "q.prompt.md": dropdown(["Red", "Green"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags out-of-range slider bounds (isBelow / isAbove / isAtMost)", () => {
      const cases: [string, number][] = [
        ["isBelow", -5],
        ["isAbove", 500],
        ["isAtMost", -5],
      ];
      for (const [cmp, value] of cases) {
        const issues = checkUnsatisfiableConditions(
          fileWith([leaf(cmp, value)]),
          domains({ "q.prompt.md": slider(0, 100, [0, 50, 100]) }),
        );
        expect(issues, cmp).toHaveLength(1);
      }
    });

    test("flags slider `equals` fully outside the [min, max] range", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 999)]),
        domains({ "q.prompt.md": slider(0, 100, [0, 50, 100]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags slider `isOneOf` when every target is outside the range", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isOneOf", [999, 1000])]),
        domains({ "q.prompt.md": slider(0, 100, [0, 100]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags numeric `equals` against numeric-mode points (labels are not `.value`s)", () => {
      // Numeric-mode multipleChoice stores the point in `.value`; the label is
      // separate. A label that happens to be a numeric string must not suppress
      // a dead gate for a point that doesn't exist.
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 3)]),
        domains({
          "q.prompt.md": mcNumeric([
            [1, "3"],
            [5, "7"],
          ]),
        }),
      );
      expect(issues).toHaveLength(1);
    });

    test("flags numeric `equals` against text labels without coercing them", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 3)]),
        domains({ "q.prompt.md": mcText(["1", "2"]) }),
      );
      expect(issues).toHaveLength(1);
    });
  });

  describe("satisfiable gates (silent)", () => {
    test("passes `includes` when a substring of some option matches", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("includes", "understand")]),
        domains({
          "q.prompt.md": mcText([
            "To understand your partner's perspective",
            "Something else",
          ]),
        }),
      );
      expect(issues).toEqual([]);
    });

    test("passes `equals` when the value matches an option", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Yes")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("passes numeric `equals` on a valid point", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 5)]),
        domains({
          "q.prompt.md": mcNumeric([
            [1, "Low"],
            [5, "High"],
          ]),
        }),
      );
      expect(issues).toEqual([]);
    });

    test("passes slider `isAtLeast` within range", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isAtLeast", 50)]),
        domains({ "q.prompt.md": slider(0, 100, [0, 50, 100]) }),
      );
      expect(issues).toEqual([]);
    });

    test("passes slider `equals` on an in-range but UNLABELED snap point", () => {
      // Labels only the endpoints, but 50 is a reachable snap point
      // (min + k*interval). Must not be flagged as dead. (Regression: #498)
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 50)]),
        domains({ "q.prompt.md": slider(0, 100, [0, 100]) }),
      );
      expect(issues).toEqual([]);
    });

    test("passes slider `isOneOf` when one target is in range", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isOneOf", [50, 999])]),
        domains({ "q.prompt.md": slider(0, 100, [0, 100]) }),
      );
      expect(issues).toEqual([]);
    });

    test("passes openResponse `hasLengthAtLeast` within maxLength", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtLeast", 20)]),
        domains({ "q.prompt.md": openResponse({ maxLength: 100 }) }),
      );
      expect(issues).toEqual([]);
    });

    test("passes `hasLengthAtLeast` when some option label is long enough", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtLeast", 3)]),
        domains({ "q.prompt.md": mcText(["ab", "cde"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("numeric `equals` cannot match a small-integer text label", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", 2)]),
        domains({ "q.prompt.md": mcText(["1", "2"]) }),
      );
      expect(issues).toHaveLength(1);
    });
  });

  describe("stays silent when it cannot prove deadness", () => {
    test("skips negative comparators (satisfiable via the undefined initial state)", () => {
      for (const cmp of [
        "doesNotEqual",
        "doesNotInclude",
        "doesNotMatch",
        "isNotOneOf",
      ]) {
        const value = cmp === "isNotOneOf" ? ["Nope"] : "Nope";
        const issues = checkUnsatisfiableConditions(
          fileWith([leaf(cmp, value)]),
          domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
        );
        expect(issues, cmp).toEqual([]);
      }
    });

    test("skips exists / doesNotExist", () => {
      for (const cmp of ["exists", "doesNotExist"]) {
        const issues = checkUnsatisfiableConditions(
          fileWith([{ reference: "self.prompt.q", comparator: cmp }]),
          domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
        );
        expect(issues, cmp).toEqual([]);
      }
    });

    test("strict numeric comparators cannot match text options", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("isAtLeast", 5)]),
        domains({ "q.prompt.md": mcText(["Low", "Medium", "High"]) }),
      );
      expect(issues).toHaveLength(1);
    });

    test("skips openResponse value comparators (free text is not disprovable)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "anything")]),
        domains({ "q.prompt.md": openResponse({ maxLength: 4 }) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips openResponse hasLengthAtLeast when maxLength is unset", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtLeast", 5000)]),
        domains({ "q.prompt.md": openResponse({}) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips openResponse hasLengthAtMost even when below minLength (minLength doesn't block saving short values)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("hasLengthAtMost", 5)]),
        domains({ "q.prompt.md": openResponse({ minLength: 10 }) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips `matches` entirely (not evaluated, to avoid ReDoS at validation time)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("matches", "^bird$")]),
        domains({ "q.prompt.md": mcText(["cat", "dog"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips a dead leaf inside `any:` (a live sibling can carry the gate)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith({ any: [leaf("equals", "Nope"), leaf("equals", "Yes")] }),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips a dead leaf inside `none:` (a false child makes the gate always fire)", () => {
      // `none:` is satisfied when its children are false; an always-false child
      // makes the gate trivially satisfiable, so flagging it "can never be
      // true" would be a false positive.
      const issues = checkUnsatisfiableConditions(
        fileWith({ none: [leaf("equals", "OldName")] }),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips listSorter and noResponse prompts", () => {
      const listSorter = parsePrompt(
        "---\ntype: listSorter\n---\nSort\n---\n- A\n- B\n",
      );
      const noResponse = parsePrompt("---\ntype: noResponse\n---\nJust text\n");
      for (const parsed of [listSorter, noResponse]) {
        const issues = checkUnsatisfiableConditions(
          fileWith([leaf("equals", "Z")]),
          domains({ "q.prompt.md": parsed }),
        );
        expect(issues, parsed.metadata.type).toEqual([]);
      }
    });

    test("skips multi-select multipleChoice (array storage, v1 non-goal)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("includes", "nope")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"], "multiple") }),
      );
      expect(issues).toEqual([]);
    });

    test("skips when the referenced prompt name is unknown", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Maybe", "other")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips when the same name maps to two different files (ambiguous)", () => {
      const fileObj = {
        treatments: [
          {
            name: "t",
            gameStages: [
              {
                name: "s1",
                elements: [
                  { type: "prompt", name: "q", file: "en.prompt.md" },
                  { type: "submitButton", conditions: [leaf("equals", "X")] },
                ],
              },
            ],
            exitSequence: [
              {
                name: "e",
                elements: [{ type: "prompt", name: "q", file: "he.prompt.md" }],
              },
            ],
          },
        ],
      };
      const issues = checkUnsatisfiableConditions(
        fileObj,
        domains({
          "en.prompt.md": mcText(["Yes", "No"]),
          "he.prompt.md": mcText(["Ken", "Lo"]),
        }),
      );
      expect(issues).toEqual([]);
    });

    test("skips when the prompt file is not in the domain map (unreadable)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Maybe")]),
        domains({}),
      );
      expect(issues).toEqual([]);
    });

    test("skips when the value carries an unresolved ${...} placeholder", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "${answer}")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips references that don't read the answer value (custom path)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([
          {
            reference: {
              position: "self",
              source: "prompt",
              name: "q",
              path: ["meta"],
            },
            comparator: "equals",
            value: "Maybe",
          },
        ]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });

    test("skips non-prompt references (qualtrics, entryUrl, …)", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([
          {
            reference: "self.qualtrics.s.value",
            comparator: "equals",
            value: "X",
          },
        ]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues).toEqual([]);
    });
  });

  describe("condition-site coverage (walker)", () => {
    const deadLeaf = [leaf("equals", "Nope")];
    const yes = { "q.prompt.md": mcText(["Yes", "No"]) };
    const prompt = { type: "prompt", name: "q", file: "q.prompt.md" };

    test("flags a stage-level condition", () => {
      const fileObj = {
        treatments: [
          {
            name: "t",
            gameStages: [
              { name: "s", conditions: deadLeaf, elements: [prompt] },
            ],
          },
        ],
      };
      expect(checkUnsatisfiableConditions(fileObj, domains(yes))).toHaveLength(
        1,
      );
    });

    test("flags a discussion condition", () => {
      const fileObj = {
        treatments: [
          {
            name: "t",
            gameStages: [
              {
                name: "s",
                discussion: { conditions: deadLeaf },
                elements: [prompt],
              },
            ],
          },
        ],
      };
      expect(checkUnsatisfiableConditions(fileObj, domains(yes))).toHaveLength(
        1,
      );
    });

    test("flags an exit-step element condition", () => {
      const fileObj = {
        treatments: [
          {
            name: "t",
            gameStages: [{ name: "g", elements: [prompt] }],
            exitSequence: [
              {
                name: "e",
                elements: [{ type: "submitButton", conditions: deadLeaf }],
              },
            ],
          },
        ],
      };
      expect(checkUnsatisfiableConditions(fileObj, domains(yes))).toHaveLength(
        1,
      );
    });

    test("flags an intro-step element condition", () => {
      const fileObj = {
        introSequences: [
          {
            name: "i",
            introSteps: [
              {
                name: "s",
                elements: [
                  prompt,
                  { type: "submitButton", conditions: deadLeaf },
                ],
              },
            ],
          },
        ],
      };
      expect(checkUnsatisfiableConditions(fileObj, domains(yes))).toHaveLength(
        1,
      );
    });
  });

  describe("path reporting", () => {
    test("points the issue path at the whole dead condition root", () => {
      const issues = checkUnsatisfiableConditions(
        fileWith([leaf("equals", "Maybe")]),
        domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
      );
      expect(issues[0].path).toEqual([
        "treatments",
        0,
        "gameStages",
        0,
        "elements",
        1,
        "conditions",
      ]);
    });
  });

  test("returns [] for a non-object fileObj", () => {
    expect(checkUnsatisfiableConditions(null, domains({}))).toEqual([]);
    expect(checkUnsatisfiableConditions("nope", domains({}))).toEqual([]);
  });
});

test("self.prompt.x.isValid equals true is not a dead value gate (#668)", () => {
  const file = fileWith(
    [{ reference: "self.prompt.x.isValid", comparator: "equals", value: true }],
    { promptName: "x" },
  );
  expect(
    checkUnsatisfiableConditions(
      file,
      domains({ "q.prompt.md": mcText(["Yes", "No"]) }),
    ),
  ).toEqual([]);
});

describe("numericResponse has advisory bounds, not a bounded stored domain (#687)", () => {
  test.each(["self", "shared"])(
    "does not flag %s value above the declared maximum",
    (position) => {
      const file = fileWith([
        {
          reference: `${position}.prompt.q.value`,
          comparator: "isAbove",
          value: 99,
        },
      ]);
      const parsed = parsePrompt(
        "---\ntype: numericResponse\nmax: 99\n---\nNumber\n",
      );
      expect(
        checkUnsatisfiableConditions(file, new Map([["q.prompt.md", parsed]])),
      ).toEqual([]);
    },
  );
});

describe("whole expression reachability (#690)", () => {
  const choiceDomains = domains({ "q.prompt.md": mcText(["Yes", "No"]) });
  const q = { reference: "self.prompt.q.value" };

  test("reports one root when every nested any branch is dead", () => {
    const conditions = {
      any: [leaf("equals", "Maybe"), { all: [leaf("equals", "Never")] }],
    };
    const issues = checkUnsatisfiableConditions(
      fileWith(conditions),
      choiceDomains,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path.at(-1)).toBe("conditions");
  });

  test.each([
    { strictlyIncreasing: [0, { countTrue: [leaf("equals", "Maybe")] }] },
    { allEqual: [{ sum: [q, 1] }, 99] },
    {
      case: {
        rules: [
          { when: leaf("equals", 1), value: false },
          { default: true, value: false },
        ],
      },
    },
    { allEqual: [{ divide: { numerator: 6, denominator: 2 } }, 4] },
  ])("evaluates full calculation/count/case trees: %j", (conditions) => {
    expect(
      checkUnsatisfiableConditions(
        fileWith(conditions),
        domains({
          "q.prompt.md": mcNumeric([
            [1, "Low"],
            [5, "High"],
          ]),
        }),
      ),
    ).toHaveLength(1);
  });

  test("the unanswered state can make a negative leaf reachable", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith(leaf("doesNotEqual", "Yes")),
        domains({ "q.prompt.md": mcText(["Yes"]) }),
      ),
    ).toEqual([]);
  });

  test("repeated references share one assignment rather than independent values", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({ all: [leaf("equals", "Yes"), leaf("equals", "No")] }),
        choiceDomains,
      ),
    ).toHaveLength(1);
  });

  test("blank prompt options normalize to Missing through readReference", () => {
    const parsed = mcText(["Yes"]);
    parsed.responseItems = [" ", ""];
    expect(
      checkUnsatisfiableConditions(
        fileWith({ reference: "self.prompt.q", comparator: "exists" }),
        domains({ "q.prompt.md": parsed }),
      ),
    ).toHaveLength(1);
  });

  test("unknown branches cannot prove an any root dead", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({
          any: [
            leaf("equals", "Maybe"),
            { reference: "self.attributes.ready" },
          ],
        }),
        choiceDomains,
      ),
    ).toEqual([]);
  });

  test("a dead all branch proves the root dead despite an unknown sibling", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({
          all: [
            { reference: "self.attributes.ready" },
            leaf("equals", "Maybe"),
          ],
        }),
        choiceDomains,
      ),
    ).toHaveLength(1);
  });

  test("analytic slider proofs compose through Boolean context", () => {
    const parsed = domains({ "q.prompt.md": slider(0, 100, [0, 100]) });
    const dead = leaf("isAbove", 200);
    expect(
      checkUnsatisfiableConditions(fileWith({ any: [dead, false] }), parsed),
    ).toHaveLength(1);
    expect(
      checkUnsatisfiableConditions(fileWith({ none: [dead] }), parsed),
    ).toEqual([]);
  });

  test("regex anywhere leaves the root unproven without executing author patterns", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({
          all: [false, { matches: { string: "a", patterns: ["a"] } }],
        }),
        choiceDomains,
      ),
    ).toEqual([]);
  });

  test("a known group reference remains unproven without a finite roster domain", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({
          any: [
            {
              reference: "everyone.prompt.q",
              comparator: "equals",
              value: "Maybe",
            },
          ],
        }),
        choiceDomains,
      ),
    ).toEqual([]);
  });

  test("prompt producers are scoped per treatment", () => {
    const first = fileWith(leaf("equals", "Yes"), { promptFile: "a.prompt.md" })
      .treatments[0];
    const second = fileWith(leaf("equals", "Yes"), {
      promptFile: "b.prompt.md",
    }).treatments[0];
    const issues = checkUnsatisfiableConditions(
      { treatments: [first, second] },
      domains({
        "a.prompt.md": mcText(["Yes"]),
        "b.prompt.md": mcText(["No"]),
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path.slice(0, 2)).toEqual(["treatments", 1]);
  });

  test("only compatible intro producers contribute to a treatment", () => {
    const file = {
      treatments: [
        {
          compatibleIntroSequences: ["chosen"],
          gameStages: [{ conditions: leaf("equals", "Yes") }],
        },
      ],
      introSequences: [
        {
          name: "chosen",
          introSteps: [
            { elements: [{ type: "prompt", name: "q", file: "no.prompt.md" }] },
          ],
        },
        {
          name: "other",
          introSteps: [
            {
              elements: [{ type: "prompt", name: "q", file: "yes.prompt.md" }],
            },
          ],
        },
      ],
    };
    expect(
      checkUnsatisfiableConditions(
        file,
        domains({
          "no.prompt.md": mcText(["No"]),
          "yes.prompt.md": mcText(["Yes"]),
        }),
      ),
    ).toHaveLength(1);
  });

  test("shared references do not borrow private prompt domains", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({
          reference: "shared.prompt.q",
          comparator: "equals",
          value: "Maybe",
        }),
        choiceDomains,
      ),
    ).toEqual([]);
  });

  test("shared and private producers with the same name keep separate domains", () => {
    const file = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "prompt", name: "q", file: "private.prompt.md" },
                {
                  type: "prompt",
                  name: "q",
                  file: "shared.prompt.md",
                  shared: true,
                },
                {
                  conditions: {
                    reference: "shared.prompt.q",
                    comparator: "equals",
                    value: "Yes",
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    expect(
      checkUnsatisfiableConditions(
        file,
        domains({
          "private.prompt.md": mcText(["Yes"]),
          "shared.prompt.md": mcText(["No"]),
        }),
      ),
    ).toHaveLength(1);
  });

  test("skips an oversized Cartesian domain instead of sampling it", () => {
    const parsed = mcNumeric(
      Array.from({ length: 64 }, (_, value) => [value, String(value)]),
    );
    const file = fileWith({
      allEqual: [{ sum: [q, { reference: "self.prompt.r" }] }, 999],
    });
    file.treatments[0].gameStages[0].elements.push({
      type: "prompt",
      name: "r",
      file: "q.prompt.md",
    });
    expect(
      checkUnsatisfiableConditions(file, domains({ "q.prompt.md": parsed })),
    ).toEqual([]);
  });

  test("does not mistake an unresolved nested template for Missing", () => {
    expect(
      checkUnsatisfiableConditions(
        fileWith({ any: [false, { template: "later", fields: {} }] }),
        choiceDomains,
      ),
    ).toEqual([]);
  });

  test("bounds shared syntax DAGs before walking or evaluating", () => {
    let conditions: unknown = false;
    for (let index = 0; index < 14; index++)
      conditions = { all: [conditions, conditions] };
    expect(
      checkUnsatisfiableConditions(fileWith(conditions), choiceDomains),
    ).toEqual([]);
  });

  test("openResponse length proofs retain their enclosing none semantics", () => {
    const parsed = domains({ "q.prompt.md": openResponse({ maxLength: 40 }) });
    const dead = leaf("hasLengthAtLeast", 50);
    expect(
      checkUnsatisfiableConditions(fileWith({ any: [dead, false] }), parsed),
    ).toHaveLength(1);
    expect(
      checkUnsatisfiableConditions(fileWith({ none: [dead] }), parsed),
    ).toEqual([]);
  });
});
