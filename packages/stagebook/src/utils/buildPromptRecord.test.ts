import { describe, expect, test } from "vitest";
import { buildPromptRecord } from "./index.js";
import type { MetadataType } from "../schemas/promptFile.js";
import type { DebugMessage } from "./promptTelemetry.js";

const base = {
  metadata: {
    type: "openResponse",
    name: "frontmatter name",
    rows: 3,
    required: true,
    minLength: 5,
  } as MetadataType,
  name: "answer",
  file: "q.prompt.md",
  body: "Question body",
  responses: ["Hint"],
  value: "short",
};
const debugMessages: DebugMessage[] = [
  { type: "pasteAttempt", length: 10, timestamp: 42 },
];

describe("buildPromptRecord (#697)", () => {
  test("builds the complete player record with commit-time context", () => {
    expect(
      buildPromptRecord({
        ...base,
        debugMessages,
        step: "game_2",
        stageTimeElapsed: 8.5,
      }),
    ).toEqual({
      type: "openResponse",
      name: "answer",
      rows: 3,
      required: true,
      minLength: 5,
      file: "q.prompt.md",
      shared: false,
      prompt: "Question body",
      responses: ["Hint"],
      debugMessages,
      value: "short",
      isValid: true,
      step: "game_2",
      stageTimeElapsed: 8.5,
    });
  });

  test.each([
    ["", { type: "openResponse", required: true }, false],
    ["   ", { type: "openResponse", minLength: 5 }, true],
    ["abc", { type: "openResponse", minLength: 5 }, false],
    ["abcde", { type: "openResponse", maxLength: 5 }, true],
    ["abcdef", { type: "openResponse", maxLength: 5 }, false],
    [
      [],
      {
        type: "multipleChoice",
        select: "multiple",
        layout: "vertical",
        required: true,
      },
      false,
    ],
    [
      0,
      {
        type: "multipleChoice",
        select: "single",
        layout: "vertical",
        required: true,
      },
      true,
    ],
    ["yes", { type: "dropdown", placeholder: "Choose", required: true }, true],
    [0, { type: "slider", min: 0, max: 10, interval: 1 }, true],
    [["B", "A"], { type: "listSorter" }, true],
  ])("derives validity for %j from %j", (value, metadata, isValid) => {
    const record = buildPromptRecord({
      ...base,
      metadata: metadata as MetadataType,
      value,
    });
    expect(record.value).toEqual(value);
    expect(record.isValid).toBe(isValid);
  });

  test.each(["", "merged answer"])(
    "shared open response %j has no validity or telemetry",
    (value) => {
      const record = buildPromptRecord({
        ...base,
        metadata: { type: "openResponse" },
        value,
        shared: true,
        debugMessages,
        step: "game_2",
        stageTimeElapsed: 8.5,
      });
      expect(record).toEqual({
        type: "openResponse",
        name: "answer",
        file: "q.prompt.md",
        shared: true,
        prompt: "Question body",
        responses: ["Hint"],
        debugMessages: [],
        value,
        step: "game_2",
        stageTimeElapsed: 8.5,
      });
      expect(record).not.toHaveProperty("isValid");
    },
  );

  test("preserves optional labels including empty strings and numeric zero values", () => {
    const metadata: MetadataType = {
      type: "multipleChoice",
      select: "single",
      layout: "vertical",
    };
    expect(
      buildPromptRecord({ ...base, metadata, value: 0, label: "None" }),
    ).toMatchObject({ value: 0, label: "None", isValid: true });
    expect(buildPromptRecord({ ...base, label: "" }).label).toBe("");
    expect(buildPromptRecord(base)).not.toHaveProperty("label");
  });

  test("defaults telemetry and omits context unless supplied, retaining zero elapsed time", () => {
    const record = buildPromptRecord({ ...base, file: undefined });
    expect(record).toHaveProperty("file", undefined);
    expect(record.shared).toBe(false);
    expect(record.debugMessages).toEqual([]);
    expect(record).not.toHaveProperty("step");
    expect(record).not.toHaveProperty("stageTimeElapsed");
    expect(
      buildPromptRecord({ ...base, step: "", stageTimeElapsed: 0 }),
    ).toMatchObject({ step: "", stageTimeElapsed: 0 });
  });

  test("snapshots response and telemetry arrays without modifying caller data", () => {
    const responses = ["Hint"];
    const telemetry = [...debugMessages];
    const record = buildPromptRecord({
      ...base,
      responses,
      debugMessages: telemetry,
    });
    responses.push("Another hint");
    telemetry.push({ type: "pasteAttempt", length: 20, timestamp: 43 });
    expect(record.responses).toEqual(["Hint"]);
    expect(record.debugMessages).toEqual(debugMessages);
    expect(base.metadata.name).toBe("frontmatter name");
  });
});
