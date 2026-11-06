import { describe, expect, test } from "vitest";
import {
  resolvedElementSchema,
  resolvedStageSchema,
  resolvedTreatmentSchema,
  resolvedTreatmentFileSchema,
  safeParseResolvedTreatmentFile,
  validateResolvedTreatmentFile,
} from "./index.js";
import {
  getValidKeysForElementType,
  getValidKeysForStage,
  getValidKeysForTreatment,
  treatmentFileSchema,
  validElementTypes,
} from "./treatment.js";

const note = "RESEARCHER_ONLY_RATIONALE";
const button = { type: "submitButton", buttonText: "Continue", notes: note };
const step = { name: "step", notes: note, elements: [button] };
const media = {
  type: "mediaPlayer",
  name: "clip",
  file: "clip.mp4",
  playback: "manual",
};
const timeline = {
  type: "timeline",
  name: "annotation",
  source: "clip",
  selectionType: "range",
  selectionScope: "all",
  multiSelect: true,
  showWaveform: true,
  trackLabels: ["Participant"],
};
const conditions = {
  all: {
    reference: "everyone.entryUrl.params.variant",
    comparator: "equals",
    value: "media",
  },
};
const file = {
  imports: ["library.stagebook.yaml"],
  templates: [
    {
      name: "buttonTemplate",
      contentType: "element",
      notes: note,
      content: button,
    },
  ],
  consent: [{ name: "consent", locale: "en-US", notes: note, steps: [step] }],
  introSequences: [{ name: "intro", notes: note, introSteps: [step] }],
  treatments: [
    {
      name: "study",
      notes: note,
      playerCount: 1,
      compatibleIntroSequences: ["intro"],
      gameStages: [
        {
          name: "stage",
          notes: note,
          duration: 30,
          conditions,
          elements: [
            { ...media, notes: note },
            { ...timeline, notes: note },
          ],
        },
      ],
      exitSequence: [step],
    },
  ],
};

function expectNoNotes(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.keys(value)).not.toContain("notes");
  Object.values(value).forEach(expectNoNotes);
}

describe("resolved participant output (#821)", () => {
  test("preserves valid runtime fields while removing all authoring metadata", () => {
    expect(treatmentFileSchema.safeParse(file).success).toBe(true);
    const original = structuredClone(file);
    const parsed = resolvedTreatmentFileSchema.parse(file);
    const stage = parsed.treatments![0].gameStages[0];
    expect(stage).toEqual({
      name: "stage",
      duration: 30,
      conditions,
      elements: [media, timeline],
    });
    expect(parsed.consent![0]).toMatchObject({
      name: "consent",
      locale: "en-US",
      steps: [
        {
          name: "step",
          elements: [{ type: "submitButton", buttonText: "Continue" }],
        },
      ],
    });
    expect(parsed.introSequences![0].introSteps[0].elements[0].buttonText).toBe(
      "Continue",
    );
    expect(parsed.treatments![0].exitSequence![0].elements[0].buttonText).toBe(
      "Continue",
    );
    expectNoNotes(parsed);
    expect(parsed).not.toHaveProperty("imports");
    expect(parsed).not.toHaveProperty("templates");
    expect(file).toEqual(original);
  });

  test("declares every authoring runtime field in the resolved schemas", () => {
    // Keep this tied to authoring declarations so a newly added field cannot
    // silently vanish at the participant publication boundary again.
    for (const type of validElementTypes) {
      for (const key of getValidKeysForElementType(type)!) {
        if (key !== "notes")
          expect(resolvedElementSchema.shape).toHaveProperty(key);
      }
    }
    for (const key of getValidKeysForStage()) {
      if (key !== "notes")
        expect(resolvedStageSchema.shape).toHaveProperty(key);
    }
    for (const key of getValidKeysForTreatment()) {
      if (key !== "notes")
        expect(resolvedTreatmentSchema.shape).toHaveProperty(key);
    }
  });

  test("returns sanitized data through the public strict parser", () => {
    const result = safeParseResolvedTreatmentFile(file);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(result.data).toEqual(resolvedTreatmentFileSchema.parse(file));
    expect(result.issues).toEqual([]);
  });

  test("preserves arbitrary option records, even keys named notes", () => {
    const discussion = {
      chatType: "video",
      showNickname: false,
      showTitle: false,
      layout: {
        0: {
          grid: { rows: 1, cols: 1 },
          feeds: [
            {
              source: { type: "self" },
              displayRegion: { rows: 0, cols: 0 },
              options: { notes: "application data", nested: { notes: 42 } },
            },
          ],
        },
      },
    };
    const input = structuredClone(file);
    Object.assign(input.treatments[0].gameStages[0], { discussion });
    const result = safeParseResolvedTreatmentFile(input);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(JSON.stringify(result.issues));
    expect(
      result.data.treatments![0].gameStages[0].discussion?.layout?.[0].feeds[0]
        .options,
    ).toEqual(discussion.layout[0].feeds[0].options);
  });

  test.each([
    ["structure", { treatments: "not an array" }],
    [
      "placeholder",
      {
        introSequences: [
          {
            name: "intro",
            introSteps: [
              {
                name: "step",
                elements: [{ type: "submitButton", buttonText: "${unbound}" }],
              },
            ],
          },
        ],
      },
    ],
    [
      "expression types",
      {
        treatments: [
          {
            ...file.treatments[0],
            gameStages: [
              {
                ...file.treatments[0].gameStages[0],
                conditions: {
                  all: {
                    reference: "everyone.attributes.isKnownVpn",
                    comparator: "equals",
                    value: "yes",
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  ])("withholds data on %s errors", (label, input) => {
    const result = safeParseResolvedTreatmentFile(input);
    expect(result.success).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    // The schema alone accepts the placeholder and expression-type inputs:
    // the reason shows which later check withheld the data.
    const reason = {
      placeholder: "unresolved-placeholder",
      "expression types": "expression-type",
    }[label];
    if (reason !== undefined) {
      expect(result.issues.map((issue) => issue.reason)).toContain(reason);
    }
    expect(result).not.toHaveProperty("data");
  });

  test("never turns preview validation into participant-safe data", () => {
    const input = {
      introSequences: [
        {
          name: "intro",
          introSteps: [
            {
              name: "step",
              elements: [{ type: "submitButton", buttonText: "${unbound}" }],
            },
          ],
        },
      ],
    };
    expect(
      validateResolvedTreatmentFile(input, { skipUnresolved: true }),
    ).toEqual({ success: true, issues: [] });
    // An untyped host or a variable with extra properties cannot relax the
    // strict parser by passing the preview-only option at runtime.
    const previewOptions = { skipUnresolved: true, promptFiles: new Map() };
    const result = safeParseResolvedTreatmentFile(input, previewOptions);
    expect(result.success).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toContain(
      "unresolved-placeholder",
    );
    expect(result).not.toHaveProperty("data");
  });
});
