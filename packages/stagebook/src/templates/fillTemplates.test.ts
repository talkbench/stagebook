/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

import { expect, test } from "vitest";
import { fillTemplates, getUnresolvedFields } from "./fillTemplates.js";

test("template with simple object field", () => {
  const templates = [
    {
      name: "simple_object",
      content: {
        field1Key: "${f1}",
        field2Key: "${f2}",
        field3Key: "Adding ${f1} in a string succeeds!",
      },
    },
  ];

  const context = {
    template: "simple_object",
    fields: {
      f1: "f1Value",
      f2: {
        f2a: "f2aValue",
        f2b: "f2bValue",
      },
    },
  };

  const expectedResult = {
    field1Key: "f1Value",
    field2Key: {
      f2a: "f2aValue",
      f2b: "f2bValue",
    },
    field3Key: "Adding f1Value in a string succeeds!",
  };

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with simple list field", () => {
  const templates = [
    {
      name: "simple_list",
      content: ["${f1}", "${f2}", "Adding ${f1} in a string succeeds!"],
    },
  ];

  const context = {
    template: "simple_list",
    fields: {
      f1: "f1Value",
      f2: {
        f2a: "f2aValue",
        f2b: "f2bValue",
      },
    },
  };

  const expectedResult = [
    "f1Value",
    {
      f2a: "f2aValue",
      f2b: "f2bValue",
    },
    "Adding f1Value in a string succeeds!",
  ];

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with simple string field", () => {
  const templates = [
    {
      name: "simple_string",
      content: "Adding ${f1} in a string succeeds!",
    },
  ];

  const context = {
    template: "simple_string",
    fields: {
      f1: "f1Value",
    },
  };

  const expectedResult = "Adding f1Value in a string succeeds!";

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("nested templates", () => {
  const templates = [
    {
      name: "outer",
      content: {
        field1Key: "${f1}",
        field2Key: "${f2}",
        fields1and2Keys: "${f1}_${f2}",
        field3Key: "${f3}",
        innerTemplateResult: {
          template: "inner",
          fields: {
            f4: "${f1}",
            f5: "${f2}_suffix",
          },
        },
      },
    },
    {
      name: "inner",
      content: {
        field4Key: "${f4}",
        field5Key: "${f5}",
      },
    },
  ];

  const context = {
    template: "outer",
    fields: {
      f1: "f1Value",
      f2: "f2Value",
      f3: {
        f3a: "f3aValue",
        f3b: "f3bValue",
      },
    },
  };

  const expectedResult = {
    field1Key: "f1Value",
    field2Key: "f2Value",
    fields1and2Keys: "f1Value_f2Value",
    field3Key: {
      f3a: "f3aValue",
      f3b: "f3bValue",
    },
    innerTemplateResult: {
      field4Key: "f1Value",
      field5Key: "f2Value_suffix",
    },
  };

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with broadcast", () => {
  const templates = [
    {
      name: "simple",
      content: {
        name: "${name}",
        Aval: "${A}",
        Bval: "${B}",
      },
    },
  ];

  const context = {
    template: "simple",
    fields: {
      name: "t_d0_${d0}_d1_${d1}",
    },
    broadcast: {
      d0: [{ A: "A0" }, { A: "A1" }, { A: "A2" }],
      d1: [{ B: "B0" }, { B: "B1" }],
    },
  };

  const expectedResult = [
    { name: "t_d0_0_d1_0", Aval: "A0", Bval: "B0" },
    { name: "t_d0_0_d1_1", Aval: "A0", Bval: "B1" },
    { name: "t_d0_1_d1_0", Aval: "A1", Bval: "B0" },
    { name: "t_d0_1_d1_1", Aval: "A1", Bval: "B1" },
    { name: "t_d0_2_d1_0", Aval: "A2", Bval: "B0" },
    { name: "t_d0_2_d1_1", Aval: "A2", Bval: "B1" },
  ];

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with broadcast merging to array", () => {
  const templates = [
    {
      name: "inner",
      content: { name: "${name}" },
    },
    {
      name: "outer",
      content: {
        arrayOfInnersAndOthers: [
          {
            template: "inner",
            fields: { name: "inner ${bname}" },
            broadcast: {
              d0: [{ bname: "d0 A" }, { bname: "d0 B" }],
            },
          },
          { name: "outer Other", val: "other val" },
        ],
      },
    },
  ];

  const context = { template: "outer" };

  const expectedResult = {
    arrayOfInnersAndOthers: [
      { name: "inner d0 A" },
      { name: "inner d0 B" },
      { name: "outer Other", val: "other val" },
    ],
  };

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with broadcast array from another template", () => {
  const templates = [
    {
      name: "simple",
      content: {
        name: "${name}",
        Aval: "${A}",
        Bval: "${B}",
      },
    },
    {
      name: "broadcastList",
      content: [{ A: "A0" }, { A: "A1" }, { A: "A2" }],
    },
  ];

  const context = {
    template: "simple",
    fields: {
      name: "t_d0_${d0}_d1_${d1}",
    },
    broadcast: {
      d0: { template: "broadcastList" },
      d1: [{ B: "B0" }, { B: "B1" }],
    },
  };

  const expectedResult = [
    { name: "t_d0_0_d1_0", Aval: "A0", Bval: "B0" },
    { name: "t_d0_0_d1_1", Aval: "A0", Bval: "B1" },
    { name: "t_d0_1_d1_0", Aval: "A1", Bval: "B0" },
    { name: "t_d0_1_d1_1", Aval: "A1", Bval: "B1" },
    { name: "t_d0_2_d1_0", Aval: "A2", Bval: "B0" },
    { name: "t_d0_2_d1_1", Aval: "A2", Bval: "B1" },
  ];

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

test("template with list and broadcast returns properly", () => {
  const templates = [
    {
      name: "listTemplate",
      content: [
        { outerIndex: "${outerIndex}", innerIndex: "0" },
        { outerIndex: "${outerIndex}", innerIndex: "1" },
      ],
    },
  ];

  const context = {
    template: "listTemplate",
    broadcast: {
      d0: [{ outerIndex: "0" }, { outerIndex: "1" }, { outerIndex: "2" }],
    },
  };

  const expectedResult = [
    { outerIndex: "0", innerIndex: "0" },
    { outerIndex: "0", innerIndex: "1" },
    { outerIndex: "1", innerIndex: "0" },
    { outerIndex: "1", innerIndex: "1" },
    { outerIndex: "2", innerIndex: "0" },
    { outerIndex: "2", innerIndex: "1" },
  ];

  const { result } = fillTemplates({ templates, obj: context });
  expect(result).toEqual(expectedResult);
});

// ----------------------------------------------------------------
// Error conditions (#18)
// ----------------------------------------------------------------

test("throws on missing template reference", () => {
  const templates = [{ name: "exists", content: { key: "value" } }];

  expect(() =>
    fillTemplates({ templates, obj: { template: "doesNotExist" } }),
  ).toThrow('Template "doesNotExist" not found');
});

test("throws on unfilled field placeholders", () => {
  const templates = [
    {
      name: "withPlaceholder",
      content: { name: "${missingField}" },
    },
  ];

  expect(() =>
    fillTemplates({
      templates,
      obj: { template: "withPlaceholder" },
    }),
  ).toThrow("Missing fields");
});

test("throws on circular template references (depth limit)", () => {
  const templates = [
    {
      name: "loop1",
      content: { nested: { template: "loop2" } },
    },
    {
      name: "loop2",
      content: { nested: { template: "loop1" } },
    },
  ];

  expect(() =>
    fillTemplates({ templates, obj: { template: "loop1" } }),
  ).toThrow("Maximum template nesting depth");
});

test("circular reference error includes template chain", () => {
  const templates = [
    {
      name: "alpha",
      content: { next: { template: "beta" } },
    },
    {
      name: "beta",
      content: { next: { template: "alpha" } },
    },
  ];

  try {
    fillTemplates({ templates, obj: { template: "alpha" } });
    expect.unreachable("Should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    expect(msg).toContain("Template chain:");
    expect(msg).toContain("alpha");
    expect(msg).toContain("beta");
  }
});

test("non-template objects pass through unchanged", () => {
  const { result } = fillTemplates({
    templates: [],
    obj: { name: "plain", value: 42 },
  });
  expect(result).toEqual({ name: "plain", value: 42 });
});

test("empty templates array with plain array", () => {
  const { result } = fillTemplates({
    templates: [],
    obj: [{ name: "item1" }, { name: "item2" }],
  });
  expect(result).toEqual([{ name: "item1" }, { name: "item2" }]);
});

test("numeric field values substituted as standalone", () => {
  const templates = [
    {
      name: "numeric",
      content: { count: "${num}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "numeric", fields: { num: 42 } },
  });
  // Standalone ${num} gets replaced with the number value
  expect(result).toEqual({ count: 42 });
});

test("string field embedded in another string", () => {
  const templates = [
    {
      name: "embedded",
      content: { label: "Item ${name} here" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "embedded", fields: { name: "Alpha" } },
  });
  expect(result).toEqual({ label: "Item Alpha here" });
});

test("numeric field embedded in another string", () => {
  // Regression: substituteFields previously skipped in-string substitution
  // for non-string scalars, so `roundN: 1` left `${roundN}` literal in
  // strings like `round_${roundN}_choice`. The function now stringifies
  // numbers and booleans for embedded substitution.
  const templates = [
    {
      name: "embedded",
      content: { name: "round_${roundN}_choice" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "embedded", fields: { roundN: 1 } },
  });
  expect(result).toEqual({ name: "round_1_choice" });
});

test("boolean field embedded in another string", () => {
  const templates = [
    {
      name: "embedded",
      content: { tag: "active=${flag}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "embedded", fields: { flag: true } },
  });
  expect(result).toEqual({ tag: "active=true" });
});

test("numeric broadcast field substituted into stage names (#PD repro)", () => {
  // Mirrors the prisoner's-dilemma example: a `contentType: stages`
  // template invoked with broadcast over a numeric `roundN`. Each
  // expansion must produce stages with the round number substituted
  // into the stage name.
  const templates = [
    {
      name: "roundTemplate",
      content: [
        { name: "round_${roundN}_choice" },
        { name: "round_${roundN}_outcome" },
      ],
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: {
      gameStages: [
        {
          template: "roundTemplate",
          broadcast: { d0: [{ roundN: 1 }, { roundN: 2 }, { roundN: 3 }] },
        },
      ],
    },
  });

  expect(result).toEqual({
    gameStages: [
      { name: "round_1_choice" },
      { name: "round_1_outcome" },
      { name: "round_2_choice" },
      { name: "round_2_outcome" },
      { name: "round_3_choice" },
      { name: "round_3_outcome" },
    ],
  });
});

test("array field values substituted correctly", () => {
  const templates = [
    {
      name: "arrayField",
      content: { items: "${myArray}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "arrayField", fields: { myArray: ["a", "b", "c"] } },
  });
  expect(result).toEqual({ items: ["a", "b", "c"] });
});

test("boolean field values substituted correctly", () => {
  const templates = [
    {
      name: "boolField",
      content: { enabled: "${flag}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "boolField", fields: { flag: true } },
  });
  expect(result).toEqual({ enabled: true });
});

// ----------------------------------------------------------------
// additionalFields (#22)
// ----------------------------------------------------------------

test("additionalFields resolves platform-provided placeholders", () => {
  const templates = [
    {
      name: "stage",
      content: {
        name: "rate_${dimension}",
        url: "${clipUrl}",
        startAt: "${clipStartAt}",
      },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "stage", fields: { dimension: "engagement" } },
    additionalFields: {
      clipUrl: "https://cdn.example.com/clip1.mp4",
      clipStartAt: 12.5,
    },
  });
  expect(result).toEqual({
    name: "rate_engagement",
    url: "https://cdn.example.com/clip1.mp4",
    startAt: 12.5,
  });
});

test("additionalFields without additionalFields behaves identically", () => {
  const templates = [
    {
      name: "simple",
      content: { name: "${n}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "simple", fields: { n: "hello" } },
  });
  expect(result).toEqual({ name: "hello" });
});

test("researcher fields and additionalFields coexist", () => {
  const templates = [
    {
      name: "mixed",
      content: {
        researcherField: "${myField}",
        platformField: "${platformValue}",
      },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "mixed", fields: { myField: "from researcher" } },
    additionalFields: { platformValue: "from platform" },
  });
  expect(result).toEqual({
    researcherField: "from researcher",
    platformField: "from platform",
  });
});

test("broadcast + additionalFields work together", () => {
  const templates = [
    {
      name: "rating",
      content: {
        name: "rate_${dimension}",
        clip: "${clipUrl}",
      },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: {
      template: "rating",
      broadcast: {
        d0: [{ dimension: "engagement" }, { dimension: "confidence" }],
      },
    },
    additionalFields: { clipUrl: "https://cdn.example.com/clip1.mp4" },
  });
  expect(result).toEqual([
    {
      name: "rate_engagement",
      clip: "https://cdn.example.com/clip1.mp4",
    },
    {
      name: "rate_confidence",
      clip: "https://cdn.example.com/clip1.mp4",
    },
  ]);
});

test("missing additionalFields still triggers error", () => {
  const templates = [
    {
      name: "needsMore",
      content: {
        a: "${provided}",
        b: "${missing}",
      },
    },
  ];

  expect(() =>
    fillTemplates({
      templates,
      obj: { template: "needsMore" },
      additionalFields: { provided: "here" },
    }),
  ).toThrow("Missing fields");
});

test("additionalFields with object values", () => {
  const templates = [
    {
      name: "config",
      content: { settings: "${platformConfig}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: { template: "config" },
    additionalFields: {
      platformConfig: { quality: "high", fps: 30 },
    },
  });
  expect(result).toEqual({
    settings: { quality: "high", fps: 30 },
  });
});

test("returns empty unresolvedFields when all fields filled", () => {
  const templates = [{ name: "full", content: { val: "${x}" } }];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "full", fields: { x: "done" } },
  });
  expect(result).toEqual({ val: "done" });
  expect(unresolvedFields).toEqual([]);
});

// ----------------------------------------------------------------
// allowUnresolved (#27)
// ----------------------------------------------------------------

test("allowUnresolved returns partial result with unresolved field names", () => {
  const templates = [
    {
      name: "stage",
      content: {
        name: "rate_${dimension}",
        clip: "${clipUrl}",
        start: "${clipStartAt}",
      },
    },
  ];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "stage", fields: { dimension: "engagement" } },
    allowUnresolved: true,
  });
  expect(result.name).toBe("rate_engagement");
  expect(result.clip).toBe("${clipUrl}");
  expect(result.start).toBe("${clipStartAt}");
  expect(unresolvedFields.sort()).toEqual(["clipStartAt", "clipUrl"]);
});

test("allowUnresolved + additionalFields: partial fill", () => {
  const templates = [
    {
      name: "stage",
      content: {
        clip: "${clipUrl}",
        start: "${clipStartAt}",
        stop: "${clipStopAt}",
      },
    },
  ];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "stage" },
    additionalFields: { clipUrl: "video.mp4" },
    allowUnresolved: true,
  });
  expect(result.clip).toBe("video.mp4");
  expect(unresolvedFields.sort()).toEqual(["clipStartAt", "clipStopAt"]);
});

test("two-pass expansion: researcher templates then platform fields", () => {
  const templates = [
    {
      name: "ratingStage",
      content: {
        name: "rate_${dimension}",
        clip: "${clipUrl}",
        startAt: "${clipStartAt}",
      },
    },
  ];

  // Pass 1: expand researcher templates, leave platform fields
  const { result: expanded, unresolvedFields } = fillTemplates({
    templates,
    obj: {
      template: "ratingStage",
      broadcast: {
        d0: [{ dimension: "engagement" }, { dimension: "confidence" }],
      },
    },
    allowUnresolved: true,
  });
  expect(unresolvedFields.sort()).toEqual(["clipStartAt", "clipUrl"]);
  expect(expanded).toHaveLength(2);
  expect(expanded[0].name).toBe("rate_engagement");
  expect(expanded[1].name).toBe("rate_confidence");

  // Pass 2: fill platform fields for each expanded treatment
  const { result: resolved, unresolvedFields: remaining } = fillTemplates({
    obj: expanded[0],
    templates: [],
    additionalFields: { clipUrl: "clip1.mp4", clipStartAt: 12.5 },
  });
  expect(remaining).toEqual([]);
  expect(resolved.clip).toBe("clip1.mp4");
  expect(resolved.startAt).toBe(12.5);
  expect(resolved.name).toBe("rate_engagement");
});

test("allowUnresolved without unresolved fields returns empty array", () => {
  const templates = [{ name: "done", content: { x: "${a}" } }];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "done", fields: { a: "filled" } },
    allowUnresolved: true,
  });
  expect(result).toEqual({ x: "filled" });
  expect(unresolvedFields).toEqual([]);
});

test("default (allowUnresolved false) still throws on unresolved", () => {
  const templates = [{ name: "incomplete", content: { x: "${missing}" } }];

  expect(() =>
    fillTemplates({ templates, obj: { template: "incomplete" } }),
  ).toThrow("Missing fields");
});

// ----------------------------------------------------------------
// getUnresolvedFields (#23) — deprecated, still works
// ----------------------------------------------------------------

test("getUnresolvedFields returns platform placeholders", () => {
  const templates = [
    {
      name: "stage",
      content: {
        name: "rate_${dimension}",
        url: "${clipUrl}",
        startAt: "${clipStartAt}",
        stopAt: "${clipStopAt}",
      },
    },
  ];

  const fields = getUnresolvedFields({
    templates,
    obj: { template: "stage", fields: { dimension: "engagement" } },
  });
  expect(fields.sort()).toEqual(
    ["clipUrl", "clipStartAt", "clipStopAt"].sort(),
  );
});

test("getUnresolvedFields returns empty when all fields resolved", () => {
  const templates = [
    {
      name: "complete",
      content: { name: "${n}" },
    },
  ];

  const fields = getUnresolvedFields({
    templates,
    obj: { template: "complete", fields: { n: "done" } },
  });
  expect(fields).toEqual([]);
});

test("getUnresolvedFields with broadcast resolves researcher fields", () => {
  const templates = [
    {
      name: "rating",
      content: {
        name: "rate_${dimension}",
        clip: "${clipUrl}",
      },
    },
  ];

  const fields = getUnresolvedFields({
    templates,
    obj: {
      template: "rating",
      broadcast: {
        d0: [{ dimension: "engagement" }, { dimension: "confidence" }],
      },
    },
  });
  // dimension is resolved by broadcast, clipUrl remains
  expect(fields).toEqual(["clipUrl"]);
});

test("getUnresolvedFields does not throw", () => {
  const templates = [
    {
      name: "incomplete",
      content: { a: "${x}", b: "${y}", c: "${z}" },
    },
  ];

  // Should not throw — returns the unresolved fields instead
  const fields = getUnresolvedFields({
    templates,
    obj: { template: "incomplete" },
  });
  expect(fields.sort()).toEqual(["x", "y", "z"]);
});

test("getUnresolvedFields returns unique names", () => {
  const templates = [
    {
      name: "repeated",
      content: {
        a: "${same}",
        b: "prefix_${same}_suffix",
        c: "${same}",
      },
    },
  ];

  const fields = getUnresolvedFields({
    templates,
    obj: { template: "repeated" },
  });
  expect(fields).toEqual(["same"]);
});

// ----------------------------------------------------------------
// Edge case tests (audit)
// ----------------------------------------------------------------

// -- undefined/null additionalFields values --

test("additionalFields with undefined value leaves placeholder", () => {
  const templates = [{ name: "t", content: { a: "${x}", b: "${y}" } }];

  // undefined is skipped, so ${x} remains unresolved
  expect(() =>
    fillTemplates({
      templates,
      obj: { template: "t" },
      additionalFields: { x: undefined, y: "filled" },
    }),
  ).toThrow("Missing fields");
});

test("additionalFields with undefined value + allowUnresolved", () => {
  const templates = [{ name: "t", content: { a: "${x}", b: "${y}" } }];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "t" },
    additionalFields: { x: undefined, y: "filled" },
    allowUnresolved: true,
  });

  expect(result.b).toBe("filled");
  expect(unresolvedFields).toEqual(["x"]);
});

test("additionalFields with null value substitutes null", () => {
  const templates = [{ name: "t", content: { val: "${x}" } }];

  const { result } = fillTemplates({
    templates,
    obj: { template: "t" },
    additionalFields: { x: null },
  });

  expect(result.val).toBe(null);
});

// -- Field value containing ${...} syntax (double substitution risk) --

test("field value containing placeholder-like text is not re-substituted", () => {
  const templates = [
    {
      name: "code",
      content: { snippet: "${code}", label: "Code: ${code}" },
    },
  ];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "code", fields: { code: "return ${x} + ${y};" } },
    allowUnresolved: true,
  });

  // The literal ${x} and ${y} inside the field value should NOT be
  // treated as template placeholders — they're data, not template syntax
  expect(result.snippet).toBe("return ${x} + ${y};");
  // But they WILL appear as unresolved fields in the scan
  expect(unresolvedFields).toContain("x");
  expect(unresolvedFields).toContain("y");
});

// -- additionalFields override researcher fields --

test("additionalFields applied after researcher fields (later wins)", () => {
  const templates = [{ name: "t", content: { val: "${shared}" } }];

  const { result } = fillTemplates({
    templates,
    obj: { template: "t", fields: { shared: "researcher" } },
    additionalFields: { shared: "platform" },
  });

  // Researcher field is applied first during template expansion,
  // so the value is already "researcher" before additionalFields runs.
  // additionalFields can't override an already-substituted value.
  expect(result.val).toBe("researcher");
});

// -- Array of template contexts --

test("array of template contexts each expanded independently", () => {
  const templates = [{ name: "greet", content: { msg: "Hello ${name}" } }];

  const { result } = fillTemplates({
    templates,
    obj: [
      { template: "greet", fields: { name: "Alice" } },
      { template: "greet", fields: { name: "Bob" } },
    ],
  });

  expect(result).toEqual([{ msg: "Hello Alice" }, { msg: "Hello Bob" }]);
});

test("array of treatments with different unresolved fields", () => {
  const templates = [
    { name: "a", content: { url: "${clipUrl}" } },
    { name: "b", content: { start: "${startTime}" } },
  ];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: [{ template: "a" }, { template: "b" }],
    allowUnresolved: true,
  });

  expect(result).toHaveLength(2);
  expect(unresolvedFields.sort()).toEqual(["clipUrl", "startTime"]);
});

// -- Broadcast edge cases --

test("single-item broadcast returns array with one element", () => {
  const templates = [{ name: "t", content: { val: "${v}" } }];

  const { result } = fillTemplates({
    templates,
    obj: {
      template: "t",
      broadcast: { d0: [{ v: "only" }] },
    },
  });

  expect(Array.isArray(result)).toBe(true);
  expect(result).toHaveLength(1);
  expect(result[0].val).toBe("only");
});

test("broadcast dimension indices don't collide with additionalFields", () => {
  const templates = [
    {
      name: "t",
      content: { index: "${d0}", platform: "${pval}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: {
      template: "t",
      broadcast: { d0: [{ x: 1 }, { x: 2 }] },
    },
    additionalFields: { pval: "filled" },
  });

  // d0 should be broadcast indices "0" and "1", not overridden by additionalFields
  expect(result).toHaveLength(2);
  expect(result[0].index).toBe("0");
  expect(result[1].index).toBe("1");
  expect(result[0].platform).toBe("filled");
});

test("multi-dimensional broadcast + additionalFields", () => {
  const templates = [
    {
      name: "t",
      content: { name: "${d0}_${d1}", url: "${platformUrl}" },
    },
  ];

  const { result } = fillTemplates({
    templates,
    obj: {
      template: "t",
      broadcast: {
        d0: [{ a: 1 }, { a: 2 }],
        d1: [{ b: "x" }, { b: "y" }, { b: "z" }],
      },
    },
    additionalFields: { platformUrl: "https://cdn.test/v.mp4" },
  });

  expect(result).toHaveLength(6);
  expect(
    result.every(
      (item: Record<string, unknown>) => item.url === "https://cdn.test/v.mp4",
    ),
  ).toBe(true);
  expect(result[0].name).toBe("0_0");
  expect(result[5].name).toBe("1_2");
});

// -- Nested templates with unresolved fields --

test("unresolved fields in nested templates bubble up", () => {
  const templates = [
    {
      name: "outer",
      content: {
        inner: { template: "inner", fields: { x: "resolved" } },
      },
    },
    {
      name: "inner",
      content: { x: "${x}", y: "${y}" },
    },
  ];

  const { result, unresolvedFields } = fillTemplates({
    templates,
    obj: { template: "outer" },
    allowUnresolved: true,
  });

  expect(result.inner.x).toBe("resolved");
  expect(unresolvedFields).toEqual(["y"]);
});

// -- Two-pass strict second pass --

test("strict second pass throws on remaining unresolved", () => {
  const templates = [{ name: "t", content: { a: "${x}", b: "${y}" } }];

  const { result: partial } = fillTemplates({
    templates,
    obj: { template: "t" },
    allowUnresolved: true,
  });

  expect(() =>
    fillTemplates({
      templates: [],
      obj: partial,
      additionalFields: { x: "filled" },
    }),
  ).toThrow("Missing fields");
});

// -- Return type consistency --

test("non-broadcast returns object, broadcast returns array", () => {
  const templates = [{ name: "t", content: { id: "${id}" } }];

  const { result: single } = fillTemplates({
    templates,
    obj: { template: "t", fields: { id: "1" } },
  });
  expect(Array.isArray(single)).toBe(false);

  const { result: multi } = fillTemplates({
    templates,
    obj: {
      template: "t",
      fields: { id: "${d0}" },
      broadcast: { d0: [{ x: 1 }, { x: 2 }] },
    },
    allowUnresolved: true,
  });
  expect(Array.isArray(multi)).toBe(true);
  expect(multi).toHaveLength(2);
});

// ----------------------------------------------------------------
// Pattern library (#304) — real-world shapes from
// deliberation-assets and backchannel-manipulation. Each test below
// is a regression guard for a pattern researchers use in production.
// Patterns 14a/14b (template-as-fields-value) are rejected at parse
// time; their tests live in schemas/treatment.test.ts.
// ----------------------------------------------------------------

// ----- Lock-in: patterns that should keep working -----

test("pattern 6: broadcast row carries multiple correlated fields", () => {
  // Each row sets several fields at once (covary, not crossed) — used
  // heavily in dyad studies for stance/direction pairs.
  const templates = [
    {
      name: "condition",
      content: { p0: "${p0_stance}", p1: "${p1_stance}", dir: "${direction}" },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "condition",
      broadcast: {
        d0: [
          { p0_stance: "neg", p1_stance: "pos", direction: "neg2pos" },
          { p0_stance: "pos", p1_stance: "neg", direction: "pos2neg" },
        ],
      },
    },
  });
  expect(result).toEqual([
    { p0: "neg", p1: "pos", dir: "neg2pos" },
    { p0: "pos", p1: "neg", dir: "pos2neg" },
  ]);
});

test("pattern 7: whole treatment-file shape { templates, treatments }", () => {
  // The realistic entrypoint. Every existing test passes a synthetic
  // `obj` shape; none uses the actual treatment-file shape.
  const treatmentFile = {
    templates: [
      {
        name: "stage",
        content: { name: "s_${idx}", duration: 60 },
      },
    ],
    treatments: [
      { template: "stage", fields: { idx: "1" } },
      { template: "stage", fields: { idx: "2" } },
    ],
  };
  const { result } = fillTemplates({
    obj: treatmentFile,
    templates: treatmentFile.templates,
  });
  expect(result.treatments).toEqual([
    { name: "s_1", duration: 60 },
    { name: "s_2", duration: 60 },
  ]);
});

test("pattern 8: fields and broadcast on the same invocation", () => {
  // Outer-fields constant + per-row varying — every existing test uses
  // one or the other, never both.
  const templates = [
    {
      name: "stage",
      content: { round: "${recallIndex}", out: "${outcomeFile}" },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "stage",
      fields: { outcomeFile: "failure" },
      broadcast: { d0: [{ recallIndex: "1" }, { recallIndex: "2" }] },
    },
  });
  expect(result).toEqual([
    { round: "1", out: "failure" },
    { round: "2", out: "failure" },
  ]);
});

test("pattern 9: field substituted as condition `value:` (typed scalars)", () => {
  // `value: "${correctAnswer}"` — placeholder lands in a slot the
  // schema/runtime expects to be a typed scalar (number here).
  const templates = [
    {
      name: "task",
      content: {
        conditions: [
          {
            reference: "prompt.guess_${idx}",
            comparator: "equals",
            value: "${correctAnswer}",
          },
        ],
      },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "task",
      broadcast: {
        d0: [
          { idx: "1", correctAnswer: 2 },
          { idx: "2", correctAnswer: 3 },
        ],
      },
    },
  });
  expect(result[0].conditions[0].value).toBe(2);
  expect(result[1].conditions[0].value).toBe(3);
});

test("pattern 10: field threaded through 3+ nesting levels (explicit forwarding)", () => {
  // Fields don't auto-thread through nested invocations — each level
  // must explicitly forward what its children need. This test pins
  // that contract: `outer` forwards to `mid`, which forwards to
  // `leaf`. (An earlier draft of this test omitted mid's forward and
  // expected auto-threading; the engine has never worked that way.)
  const templates = [
    { name: "leaf", content: { file: "topics/${topicName}.md" } },
    {
      name: "mid",
      content: {
        stages: [{ template: "leaf", fields: { topicName: "${topicName}" } }],
      },
    },
    {
      name: "outer",
      content: {
        stages: [{ template: "mid", fields: { topicName: "${topicName}" } }],
      },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: { template: "outer", fields: { topicName: "abortion" } },
  });
  expect(result.stages[0].stages[0].file).toBe("topics/abortion.md");
});

test("pattern 11: researcher-supplied list as broadcast dimension", () => {
  // Outer caller passes `images: [...]` as a plain field; inner
  // template uses it as a broadcast dimension via `${images}`.
  const templates = [
    {
      name: "recallTask",
      content: [{ name: "recall_${d0}", file: "${imageFile}" }],
    },
    {
      name: "round",
      content: {
        stages: [
          {
            template: "recallTask",
            broadcast: { d0: "${images}" },
          },
        ],
      },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "round",
      fields: {
        images: [{ imageFile: "a.jpg" }, { imageFile: "b.jpg" }],
      },
    },
  });
  expect(result.stages).toEqual([
    { name: "recall_0", file: "a.jpg" },
    { name: "recall_1", file: "b.jpg" },
  ]);
});

test("pattern 16: pure host-fillable file (templates: [])", () => {
  // No researcher templates at all — only host-fillable placeholders
  // in literal treatments. Backchannel annotation files use this.
  const obj = {
    templates: [],
    treatments: [
      {
        name: "session",
        gameStages: [
          {
            name: "play",
            elements: [{ type: "mediaPlayer", file: "${clipUrl}" }],
          },
        ],
      },
    ],
  };
  const { result } = fillTemplates({
    obj,
    templates: [],
    additionalFields: { clipUrl: "https://cdn/x.mp4" },
  });
  expect(result.treatments[0].gameStages[0].elements[0].file).toBe(
    "https://cdn/x.mp4",
  );
});

test("pattern 17: same host placeholder reused across stages, dedup", () => {
  // One additionalFields fill must propagate to multiple sites; and
  // unresolvedFields must dedup the placeholder name when reporting.
  const obj = {
    templates: [],
    treatments: [
      {
        name: "t",
        gameStages: [
          {
            name: "s1",
            elements: [{ type: "mediaPlayer", file: "${storyPath}" }],
          },
          {
            name: "s2",
            elements: [{ type: "mediaPlayer", file: "${storyPath}" }],
          },
        ],
      },
    ],
  };
  const { unresolvedFields } = fillTemplates({
    obj,
    templates: [],
    allowUnresolved: true,
  });
  expect(unresolvedFields).toEqual(["storyPath"]);
});

test("pattern 18: host placeholder in a number-typed schema field", () => {
  // `startAt: "${x}"` — string in YAML, number after additionalFields
  // fill. Substitution must preserve the typed value.
  const obj = {
    treatments: [
      {
        gameStages: [
          {
            elements: [
              {
                type: "mediaPlayer",
                file: "${url}",
                startAt: "${startAt}",
                stopAt: "${stopAt}",
              },
            ],
          },
        ],
      },
    ],
  };
  const { result } = fillTemplates({
    obj,
    templates: [],
    additionalFields: { url: "x.mp4", startAt: 12.5, stopAt: 47 },
  });
  const el = result.treatments[0].gameStages[0].elements[0];
  expect(el.startAt).toBe(12.5);
  expect(el.stopAt).toBe(47);
  expect(typeof el.startAt).toBe("number");
});

test("pattern 19: fields value built from broadcast-resolved placeholders", () => {
  // `treatment_name: "${first}_${second}"` — the field VALUE itself
  // contains placeholders that get resolved by the same call's
  // broadcast row. Subtle: this works because fields-substitution runs
  // first (yielding a string with broadcast placeholders), then
  // broadcast-substitution walks the *content* and finds them.
  const templates = [{ name: "t", content: { name: "${treatment_name}" } }];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "t",
      fields: { treatment_name: "${first}_${second}" },
      broadcast: {
        d0: [
          { first: "a", second: "b" },
          { first: "c", second: "d" },
        ],
      },
    },
  });
  expect(result).toEqual([{ name: "a_b" }, { name: "c_d" }]);
});

test("pattern 20: outer broadcast row values flow into inner-template broadcast", () => {
  // Outer broadcast supplies first_condition / second_condition;
  // inner template's broadcast dimension is { condition: ${first}, ... }.
  // Distinct from pattern 12 — here the inner broadcast STRUCTURE is
  // populated from outer values (not the template name itself).
  const templates = [
    {
      name: "round",
      content: [{ name: "stage_${roundN}", config: "${condition}" }],
    },
    {
      name: "game",
      content: {
        stages: [
          {
            template: "round",
            broadcast: {
              d0: [
                { condition: "${first}", roundN: "1" },
                { condition: "${second}", roundN: "2" },
              ],
            },
          },
        ],
      },
    },
  ];
  const { result } = fillTemplates({
    templates,
    obj: {
      template: "game",
      broadcast: {
        d0: [
          { first: "natural", second: "tapping" },
          { first: "tapping", second: "natural" },
        ],
      },
    },
  });
  expect(result).toHaveLength(2);
  expect(result[0].stages).toEqual([
    { name: "stage_1", config: "natural" },
    { name: "stage_2", config: "tapping" },
  ]);
  expect(result[1].stages).toEqual([
    { name: "stage_1", config: "tapping" },
    { name: "stage_2", config: "natural" },
  ]);
});

// ----- #304 family — fixed by stripping templates from the walker -----

test("pattern 12: parameterized inner-template name resolved by outer broadcast", () => {
  // The #304 motivating case. Inner invocation `{ template: "${arm}_pre" }`
  // resolves to one of N per-arm sub-templates via outer broadcast.
  const treatmentFile = {
    templates: [
      {
        name: "control_pre",
        content: [{ type: "submitButton", buttonText: "Go" }],
      },
      {
        name: "treatment_pre",
        content: [
          { type: "prompt", file: "treatment.md" },
          { type: "submitButton", buttonText: "Go" },
        ],
      },
      {
        name: "condition",
        content: {
          name: "${arm}-condition",
          gameStages: [
            {
              name: "pre",
              elements: [{ template: "${arm}_pre" }],
            },
          ],
        },
      },
    ],
    treatments: [
      {
        template: "condition",
        broadcast: {
          d0: [{ arm: "control" }, { arm: "treatment" }],
        },
      },
    ],
  };
  const { result } = fillTemplates({
    obj: treatmentFile,
    templates: treatmentFile.templates,
  });
  expect(result.treatments).toHaveLength(2);
  expect(result.treatments[0].name).toBe("control-condition");
  expect(result.treatments[0].gameStages[0].elements).toEqual([
    { type: "submitButton", buttonText: "Go" },
  ]);
  expect(result.treatments[1].name).toBe("treatment-condition");
  expect(result.treatments[1].gameStages[0].elements).toEqual([
    { type: "prompt", file: "treatment.md" },
    { type: "submitButton", buttonText: "Go" },
  ]);
});

test("pattern 13: parameterized inner-template name resolved by outer fields", () => {
  // Same family as #304 but the placeholder comes from the parent's
  // `fields:`, not a broadcast. volvovsky uses this for picking
  // observerOwnTeamSuccess vs observerOtherTeamFailure.
  const treatmentFile = {
    templates: [
      { name: "ownSuccess", content: { kind: "ownSuccess" } },
      { name: "otherFailure", content: { kind: "otherFailure" } },
      {
        name: "treatmentBase",
        content: {
          name: "${treatmentName}",
          exitSequence: [{ template: "${observerName}" }],
        },
      },
    ],
    treatments: [
      {
        template: "treatmentBase",
        fields: { treatmentName: "t1", observerName: "ownSuccess" },
      },
    ],
  };
  const { result } = fillTemplates({
    obj: treatmentFile,
    templates: treatmentFile.templates,
  });
  expect(result.treatments).toEqual([
    { name: "t1", exitSequence: [{ kind: "ownSuccess" }] },
  ]);
});

// Pattern 14a/14b — both forms of template-invocation-as-fields-value
// are now rejected at parse time by `templateFieldsSchema`. The
// rejection lives in the schema test file (safeParseTreatmentFile),
// not here, since `fillTemplates` operates on already-parsed input.
// Pattern 21 (Pattern C) below is the recommended alternative for
// the use case both 14a and 14b were trying to express.

// ----- Recommended alternative to 14b -----

test("pattern 21 (Pattern C): parameterized template invocation in broadcast slot", () => {
  // The cleaner alternative to 14b. Researcher chooses which list
  // to use by passing a string `imageSet` field; the template
  // invocation lives in the broadcast slot (not in `fields:`), so
  // ordinary content-substitution resolves the name before the
  // invocation is encountered.
  const treatmentFile = {
    templates: [
      {
        name: "easySet",
        content: [{ imageFile: "easy_a.jpg" }, { imageFile: "easy_b.jpg" }],
      },
      {
        name: "hardSet",
        content: [{ imageFile: "hard_a.jpg" }, { imageFile: "hard_b.jpg" }],
      },
      {
        name: "recallTask",
        content: [{ name: "recall_${d0}", file: "${imageFile}" }],
      },
      {
        name: "treatmentBase",
        content: {
          name: "${treatmentName}",
          gameStages: [
            {
              template: "recallTask",
              broadcast: { d0: { template: "${imageSet}" } },
            },
          ],
        },
      },
    ],
    treatments: [
      {
        template: "treatmentBase",
        fields: { treatmentName: "easy", imageSet: "easySet" },
      },
      {
        template: "treatmentBase",
        fields: { treatmentName: "hard", imageSet: "hardSet" },
      },
    ],
  };
  const { result } = fillTemplates({
    obj: treatmentFile,
    templates: treatmentFile.templates,
  });
  expect(result.treatments).toHaveLength(2);
  expect(result.treatments[0].name).toBe("easy");
  expect(result.treatments[0].gameStages).toEqual([
    { name: "recall_0", file: "easy_a.jpg" },
    { name: "recall_1", file: "easy_b.jpg" },
  ]);
  expect(result.treatments[1].gameStages[0].file).toBe("hard_a.jpg");
});

// ----- Contract questions: regression guards we want even after a fix -----

test("pattern: genuinely-missing template name still throws after fix", () => {
  // Regression guard: any fix to #304 must preserve the throw for
  // truly-missing templates (typos, stale references). Only names
  // with `${...}` placeholders should be deferred.
  const templates = [{ name: "exists", content: { x: 1 } }];
  expect(() =>
    fillTemplates({ templates, obj: { template: "typoName" } }),
  ).toThrow('Template "typoName" not found');
});

test("post-fill result has no `templates:` key (definitions are build-time-only)", () => {
  // Contract: the fill result is a runtime shape. Definitions are a
  // lookup table, not output content — they're stripped before the
  // walk and never re-attached. This guards the invariant.
  const treatmentFile = {
    templates: [{ name: "stage", content: { name: "${idx}" } }],
    treatments: [{ template: "stage", fields: { idx: "1" } }],
  };
  const { result } = fillTemplates({
    obj: treatmentFile,
    templates: treatmentFile.templates,
  });
  expect(result.treatments).toEqual([{ name: "1" }]);
  expect("templates" in result).toBe(false);
});
