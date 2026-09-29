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
  ])(
    "accepts structural reference %j before metadata is loaded",
    (reference) => {
      const parsed = referenceSchema.safeParse(reference);
      expect(parsed.success).toBe(true);
    },
  );
  test.each([
    "self.prompt.q.isValid",
    "0.prompt.q.isValid",
    "shared.prompt.q.value",
    "shared.qualtrics.q.isValid",
  ])("allows %s", (reference) => {
    expect(referenceSchema.safeParse(reference).success).toBe(true);
  });
});

describe("metadata-aware shared validity (#687)", () => {
  const reference = "shared.prompt.q.isValid";
  const numeric = new Map([
    ["q.prompt.md", { type: "numericResponse", required: true }],
  ]);
  const open = new Map([["q.prompt.md", { type: "openResponse" }]]);
  const prompt = { ...shared, name: "q" };
  const withGate = (ref: unknown = reference) =>
    study({
      ...prompt,
      conditions: [{ reference: ref, comparator: "equals", value: true }],
    });

  test("allows numeric constraints and validity but rejects known nonnumeric validity", () => {
    expect(checkSharedPromptValidation(withGate(), numeric)).toEqual([]);
    expect(checkSharedPromptValidation(withGate(), open)).toEqual([
      expect.objectContaining({
        promptFile: "q.prompt.md",
        path: [
          "treatments",
          0,
          "gameStages",
          0,
          "elements",
          0,
          "conditions",
          0,
          "reference",
        ],
        message: expect.stringContaining("isValid") as unknown,
      }),
    ]);
  });
  test("checks structured references and nested isValid paths", () => {
    expect(
      checkSharedPromptValidation(
        withGate({
          position: "shared",
          source: "prompt",
          name: "q",
          path: ["isValid", "nested"],
        }),
        open,
      ),
    ).toHaveLength(1);
  });
  test.each([
    "self.prompt.q.isValid",
    "0.prompt.q.isValid",
    "shared.prompt.q.value",
    "shared.qualtrics.q.isValid",
  ])("leaves %s unchanged", (ref) => {
    expect(checkSharedPromptValidation(withGate(ref), open)).toEqual([]);
  });
  test("leaves malformed structured references to schema diagnostics", () => {
    expect(
      checkSharedPromptValidation(
        withGate({ position: "shared", source: "prompt", path: ["isValid"] }),
        open,
      ),
    ).toEqual([]);
  });
  test.each([
    "openResponse",
    "multipleChoice",
    "dropdown",
    "listSorter",
    "slider",
    "noResponse",
  ])("retains known %s shared validity rejection", (type) => {
    expect(
      checkSharedPromptValidation(
        withGate(),
        new Map([["q.prompt.md", { type }]]),
      ),
    ).toHaveLength(1);
  });
  test("unknown or absent metadata is not inferred to be nonnumeric", () => {
    expect(checkSharedPromptValidation(withGate(), new Map())).toEqual([]);
    expect(
      checkSharedPromptValidation(withGate(), new Map([["q.prompt.md", {}]])),
    ).toEqual([]);
  });
  test("does not guess automatic storage names from prompt frontmatter", () => {
    const unnamed = study({
      ...shared,
      conditions: [{ reference, comparator: "equals", value: true }],
    });
    expect(checkSharedPromptValidation(unnamed, open)).toEqual([]);
  });
  test("reused explicit names with one file are checked; different files remain ambiguous", () => {
    const file = {
      treatments: [
        {
          name: "t",
          gameStages: [
            { name: "a", elements: [prompt] },
            { name: "b", elements: [prompt, { type: "display", reference }] },
          ],
        },
      ],
    };
    expect(checkSharedPromptValidation(file, open)).toHaveLength(1);
    file.treatments[0].gameStages[0].elements[0] = {
      ...prompt,
      file: "other.prompt.md",
    };
    expect(checkSharedPromptValidation(file, open)).toEqual([]);
  });
  test("an unrelated treatment cannot hide a known nonnumeric producer", () => {
    const file = withGate();
    file.treatments.push({
      name: "other",
      gameStages: [
        { name: "other", elements: [{ ...prompt, file: "other.prompt.md" }] },
      ],
    });
    expect(checkSharedPromptValidation(file, open)).toHaveLength(1);
  });

  const leaf = { reference, comparator: "equals", value: true };
  test.each([
    [
      "stage",
      { conditions: { any: [{ none: [leaf] }] }, elements: [prompt] },
      "conditions",
    ],
    [
      "element",
      {
        elements: [
          prompt,
          { type: "submitButton", conditions: { all: [leaf] } },
        ],
      },
      "conditions",
    ],
    [
      "display",
      { elements: [prompt, { type: "display", reference }] },
      "reference",
    ],
    [
      "trackedLink",
      {
        elements: [
          prompt,
          { type: "trackedLink", urlParams: [{ name: "ok", reference }] },
        ],
      },
      "urlParams",
    ],
    [
      "qualtrics",
      {
        elements: [
          prompt,
          { type: "qualtrics", urlParams: [{ name: "ok", reference }] },
        ],
      },
      "urlParams",
    ],
    [
      "discussion",
      { elements: [prompt], discussion: { conditions: [leaf] } },
      "discussion",
    ],
  ])("walks registered %s reference sites", (_name, stage, pathPart) => {
    const issues = checkSharedPromptValidation(
      { treatments: [{ name: "t", gameStages: [stage] }] },
      open,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain(pathPart);
  });
  test("does not mistake unrelated arbitrary reference properties for authored references", () => {
    expect(
      checkSharedPromptValidation(
        study({ ...prompt, customData: { reference } }),
        open,
      ),
    ).toEqual([]);
  });
  test("checks group composition against declared intros, without leaking other sequences or consent arms", () => {
    const file = {
      introSequences: [
        { name: "selected", introSteps: [{ elements: [prompt] }] },
        {
          name: "other",
          introSteps: [{ elements: [{ ...prompt, file: "other.prompt.md" }] }],
        },
      ],
      consent: [
        {
          name: "consent",
          steps: [{ elements: [{ ...prompt, file: "consent.prompt.md" }] }],
        },
      ],
      treatments: [
        {
          name: "t",
          compatibleIntroSequences: ["selected"],
          groupComposition: [{ conditions: [leaf] }],
          gameStages: [],
        },
      ],
    };
    const issues = checkSharedPromptValidation(file, open);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual([
      "treatments",
      0,
      "groupComposition",
      0,
      "conditions",
      0,
      "reference",
    ]);
  });
  test("checks intro, consent, and exit references in their own scopes and skips template bodies", () => {
    const stage = { elements: [prompt, { type: "display", reference }] };
    const file = {
      introSequences: [{ name: "i", introSteps: [stage] }],
      consent: [{ name: "c", steps: [stage] }],
      treatments: [
        { name: "t", compatibleIntroSequences: [], exitSequence: [stage] },
      ],
      templates: [{ content: stage }],
    };
    const issues = checkSharedPromptValidation(file, open);
    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.path[0]).sort()).toEqual([
      "consent",
      "introSequences",
      "treatments",
    ]);
  });
});
