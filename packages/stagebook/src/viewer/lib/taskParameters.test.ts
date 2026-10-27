import { describe, it, expect } from "vitest";
import type { TreatmentFileType } from "../../schemas/index.js";
import {
  describeTaskParameterKey,
  parseTaskParameters,
  resolveTaskParameterEntry,
  type TaskParameterEntry,
} from "./taskParameters.js";
import { computePreviewState } from "./previewResolution.js";

// #815: preview a parameterized workflow against an Annotator task file.

/** Two treatments with different field sets — a task binds only its own. */
function reviewWorkflow(): TreatmentFileType {
  return {
    templates: [
      {
        name: "clipStage",
        contentType: "stage",
        content: {
          name: "review",
          duration: 60,
          elements: [
            {
              type: "mediaPlayer",
              name: "clip",
              file: "${url}",
              startAt: "${start}",
              stopAt: "${stop}",
            },
          ],
        },
      },
    ],
    treatments: [
      {
        name: "backchannel_review",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            template: "clipStage",
            fields: {
              url: "${clipUrl}",
              start: "${clipStartAt}",
              stop: "${clipStopAt}",
            },
          },
          {
            name: "transcript",
            duration: 30,
            elements: [
              { type: "display", reference: "${transcriptRef}" },
              {
                type: "prompt",
                file: "prompts/rate.prompt.md",
                showToPositions: "${positions}",
              },
            ],
          },
        ],
      },
      {
        name: "context_review",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "context",
            duration: 60,
            elements: [
              {
                type: "mediaPlayer",
                name: "context",
                file: "${contextClipUrl}",
                playVideo: "${showVideo}",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as TreatmentFileType;
}

const REVIEW_FIELDS = {
  clipUrl: "asset://solo_recordings/example.mp4",
  clipStartAt: 15.82,
  clipStopAt: 16.436,
  transcriptRef: "prompt.rate",
  positions: [0],
};

function onlyEntry(json: unknown): TaskParameterEntry {
  const parsed = parseTaskParameters(JSON.stringify(json));
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.entries).toHaveLength(1);
  return parsed.entries[0];
}

describe("parseTaskParameters", () => {
  it("reads an Annotator task-file array, keyed by callerTaskId", () => {
    const parsed = parseTaskParameters(
      JSON.stringify([
        {
          callerTaskId: "clip-01",
          treatment: "backchannel_review",
          fields: REVIEW_FIELDS,
          targetReplications: 1,
          metadata: { source: "pilot" },
        },
        {
          callerTaskId: "clip-02",
          treatment: "context_review",
          fields: { contextClipUrl: "a.mp4", showVideo: true },
        },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries.map((e) => [e.key, e.label, e.treatment])).toEqual([
      ["id:clip-01", "clip-01", "backchannel_review"],
      ["id:clip-02", "clip-02", "context_review"],
    ]);
    expect(parsed.entries.every((e) => e.problems.length === 0)).toBe(true);
  });

  it("reads an Annotator API submission body ({ tasks: [...] })", () => {
    const parsed = parseTaskParameters(
      JSON.stringify({
        tasks: [{ callerTaskId: "a", treatment: "t", fields: {} }],
      }),
    );
    expect(parsed.ok && parsed.entries.map((e) => e.key)).toEqual(["id:a"]);
  });

  it("keys entries without callerTaskId by position (GUI task-file format)", () => {
    const parsed = parseTaskParameters(
      JSON.stringify([
        { treatment: "t", fields: {}, exportPath: "", _comment: "fill in" },
        { treatment: "t", fields: { x: 1 } },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries.map((e) => [e.key, e.label])).toEqual([
      ["entry:1", "Entry 1"],
      ["entry:2", "Entry 2"],
    ]);
  });

  it("preserves JSON value types, including numeric-looking strings", () => {
    const fields = {
      start: 15.82,
      flag: true,
      list: [0, 1],
      nested: { a: { b: null } },
      empty: null,
      code: "007",
      decimal: "15.82",
    };
    const entry = onlyEntry([{ treatment: "t", fields }]);
    expect(entry.fields).toEqual(fields);
    expect(typeof entry.fields?.decimal).toBe("string");
    expect(typeof entry.fields?.start).toBe("number");
  });

  it("only binds `fields` — deployment-only keys never become bindings", () => {
    const entry = onlyEntry([
      {
        callerTaskId: "a",
        treatment: "t",
        fields: { clipUrl: "x.mp4" },
        metadata: { clipUrl: "other.mp4" },
        targetReplications: 3,
        exportPath: "out/a",
      },
    ]);
    expect(entry.fields).toEqual({ clipUrl: "x.mp4" });
  });

  it("accepts a UTF-8 byte-order mark", () => {
    const parsed = parseTaskParameters(
      String.fromCodePoint(0xfeff) + '[{"treatment":"t","fields":{}}]',
    );
    expect(parsed.ok).toBe(true);
  });

  it("reports malformed JSON with the parser's message", () => {
    const parsed = parseTaskParameters('[{"treatment": "t",}]');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/^Invalid JSON: /);
  });

  it.each([
    ["an object without tasks", { treatment: "t", fields: {} }],
    ["a string", "tasks"],
    ["a tasks key that isn't an array", { tasks: {} }],
  ])("rejects a top level that is %s", (_label, json) => {
    const parsed = parseTaskParameters(JSON.stringify(json));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/array of task entries/);
  });

  it("rejects a file with no entries", () => {
    const parsed = parseTaskParameters("[]");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/no task entries/);
  });

  it("lists structural problems per entry instead of failing the file", () => {
    const parsed = parseTaskParameters(
      JSON.stringify([
        "not an entry",
        { fields: {} },
        { treatment: "t", fields: [] },
        { treatment: "t" },
        { callerTaskId: 7, treatment: "t", fields: {} },
        { callerTaskId: "", treatment: "t", fields: {} },
        { treatment: "t", fields: {} },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries.map((e) => e.problems)).toEqual([
      ["The entry must be a JSON object."],
      ['Missing "treatment" (the name of a treatment in this workflow).'],
      ['"fields" must be an object mapping each field name to its value.'],
      ['Missing "fields" (an object mapping each field name to its value).'],
      ['"callerTaskId" must be a non-empty string.'],
      ['"callerTaskId" must be a non-empty string.'],
      [],
    ]);
  });

  it("flags every use of a repeated callerTaskId", () => {
    // Neither copy is "the" task, whatever the order: both need fixing.
    const parsed = parseTaskParameters(
      JSON.stringify([
        { callerTaskId: "a", treatment: "t", fields: {} },
        { callerTaskId: "b", treatment: "t", fields: {} },
        { callerTaskId: "a", treatment: "t", fields: { x: 1 } },
      ]),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entries.map((e) => [e.key, e.label, e.problems])).toEqual([
      ["entry:1", "Entry 1", ['Duplicate callerTaskId "a" (entries 1 and 3).']],
      ["id:b", "b", []],
      ["entry:3", "Entry 3", ['Duplicate callerTaskId "a" (entries 1 and 3).']],
    ]);
  });
});

describe("describeTaskParameterKey", () => {
  it("labels a key the way its entry is labeled", () => {
    expect(describeTaskParameterKey("id:clip-01")).toBe("clip-01");
    expect(describeTaskParameterKey("entry:3")).toBe("Entry 3");
  });
});

describe("resolveTaskParameterEntry", () => {
  it("narrows the workflow to the entry's treatment and binds its fields", () => {
    const entry = onlyEntry([
      {
        callerTaskId: "clip-01",
        treatment: "backchannel_review",
        fields: REVIEW_FIELDS,
      },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    const treatments = resolution.treatmentFile.treatments as {
      name: string;
    }[];
    expect(treatments.map((t) => t.name)).toEqual(["backchannel_review"]);
    // The other treatment's fields (contextClipUrl, showVideo) aren't
    // demanded: they belong to a treatment this task doesn't run.
    expect(resolution.fields).toEqual(REVIEW_FIELDS);
    expect(resolution.warnings).toEqual([]);
  });

  it("resolves to a valid preview with numeric playback boundaries intact", () => {
    const entry = onlyEntry([
      { treatment: "backchannel_review", fields: REVIEW_FIELDS },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    if (!resolution.ok) throw new Error(resolution.errors.join("\n"));
    const state = computePreviewState(
      resolution.treatmentFile,
      resolution.fields,
    );
    expect(state.mode).toBe("ready");
    if (state.mode !== "ready") return;
    const [stage, transcript] = (
      state.resolved.treatments as {
        gameStages: { elements: Record<string, unknown>[] }[];
      }[]
    )[0].gameStages;
    expect(stage.elements[0]).toMatchObject({
      file: "asset://solo_recordings/example.mp4",
      startAt: 15.82,
      stopAt: 16.436,
    });
    // A structured value lands as a structure, not a string.
    expect(transcript.elements[1].showToPositions).toEqual([0]);
  });

  it("binds a boolean field as a boolean", () => {
    const entry = onlyEntry([
      {
        treatment: "context_review",
        fields: { contextClipUrl: "a.mp4", showVideo: true },
      },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    if (!resolution.ok) throw new Error(resolution.errors.join("\n"));
    const state = computePreviewState(
      resolution.treatmentFile,
      resolution.fields,
    );
    expect(state.mode).toBe("ready");
    if (state.mode !== "ready") return;
    const element = (
      state.resolved.treatments as {
        gameStages: { elements: Record<string, unknown>[] }[];
      }[]
    )[0].gameStages[0].elements[0];
    expect(element.playVideo).toBe(true);
  });

  it("keeps a numeric-looking string a string, so post-fill validation names the field", () => {
    const entry = onlyEntry([
      {
        treatment: "backchannel_review",
        fields: { ...REVIEW_FIELDS, clipStartAt: "15.82" },
      },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    if (!resolution.ok) throw new Error(resolution.errors.join("\n"));
    const state = computePreviewState(
      resolution.treatmentFile,
      resolution.fields,
    );
    expect(state.mode).not.toBe("ready");
    const errors = state.mode === "ready" ? [] : state.errors;
    const startAtIssue = errors.find((e) => e.path.endsWith(".startAt"));
    expect(startAtIssue?.fields).toEqual(["clipStartAt"]);
  });

  it("reports an unknown treatment with the treatments that exist", () => {
    const entry = onlyEntry([{ treatment: "nope", fields: {} }]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    expect(resolution).toEqual({
      ok: false,
      errors: [
        'Treatment "nope" isn\'t defined in this workflow. Treatments: backchannel_review, context_review.',
      ],
    });
  });

  it("says so when the workflow has no treatments", () => {
    const entry = onlyEntry([{ treatment: "t", fields: {} }]);
    const resolution = resolveTaskParameterEntry(
      { introSequences: [] } as unknown as TreatmentFileType,
      entry,
    );
    expect(resolution).toEqual({
      ok: false,
      errors: [
        'Treatment "t" isn\'t defined in this workflow, which has no treatments.',
      ],
    });
  });

  it("never changes the parsed task file", () => {
    const parsed = parseTaskParameters(
      JSON.stringify([
        { treatment: "backchannel_review", fields: REVIEW_FIELDS },
      ]),
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const before = structuredClone(parsed.entries);
    const resolution = resolveTaskParameterEntry(
      reviewWorkflow(),
      parsed.entries[0],
    );
    if (!resolution.ok) throw new Error(resolution.errors.join("\n"));
    computePreviewState(resolution.treatmentFile, resolution.fields);
    expect(parsed.entries).toEqual(before);
  });

  it("reports each missing field by name", () => {
    const { transcriptRef: _t, clipStopAt: _s, ...partial } = REVIEW_FIELDS;
    void _t;
    void _s;
    const entry = onlyEntry([
      { treatment: "backchannel_review", fields: partial },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.errors).toEqual([
      'Missing field "clipStopAt", used by treatment "backchannel_review".',
      'Missing field "transcriptRef", used by treatment "backchannel_review".',
    ]);
  });

  it("counts host-supplied fields as provided", () => {
    const { positions: _p, ...partial } = REVIEW_FIELDS;
    void _p;
    const entry = onlyEntry([
      { treatment: "backchannel_review", fields: partial },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry, {
      positions: [0],
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.fields.positions).toEqual([0]);
  });

  it("lets the entry's value win over a host-supplied one", () => {
    const entry = onlyEntry([
      { treatment: "backchannel_review", fields: REVIEW_FIELDS },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry, {
      clipStartAt: 1,
    });
    expect(resolution.ok && resolution.fields.clipStartAt).toBe(15.82);
  });

  it("warns (without blocking) about fields the treatment doesn't use", () => {
    const entry = onlyEntry([
      {
        treatment: "backchannel_review",
        fields: { ...REVIEW_FIELDS, clipURL: "typo.mp4" },
      },
    ]);
    const resolution = resolveTaskParameterEntry(reviewWorkflow(), entry);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.warnings).toEqual([
      'Field "clipURL" isn\'t used by treatment "backchannel_review" (Annotator rejects unused fields).',
    ]);
    expect(resolution.fields).not.toHaveProperty("clipURL");
  });

  it("doesn't count inherited object properties as supplied fields", () => {
    const workflow = {
      treatments: [
        {
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: [],
          gameStages: [
            {
              name: "s",
              duration: 10,
              elements: [{ type: "display", text: "${constructor}" }],
            },
          ],
        },
      ],
    } as unknown as TreatmentFileType;
    const entry = onlyEntry([{ treatment: "t", fields: {} }]);
    expect(resolveTaskParameterEntry(workflow, entry)).toEqual({
      ok: false,
      errors: ['Missing field "constructor", used by treatment "t".'],
    });
  });

  it("binds a __proto__ field as a field, not a prototype", () => {
    const workflow = {
      treatments: [
        {
          name: "t",
          playerCount: 1,
          compatibleIntroSequences: [],
          gameStages: [
            {
              name: "s",
              duration: 10,
              elements: [{ type: "display", text: "${__proto__}" }],
            },
          ],
        },
      ],
    } as unknown as TreatmentFileType;
    const parsed = parseTaskParameters(
      '[{"treatment":"t","fields":{"__proto__":{"polluted":1}}}]',
    );
    if (!parsed.ok) throw new Error(parsed.error);
    const resolution = resolveTaskParameterEntry(workflow, parsed.entries[0]);
    if (!resolution.ok) throw new Error(resolution.errors.join("\n"));
    expect(Object.hasOwn(resolution.fields, "__proto__")).toBe(true);
    expect((resolution.fields as { polluted?: unknown }).polluted).toBe(
      undefined,
    );
  });

  it("returns an entry's structural problems as its errors", () => {
    const parsed = parseTaskParameters('[{"treatment":"backchannel_review"}]');
    if (!parsed.ok) throw new Error(parsed.error);
    const resolution = resolveTaskParameterEntry(
      reviewWorkflow(),
      parsed.entries[0],
    );
    expect(resolution).toEqual({
      ok: false,
      errors: [
        'Missing "fields" (an object mapping each field name to its value).',
      ],
    });
  });

  it("matches a treatment named by a template", () => {
    const workflow = {
      templates: [
        {
          name: "rate",
          contentType: "treatment",
          content: {
            name: "rate_${topic}",
            playerCount: 1,
            compatibleIntroSequences: [],
            gameStages: [
              {
                name: "s",
                duration: 10,
                elements: [{ type: "prompt", file: "${promptFile}" }],
              },
            ],
          },
        },
      ],
      treatments: [{ template: "rate", fields: { topic: "pets" } }],
    } as unknown as TreatmentFileType;
    const entry = onlyEntry([
      { treatment: "rate_pets", fields: { promptFile: "q.prompt.md" } },
    ]);
    const resolution = resolveTaskParameterEntry(workflow, entry);
    expect(resolution.ok).toBe(true);
  });
});
