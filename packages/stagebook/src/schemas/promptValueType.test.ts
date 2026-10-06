import { describe, expect, test } from "vitest";
import { promptValueType as publicPromptValueType } from "../index.js";
import { buildPromptRecord } from "../utils/buildPromptRecord.js";
import { promptFileSchema, promptValueType } from "./promptFile.js";

describe("promptValueType", () => {
  test.each([
    {
      mode: "free text",
      metadata: "type: openResponse",
      responses: "> Type your answer",
      expected: "string",
    },
    {
      mode: "free text with a numeric-looking placeholder",
      metadata: "type: openResponse",
      responses: "> 100",
      expected: "string",
    },
    {
      mode: "numeric entry",
      metadata: "type: numericResponse",
      expected: "number",
    },
    {
      mode: "integer-only numeric entry",
      metadata: "type: numericResponse\ninteger: true",
      expected: "number",
    },
    {
      mode: "required numeric entry",
      metadata: "type: numericResponse\nrequired: true",
      expected: "number",
    },
    {
      mode: "required free text",
      metadata: "type: openResponse\nrequired: true",
      responses: "> Type your answer",
      expected: "string",
    },
    {
      mode: "numeric slider",
      metadata: "type: slider\nmin: 0\nmax: 10\ninterval: 1",
      responses: "- 0: Low\n- 10: High",
      expected: "number",
    },
    {
      mode: "default single-select text choices",
      metadata: "type: multipleChoice",
      responses: "- Yes\n- No",
      expected: "string",
    },
    {
      mode: "explicit single-select text choices",
      metadata: "type: multipleChoice\nselect: single",
      responses: "- Yes\n- No",
      expected: "string",
    },
    {
      mode: "single-select numeric choices",
      metadata: "type: multipleChoice\nselect: single",
      responses: "- 0: No\n- 1: Yes",
      expected: "number",
    },
    {
      mode: "single-select signed fractional numeric choices",
      metadata: "type: multipleChoice",
      responses: "- -0.25: Low\n- 0.75: High",
      expected: "number",
    },
    {
      mode: "single-select numeric-looking text choices",
      metadata: "type: multipleChoice",
      responses: "- 0\n- 1",
      expected: "string",
    },
    {
      mode: "multi-select text checklist",
      metadata: "type: multipleChoice\nselect: multiple",
      responses: "- Yes\n- No",
      expected: "string[]",
    },
    {
      mode: "multi-select numeric-looking text checklist",
      metadata: "type: multipleChoice\nselect: multiple",
      responses: "- 0\n- 1",
      expected: "string[]",
    },
    {
      mode: "dropdown text choices",
      metadata: "type: dropdown",
      responses: "- Yes\n- No",
      expected: "string",
    },
    {
      mode: "dropdown choices with numeric prefixes",
      metadata: "type: dropdown",
      responses: "- 0: No\n- 1: Yes",
      expected: "string",
    },
    {
      mode: "ordered text list",
      metadata: "type: listSorter",
      responses: "- First\n- Second",
      expected: "string[]",
    },
    {
      mode: "ordered list with numeric prefixes",
      metadata: "type: listSorter",
      responses: "- 1: First\n- 2: Second",
      expected: "string[]",
    },
    {
      mode: "display-only prompt",
      metadata: "type: noResponse",
      expected: undefined,
    },
  ])("$mode has value type $expected", ({ metadata, responses, expected }) => {
    const source = `---\n${metadata}\n---\nQuestion${responses === undefined ? "" : `\n---\n${responses}`}`;
    const prompt = promptFileSchema.parse(source);

    expect(promptValueType(prompt)).toBe(expected);
  });

  test("is available from the React-free public entrypoint", () => {
    expect(publicPromptValueType).toBeTypeOf("function");
    expect(publicPromptValueType).toBe(promptValueType);
  });

  test.each([
    { entry: "", value: undefined, isValid: false },
    { entry: "not a number", value: undefined, isValid: false },
    { entry: "-", value: undefined, isValid: false },
    { entry: "12", value: 12, isValid: false },
    { entry: "5", value: 5, isValid: true },
  ])(
    "numeric entry $entry keeps its declared type with saved value $value and validity $isValid",
    ({ entry, value, isValid }) => {
      const prompt = promptFileSchema.parse(
        "---\ntype: numericResponse\nrequired: true\nmin: 0\nmax: 10\n---\nEstimate",
      );
      const record = buildPromptRecord({
        metadata: prompt.metadata,
        name: "estimate",
        body: prompt.body,
        responses: prompt.responseItems,
        entry,
        numberFormat: { decimal: ".", grouping: "," },
      });

      if (value === undefined) expect(record).not.toHaveProperty("value");
      else expect(record.value).toBe(value);
      expect(record.isValid).toBe(isValid);
      expect(promptValueType(prompt)).toBe("number");
    },
  );
});
