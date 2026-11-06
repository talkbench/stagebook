import { describe, expect, test } from "vitest";
import { buildPromptRecord, type FieldTiming } from "./index.js";
import type { MetadataType } from "../schemas/promptFile.js";

const base = {
  name: "answer",
  body: "Question",
  responses: [],
  value: "reply",
  entry: "1",
  numberFormat: { decimal: ".", grouping: "," },
};
const fieldTiming: FieldTiming = {
  version: 1,
  firstFocusDelayMs: 250,
  firstFocusStageTimeElapsed: 2.5,
};
const textMetadata: MetadataType[] = [
  { type: "openResponse" },
  { type: "numericResponse" },
];
const otherMetadata: MetadataType[] = [
  { type: "noResponse" },
  { type: "multipleChoice", select: "single", layout: "vertical" },
  { type: "dropdown", placeholder: "Choose" },
  { type: "slider", min: 0, max: 10, interval: 1 },
  { type: "listSorter" },
];

describe("buildPromptRecord field timing (#831)", () => {
  test.each(textMetadata)("snapshots timing for a solo $type", (metadata) => {
    const supplied = { ...fieldTiming };
    const record = buildPromptRecord({
      ...base,
      metadata,
      fieldTiming: supplied,
    });

    expect(record.fieldTiming).toEqual(fieldTiming);
    expect(record.fieldTiming).not.toBe(supplied);
    supplied.firstFocusDelayMs = 999;
    expect(record.fieldTiming?.firstFocusDelayMs).toBe(250);
  });

  test.each([
    {
      version: 1 as const,
      firstFocusDelayMs: null,
      firstFocusStageTimeElapsed: null,
    },
    {
      version: 1 as const,
      firstFocusDelayMs: 0,
      firstFocusStageTimeElapsed: 0,
    },
  ])("preserves unfocused and immediate-focus values: %j", (timing) => {
    expect(
      buildPromptRecord({
        ...base,
        metadata: { type: "openResponse" },
        fieldTiming: timing,
      }).fieldTiming,
    ).toEqual(timing);
  });

  test.each(textMetadata)("omits timing from shared $type", (metadata) => {
    const suppliedMetadata = { ...metadata, fieldTiming };
    expect(
      buildPromptRecord({
        ...base,
        metadata: suppliedMetadata,
        shared: true,
        fieldTiming,
      }),
    ).not.toHaveProperty("fieldTiming");
  });

  test.each(otherMetadata)("omits supplied timing from $type", (metadata) => {
    expect(
      buildPromptRecord({ ...base, metadata, fieldTiming }),
    ).not.toHaveProperty("fieldTiming");
  });

  test.each([...textMetadata, ...otherMetadata])(
    "ignores timing in $type metadata and leaves the caller unchanged",
    (metadata) => {
      const suppliedMetadata = { ...metadata, fieldTiming };
      expect(
        buildPromptRecord({ ...base, metadata: suppliedMetadata }),
      ).not.toHaveProperty("fieldTiming");
      expect(suppliedMetadata.fieldTiming).toBe(fieldTiming);
    },
  );

  test.each(textMetadata)("preserves legacy omission for $type", (metadata) => {
    expect(buildPromptRecord({ ...base, metadata })).not.toHaveProperty(
      "fieldTiming",
    );
  });
});
