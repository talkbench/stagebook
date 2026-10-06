import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import {
  detectGrammarUpgrades,
  grammarUpgradeDetectors,
  type GrammarUpgradeOptions,
} from "./grammarUpgradeDetectors.js";
import { createPositionMapper } from "./yamlPositionMap.js";

const leaf = (
  comparator: string,
  value?: unknown,
  reference: unknown = "self.prompt.answer.value",
) => ({
  reference,
  comparator,
  ...(value === undefined ? {} : { value }),
});
const file = (conditions: unknown) => ({
  treatments: [
    { gameStages: [{ elements: [{ type: "submitButton", conditions }] }] },
  ],
});
const conditionPath = [
  "treatments",
  0,
  "gameStages",
  0,
  "elements",
  0,
  "conditions",
];
const hits = (
  conditions: unknown,
  id: string,
  options?: GrammarUpgradeOptions,
) =>
  detectGrammarUpgrades(file(conditions), options).filter(
    (hit) => hit.id === id,
  );

describe("blank-answer upgrades", () => {
  test.each([
    leaf("exists"),
    leaf("doesNotExist"),
    leaf("hasLengthAtMost", 3),
    leaf("hasLengthAtLeast", 0),
    leaf("hasLengthAtLeast", 2),
    leaf("matches", "^ *$"),
    leaf("doesNotMatch", "^ *$"),
    leaf("equals", ""),
    leaf("doesNotEqual", " \t"),
    leaf("isOneOf", ["yes", ""]),
    leaf("isNotOneOf", [null]),
    leaf("equals", []),
  ])("finds a changed prompt blankness comparison: %j", (condition) => {
    expect(hits(condition, "prompt-blank-answers")).toHaveLength(1);
  });
  test.each([
    leaf("equals", "Yes"),
    leaf("exists", undefined, "self.prompt.answer.isValid"),
    leaf("exists", undefined, "self.attributes.stableParticipantId"),
  ])(
    "does not turn every reference into a blankness warning: %j",
    (condition) => {
      expect(hits(condition, "prompt-blank-answers")).toEqual([]);
    },
  );
});

describe("none before answers", () => {
  test("reports the none operator and describes explicitly waiting", () => {
    const [hit] = hits(
      { none: [leaf("equals", "Done")] },
      "none-before-answers",
    );
    expect(hit.path).toEqual(conditionPath);
    expect(hit.message).toMatch(/true before.*answer/i);
    expect(hit.message).toMatch(/exists/);
  });
  test("stage conditions get the early-termination explanation", () => {
    const source = {
      treatments: [
        {
          gameStages: [
            {
              conditions: {
                none: [leaf("equals", "Done", "shared.prompt.answer.value")],
              },
            },
          ],
        },
      ],
    };
    const warnings = detectGrammarUpgrades(source);
    const [hit] = warnings.filter(
      (item) => item.id === "none-stage-termination",
    );
    expect(hit.path).toEqual(["treatments", 0, "gameStages", 0, "conditions"]);
    expect(hit.message).toMatch(/can change.*advanc.*load/i);
    expect(warnings.some((item) => item.id === "none-before-answers")).toBe(
      false,
    );
  });
  test.each([
    "exists",
    "doesNotExist",
    "doesNotEqual",
    "doesNotInclude",
    "doesNotMatch",
    "isNotOneOf",
  ])("%s had no waiting state to remove", (comparator) => {
    expect(
      hits(
        {
          none: [
            leaf(
              comparator,
              comparator.endsWith("Exist") || comparator === "exists"
                ? undefined
                : "Yes",
            ),
          ],
        },
        "none-before-answers",
      ),
    ).toEqual([]);
  });
  test("nested positive leaves are still discovered", () => {
    expect(
      hits({ none: [{ any: [leaf("isAbove", 5)] }] }, "none-before-answers"),
    ).toHaveLength(1);
  });
  test.each([
    { none: [{ none: [leaf("equals", "Done")] }] },
    { all: [false, { none: [leaf("equals", "Done")] }] },
  ])(
    "does not promise that an enclosing stage gate now admits: %j",
    (conditions) => {
      const warnings = detectGrammarUpgrades({
        treatments: [{ gameStages: [{ conditions }] }],
      }).filter((hit) => hit.id === "none-stage-termination");
      expect(warnings.length).toBeGreaterThan(0);
      for (const hit of warnings) {
        expect(hit.message).not.toMatch(/is now true|no longer advances/i);
        expect(hit.message).toMatch(/whole condition|surrounding/i);
      }
    },
  );
});

describe("text normalization and numeric coercion", () => {
  test.each([
    "equals",
    "doesNotEqual",
    "includes",
    "doesNotInclude",
    "isOneOf",
    "isNotOneOf",
  ])("covers positive and negative %s", (comparator) => {
    const value = comparator.endsWith("OneOf") ? ["Yes", "No"] : "Yes";
    const [hit] = hits(
      leaf(comparator, value),
      "text-comparison-normalization",
    );
    expect(hit.message).toMatch(/trim|surrounding spaces/i);
    expect(hit.message).toMatch(/case/i);
  });
  test.each(["matches", "doesNotMatch", "hasLengthAtLeast", "hasLengthAtMost"])(
    "%s still uses raw text",
    (comparator) => {
      expect(
        hits(leaf(comparator, "Yes"), "text-comparison-normalization"),
      ).toEqual([]);
    },
  );
  test.each(["equals", "doesNotEqual"])(
    "%s detects numeric-looking text",
    (comparator) => {
      const [hit] = hits(leaf(comparator, "100.00"), "numeric-text-comparison");
      expect(hit.message).toMatch(/100\.00.*100/);
      expect(hit.path).toEqual([...conditionPath, "value"]);
    },
  );
  test("membership already compared numeric-looking text as text", () => {
    expect(
      hits(leaf("isOneOf", ["100.00"]), "numeric-text-comparison"),
    ).toEqual([]);
  });
  test.each([
    ["string", 4, /text.*number|number.*text/i],
    ["number", "4", /number.*string|string.*number/i],
  ] as const)(
    "known %s reference and %j value are diagnosed",
    (type, value, message) => {
      const [hit] = hits(leaf("equals", value), "strict-comparison-types", {
        referenceType: () => type,
      });
      expect(hit.message).toMatch(message);
      expect(hit.message).toMatch(/validation error/i);
    },
  );
  test("same-type numeric comparisons get no coercion warning with known types", () => {
    expect(
      hits(leaf("equals", 4), "strict-comparison-types", {
        referenceType: () => "number",
      }),
    ).toEqual([]);
  });
  test("unknown list element types do not become invented mismatches", () => {
    expect(
      hits(leaf("equals", ["Yes"]), "strict-comparison-types", {
        referenceType: () => ({ list: "unknown" }),
      }),
    ).toEqual([]);
  });
  test("group leaf types unwrap the seat list before comparison", () => {
    expect(
      hits(
        leaf("equals", 4, "all.prompt.answer.value"),
        "strict-comparison-types",
        {
          referenceType: () => ({ list: "number" }),
        },
      ),
    ).toEqual([]);
  });
  test("untyped numeric literals get conditional guidance, not invented type information", () => {
    const [hit] = hits(leaf("equals", 4), "strict-comparison-types");
    expect(hit.message).toMatch(/if .*text/i);
    expect(hit.message).not.toMatch(/^This reference saves/);
  });
  test("unknown nonnumeric text does not get a generic coercion warning", () => {
    expect(hits(leaf("equals", "Yes"), "strict-comparison-types")).toEqual([]);
  });
  test.each(["${answer}", ["${answer}"]])(
    "unknown template values are reviewed in their definition: %j",
    (value) => {
      const comparator = Array.isArray(value) ? "isOneOf" : "equals";
      const source = {
        templates: [
          { contentType: "condition", content: leaf(comparator, value) },
        ],
      };
      const warnings = detectGrammarUpgrades(source);
      for (const id of [
        "prompt-blank-answers",
        "text-comparison-normalization",
        "strict-comparison-types",
      ]) {
        const hit = warnings.find((warning) => warning.id === id);
        expect(hit, id).toBeDefined();
        expect(hit!.path).toEqual(["templates", 0, "content"]);
        expect(hit!.message).toMatch(/template|placeholder/i);
      }
      expect(
        warnings.some((warning) => warning.id === "numeric-text-comparison"),
      ).toBe(comparator === "equals");
    },
  );
  test("known numeric references need no possible text-normalization warning", () => {
    const warnings = detectGrammarUpgrades(file(leaf("equals", "${answer}")), {
      referenceType: () => "number",
    });
    expect(
      warnings.some((hit) => hit.id === "text-comparison-normalization"),
    ).toBe(false);
    expect(warnings.some((hit) => hit.id === "numeric-text-comparison")).toBe(
      false,
    );
    expect(warnings.some((hit) => hit.id === "strict-comparison-types")).toBe(
      true,
    );
  });
});

describe("regex delimiter repair", () => {
  test.each(["${pattern}", "^${prefix}$", "/word/${flags}"])(
    "reviews unknown template pattern or flags %s at the definition",
    (value) => {
      const [hit] = hits(leaf("matches", value), "regex-delimiter-parsing");
      expect(hit.path).toEqual([...conditionPath, "value"]);
      expect(hit.message).toMatch(/template|placeholder/i);
    },
  );
  test.each(["/yes/i", "/a\\/b/s", "a//b", "/not-closed"])(
    "detects %s without running its pattern",
    (value) => {
      expect(
        hits(leaf("matches", value), "regex-delimiter-parsing"),
      ).toHaveLength(1);
      expect(
        hits(leaf("doesNotMatch", value), "regex-delimiter-parsing"),
      ).toHaveLength(1);
    },
  );
  test.each(["yes", "/yes/", "a/b", "//"])(
    "leaves equivalent %s alone",
    (value) => {
      expect(hits(leaf("matches", value), "regex-delimiter-parsing")).toEqual(
        [],
      );
    },
  );
});

describe("all to everyone guidance", () => {
  test.each([
    ["exists", undefined, /any:/],
    ["doesNotExist", undefined, /all:.*meaning.*missing/is],
    ["doesNotEqual", "No", /all:.*meaning.*missing/is],
    ["equals", "Yes", /all:.*stricter.*every seat/is],
    ["includes", "Yes", /each answer/i],
    ["hasLengthAtMost", 3, /each answer/i],
  ])("%s has a comparator-specific migration", (comparator, value, message) => {
    const [hit] = hits(
      leaf(comparator as string, value, "all.prompt.answer.value"),
      "everyone-reference",
    );
    expect(hit.path).toEqual([...conditionPath, "reference"]);
    expect(hit.message).toMatch(message as RegExp);
  });
  test("structured all references retain their exact source path", () => {
    const reference = {
      position: "all",
      source: "prompt",
      name: "answer",
      path: ["value"],
    };
    const [hit] = hits(
      leaf("exists", undefined, reference),
      "everyone-reference",
    );
    expect(hit.path).toEqual([...conditionPath, "reference", "position"]);
  });
  test("display and outgoing URL references get rename guidance without a quantifier", () => {
    const source = {
      treatments: [
        {
          gameStages: [
            {
              elements: [
                { type: "display", reference: "all.prompt.answer.value" },
                {
                  type: "trackedLink",
                  urlParams: [
                    {
                      key: "a",
                      reference: {
                        position: "all",
                        source: "prompt",
                        name: "answer",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const warnings = detectGrammarUpgrades(source);
    expect(warnings.map((hit) => hit.path)).toEqual([
      ["treatments", 0, "gameStages", 0, "elements", 0, "reference"],
      [
        "treatments",
        0,
        "gameStages",
        0,
        "elements",
        1,
        "urlParams",
        0,
        "reference",
        "position",
      ],
    ]);
    expect(warnings.every((hit) => !hit.message.includes("all:"))).toBe(true);
  });
});

describe("raw-file traversal and registry adapter", () => {
  const gate = leaf("equals", "Yes");
  const element = { type: "submitButton", conditions: gate };
  const step = { conditions: gate };
  const sequence = { introSteps: [step] };
  const arm = { steps: [step] };
  const treatment = { gameStages: [step] };
  test.each([
    ["introSequence", sequence],
    ["introSequences", [sequence]],
    ["elements", [element]],
    ["element", element],
    ["stage", step],
    ["stages", [step]],
    ["treatment", treatment],
    ["treatments", [treatment]],
    ["condition", gate],
    ["conditions", [gate]],
    ["player", step],
    ["groupComposition", [step]],
    ["introExitStep", step],
    ["introSteps", [step]],
    ["exitSteps", [step]],
    ["consentArm", arm],
    ["consent", [arm]],
    ["discussion", step],
  ])("follows the actual %s template role", (contentType, content) => {
    const warnings = detectGrammarUpgrades({
      templates: [{ contentType, content }],
    });
    expect(warnings.map((hit) => hit.id)).toEqual([
      "text-comparison-normalization",
    ]);
    expect(warnings[0].path.slice(0, 3)).toEqual(["templates", 0, "content"]);
  });
  test("reference templates get rename guidance and broadcast data stays opaque", () => {
    const warnings = detectGrammarUpgrades({
      templates: [
        { contentType: "reference", content: "all.prompt.answer" },
        { contentType: "broadcastAxisValues", content: { conditions: gate } },
      ],
    });
    expect(warnings.map((hit) => hit.id)).toEqual(["everyone-reference"]);
    expect(warnings[0].path).toEqual(["templates", 0, "content"]);
  });
  test("merged condition fields are reported at their original anchored definition", () => {
    const source = `defaults: &gate
  reference: all.prompt.answer.value
  comparator: equals
  value: Yes
treatments:
  - gameStages:
      - elements:
          - type: submitButton
            conditions:
              <<: *gate
`;
    const mapper = createPositionMapper(source);
    const warnings = detectGrammarUpgrades(mapper.toJSON());
    expect(
      warnings.find((hit) => hit.id === "text-comparison-normalization")?.path,
    ).toEqual(["defaults"]);
    const group = warnings.find((hit) => hit.id === "everyone-reference");
    expect(group?.path).toEqual(["defaults", "reference"]);
    expect(mapper.resolve(group!.path)?.startLine).toBe(1);
  });
  test("stage and template merges follow their schema roles without warning on unused data", () => {
    const source = `unused:
  conditions:
    reference: all.prompt.neverUsed
    comparator: exists
defaults: &stage
  conditions:
    none:
      - reference: shared.prompt.answer.value
        comparator: equals
        value: Done
templates:
  - name: stageTemplate
    contentType: stage
    content:
      <<: *stage
treatments:
  - gameStages:
      - <<: *stage
`;
    const mapper = createPositionMapper(source);
    const warnings = detectGrammarUpgrades(mapper.toJSON());
    expect(
      warnings
        .filter((hit) => hit.id === "none-stage-termination")
        .map((hit) => hit.path),
    ).toEqual([["defaults", "conditions"]]);
    expect(warnings.some((hit) => hit.path.includes("unused"))).toBe(false);
    expect(warnings.every((hit) => mapper.resolve(hit.path) !== null)).toBe(
      true,
    );
  });
  test("explicit fields override merges and the first merge wins", () => {
    const source = `first: &first
  reference: self.prompt.answer.value
  comparator: equals
  value: Yes
second: &second
  reference: all.prompt.answer.value
  comparator: doesNotEqual
  value: No
treatments:
  - gameStages:
      - elements:
          - type: submitButton
            conditions:
              <<: [*first, *second]
              value: 4
`;
    const mapper = createPositionMapper(source);
    const warnings = detectGrammarUpgrades(mapper.toJSON());
    expect(warnings.map((hit) => hit.id)).toEqual(["strict-comparison-types"]);
    expect(warnings[0].message).toContain("equals");
    expect(warnings[0].path).toEqual(conditionPath);
    expect(mapper.resolve(warnings[0].path)).not.toBeNull();
  });
  test("nested merge definitions preserve the originating reference path", () => {
    const source = `reference: &reference
  position: all
  source: prompt
  name: answer
base: &base
  reference:
    <<: *reference
  comparator: exists
next: &next
  <<: *base
treatments:
  - gameStages:
      - elements:
          - conditions:
              <<: *next
`;
    const mapper = createPositionMapper(source);
    const [hit] = detectGrammarUpgrades(mapper.toJSON()).filter(
      (warning) => warning.id === "everyone-reference",
    );
    expect(hit.path).toEqual(["reference", "position"]);
    expect(mapper.resolve(hit.path)?.startLine).toBe(1);
  });
  test("merges in literal payloads and invocation fields remain opaque", () => {
    const source = `gate: &gate
  reference: all.prompt.answer
  comparator: equals
  value: Yes
treatments:
  - gameStages:
      - elements:
          - conditions:
              literal:
                <<: *gate
          - template: invocation
            fields:
              condition:
                <<: *gate
`;
    expect(
      detectGrammarUpgrades(createPositionMapper(source).toJSON()),
    ).toEqual([]);
  });
  test("an inline merge uses its real merge-node path when there is no separate definition", () => {
    const source = `treatments:
  - gameStages:
      - elements:
          - conditions:
              <<:
                reference: all.prompt.answer
                comparator: exists
`;
    const mapper = createPositionMapper(source);
    const [hit] = detectGrammarUpgrades(mapper.toJSON()).filter(
      (warning) => warning.id === "everyone-reference",
    );
    expect(hit.path).toEqual([...conditionPath, "<<"]);
    expect(mapper.resolve(hit.path)?.startLine).toBe(5);
  });
  test("an unreachable duplicate-key anchor falls back to its merge alias node", () => {
    const source = `gate: &gate
  reference: all.prompt.answer
  comparator: exists
gate: overwritten
treatments:
  - gameStages:
      - elements:
          - conditions:
              <<: *gate
`;
    const mapper = createPositionMapper(source);
    const [hit] = detectGrammarUpgrades(mapper.toJSON()).filter(
      (warning) => warning.id === "everyone-reference",
    );
    expect(hit.path).toEqual([...conditionPath, "<<"]);
    expect(mapper.resolve(hit.path)?.startLine).toBe(8);
  });
  test("large valid files retain every small condition's upgrade warnings", () => {
    const source = {
      treatments: [
        {
          gameStages: [
            {
              elements: Array.from({ length: 2000 }, () => ({
                type: "submitButton",
                conditions: leaf("equals", "Yes"),
              })),
            },
          ],
        },
      ],
    };
    expect(
      detectGrammarUpgrades(source).filter(
        (hit) => hit.id === "text-comparison-normalization",
      ),
    ).toHaveLength(2000);
  });
  test("large, deeply nested, or aliased opaque data cannot suppress a real warning", () => {
    let shared: unknown = "opaque";
    for (let i = 0; i < 5000; i++) shared = { left: shared, right: shared };
    const source = {
      notes: { wide: Array.from({ length: 12000 }, (_, i) => i), shared },
      ...file(leaf("equals", "Yes")),
    };
    expect(detectGrammarUpgrades(source).map((hit) => hit.id)).toEqual([
      "text-comparison-normalization",
    ]);
  });
  test("cyclic merge graphs stay bounded and do not hide independent conditions", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["<<"] = cyclic;
    const source = file({ any: [cyclic] });
    source.treatments[0].gameStages[0].elements.push({
      type: "submitButton",
      conditions: leaf("equals", "Yes"),
    });
    expect(detectGrammarUpgrades(source).map((hit) => hit.id)).toEqual([
      "text-comparison-normalization",
    ]);
  });
  test("definitions get real YAML positions and invocation fields stay opaque", () => {
    const source = `templates:
  - name: gate
    contentType: condition
    content:
      reference: self.prompt.answer.value
      comparator: equals
      value: Yes
treatments:
  - gameStages:
      - elements:
          - template: gate
            fields:
              data:
                reference: all.prompt.fake.value
                comparator: exists
`;
    const warnings = detectGrammarUpgrades(parse(source));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].path).toEqual(["templates", 0, "content"]);
    expect(
      createPositionMapper(source).resolve(warnings[0].path)?.startLine,
    ).toBe(4);
  });
  test("literal data and unknown properties cannot create fake conditions", () => {
    expect(
      detectGrammarUpgrades({
        notes: { conditions: leaf("equals", "Yes") },
        ...file({
          literal: { conditions: leaf("exists", undefined, "all.prompt.fake") },
        }),
      }),
    ).toEqual([]);
  });
  test.each([
    null,
    4,
    "bad",
    { treatments: null },
    { templates: [{ contentType: "unknown", content: leaf("exists") }] },
  ])("malformed raw input is harmless: %j", (source) =>
    expect(() => detectGrammarUpgrades(source)).not.toThrow(),
  );
  test("cyclic YAML and excessive depth are bounded", () => {
    const cycle: Record<string, unknown> = {};
    cycle.all = [cycle];
    expect(detectGrammarUpgrades(file(cycle))).toEqual([]);
    let deep: unknown = leaf("equals", "Yes");
    for (let i = 0; i < 1000; i++) deep = { all: [deep] };
    expect(detectGrammarUpgrades(file(deep))).toEqual([]);
  });
  test("version-independent descriptors adapt directly into the #756 registry", () => {
    const source = file(leaf("equals", "Yes"));
    const described = grammarUpgradeDetectors.flatMap((detector) =>
      detector.detect(source).map((hit) => ({ id: detector.id, ...hit })),
    );
    expect(described).toEqual(detectGrammarUpgrades(source));
    expect(new Set(grammarUpgradeDetectors.map((item) => item.id)).size).toBe(
      grammarUpgradeDetectors.length,
    );
    expect(
      grammarUpgradeDetectors.every((item) =>
        /^[a-z0-9]+(-[a-z0-9]+)*$/.test(item.id),
      ),
    ).toBe(true);
  });
});
