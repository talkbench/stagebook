import { describe, expect, test } from "vitest";
import { buildPromptRecord } from "./buildPromptRecord.js";
import { checkResponse } from "./checkResponse.js";
import type { MetadataType } from "../schemas/promptFile.js";

const numberFormat = { decimal: ".", grouping: "," };
const base = {
  metadata: {
    type: "numericResponse",
    min: 18,
    max: 20,
    required: true,
    suffix: "years",
  } as MetadataType,
  name: "age",
  file: "age.prompt.md",
  body: "How old?",
  responses: [],
  numberFormat,
};

describe("numeric buildPromptRecord", () => {
  test("builds a complete numeric record from entry, including an out-of-range value", () => {
    expect(
      buildPromptRecord({
        ...base,
        entry: "00025",
        value: 42,
        debugMessages: [{ type: "pasteAttempt", length: 5, timestamp: 1 }],
        step: "game_1",
        stageTimeElapsed: 0,
      }),
    ).toEqual({
      type: "numericResponse",
      min: 18,
      max: 20,
      required: true,
      suffix: "years",
      name: "age",
      file: "age.prompt.md",
      shared: false,
      prompt: "How old?",
      responses: [],
      debugMessages: [{ type: "pasteAttempt", length: 5, timestamp: 1 }],
      entry: "00025",
      numberFormat,
      value: 25,
      isValid: false,
      step: "game_1",
      stageTimeElapsed: 0,
    });
  });
  test.each(["", " ", "5.", "3-4", "1234567890123456", "9".repeat(400)])(
    "%j has no value property and cannot retain an old numeric value",
    (entry) => {
      const record = buildPromptRecord({ ...base, entry, value: 25 });
      expect(record).not.toHaveProperty("value");
      expect(record.entry).toBe(entry);
      expect(record.isValid).toBe(false);
    },
  );
  test("blank optional differs from malformed despite both lacking value", () => {
    const metadata: MetadataType = { type: "numericResponse" };
    expect(buildPromptRecord({ ...base, metadata, entry: "" })).toMatchObject({
      entry: "",
      isValid: true,
    });
    expect(
      buildPromptRecord({ ...base, metadata, entry: "3-4" }),
    ).toMatchObject({ entry: "3-4", isValid: false });
  });
  test("keeps a parsed noninteger value without rounding", () => {
    expect(
      buildPromptRecord({
        ...base,
        metadata: { type: "numericResponse", integer: true },
        entry: "3.5",
      }),
    ).toMatchObject({ value: 3.5, isValid: false });
  });
  test("normalizes minus zero and preserves zero-valued commit context", () => {
    const record = buildPromptRecord({
      ...base,
      metadata: { type: "numericResponse" },
      entry: "-0",
      stageTimeElapsed: 0,
    });
    expect(Object.is(record.value, 0)).toBe(true);
    expect(record.entry).toBe("-0");
    expect(record.stageTimeElapsed).toBe(0);
  });
  test("shared numeric includes group validity but excludes participant telemetry", () => {
    expect(
      buildPromptRecord({
        ...base,
        entry: "19",
        shared: true,
        debugMessages: [{ type: "pasteAttempt", length: 5, timestamp: 1 }],
      }),
    ).toMatchObject({
      entry: "19",
      value: 19,
      isValid: true,
      shared: true,
      debugMessages: [],
      numberFormat,
    });
  });
  test.each([
    "007",
    "5.",
    "1,5",
    "3-4",
    "",
    "0".repeat(1200),
    " ".repeat(1200),
  ])(
    "%j recomputes identically from stored entry and effective format",
    (entry) => {
      const format = { decimal: ",", grouping: "." };
      const record = buildPromptRecord({
        ...base,
        entry,
        numberFormat: format,
      });
      expect(record.entry).toBe(entry.slice(0, 1000));
      expect(record.numberFormat).toEqual(format);
      expect(record.isValid).toBe(
        checkResponse(record.entry, {
          type: "numericResponse",
          numberFormat: format,
          min: 18,
          max: 20,
          required: true,
        }).isValid,
      );
      if (entry.length > 100) expect(record).not.toHaveProperty("value");
    },
  );
  test("snapshots number format so a later caller mutation cannot reinterpret the saved entry", () => {
    const format = { decimal: ",", grouping: "." };
    const record = buildPromptRecord({
      ...base,
      entry: "1,5",
      numberFormat: format,
    });
    format.decimal = ".";
    expect(record.numberFormat).toEqual({ decimal: ",", grouping: "." });
    expect(record.value).toBe(1.5);
  });
  test("openResponse continues to save strings without numeric fields", () => {
    const record = buildPromptRecord({
      ...base,
      metadata: { type: "openResponse" },
      value: "00123",
    });
    expect(record.value).toBe("00123");
    expect(record).not.toHaveProperty("entry");
    expect(record).not.toHaveProperty("numberFormat");
  });
});
