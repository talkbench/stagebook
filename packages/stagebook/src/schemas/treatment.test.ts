import { expect, test } from "vitest";

import {
  referenceSchema,
  conditionSchema,
  conditionsSchema,
  discussionSchema,
  elementsSchema,
  elementSchema,
  introExitStepSchema,
  introStepsSchema,
  exitStepsSchema,
  mediaPlayerSchema,
  stageSchema,
  timelineSchema,
  promptSchema,
  templateSchema,
  treatmentFileSchema,
  browserUrlSchema,
  fileSchema,
} from "./treatment.js";
import { fillTemplates } from "../templates/fillTemplates.js";
import { resolvedTreatmentSchema } from "./resolved.js";

// ----------- Reference Schema ------------
test("reference with valid prompt", () => {
  const reference = "self.prompt.namedPrompt";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference with valid survey", () => {
  const reference = "self.survey.namedSurvey.results.namedResult";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference with invalid type", () => {
  const reference = "duck.namedPrompt";
  const result = referenceSchema.safeParse(reference);
  if (!result.success)
    console.log(result.error.message, "\npath:", result.error.path);
  expect(result.success).toBe(false);
});

test("reference prompt with no name", () => {
  const reference = "prompt";
  const result = referenceSchema.safeParse(reference);
  if (!result.success)
    console.log(result.error.message, "\npath:", result.error.path);
  expect(result.success).toBe(false);
});

test("reference survey with no path is now valid (named source — path is optional, #240)", () => {
  const reference = "self.survey.namedSurvey";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference tracked link with name", () => {
  const reference = "self.trackedLink.followUp.events";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference timeline with name", () => {
  const reference = "self.timeline.storySegment";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference timeline with nested path", () => {
  const reference = "self.timeline.storySegment.0.start";
  const result = referenceSchema.safeParse(reference);
  if (!result.success) console.log(result.error);
  expect(result.success).toBe(true);
});

test("reference timeline with no name", () => {
  const reference = "self.timeline";
  const result = referenceSchema.safeParse(reference);
  if (!result.success)
    console.log(result.error.message, "\npath:", result.error.path);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0].message).toContain("A name must be provided");
  }
});

// ----------- Condition Schema ------------

test("validCondition", () => {
  const condition = {
    reference: "1.prompt.namedPrompt",
    comparator: "equals",
    value: "value",
  };
  const result = conditionSchema.safeParse(condition);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("condition missing required value", () => {
  const condition = {
    reference: "duck.namedPrompt",
    position: 1,
    comparator: "matches",
  };
  const result = conditionSchema.safeParse(condition);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(false);
});

// ----------- Small schemas ------------

test("break name requirements", () => {
  const element = {
    type: "prompt",
    name: "This name has !!! some serious \\ issues that *(&@#$( need fixing 123 and change to fill in the 64 character limit etc etc etc etc",
    file: "projects/example/testDisplay00.prompt.md",
  };
  const result = promptSchema.safeParse(element);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(false);
});

test("prompt file must use .prompt.md extension", () => {
  const element = {
    type: "prompt",
    file: "projects/example/consent.md",
  };
  const result = promptSchema.safeParse(element);
  expect(result.success).toBe(false);
});

// ----------- Element schemas ------------
test("prompt element validation", () => {
  const element = {
    type: "prompt",
    name: "namedPrompt",
    file: "projects/example/testDisplay00.prompt.md",
    conditions: [
      {
        reference: "1.prompt.namedPrompt",
        comparator: "equals",
        value: "value",
      },
      {
        reference: "2.prompt.namedPrompt",
        comparator: "equals",
        value: "value2",
      },
    ],
  };
  const result = promptSchema.safeParse(element);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("audio element validation", () => {
  const elements = [
    {
      type: "audio",
      file: "projects/shared/chime.mp3",
    },
  ];
  const result = elementsSchema.safeParse(elements);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("multiple elements validation", () => {
  const elements = [
    {
      type: "prompt",
      file: "projects/example/testDisplay00.prompt.md",
    },
    {
      type: "prompt",
      name: "namedPrompt2",
      file: "projects/example/testDisplay01.prompt.md",
      conditions: [
        {
          reference: "1.prompt.namedPrompt",
          comparator: "equals",
          value: "value",
        },
        {
          reference: "2.prompt.namedPrompt",
          comparator: "equals",
          value: "value2",
        },
      ],
    },
  ];
  const result = elementsSchema.safeParse(elements);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("tracked link element validation", () => {
  const elements = [
    {
      type: "trackedLink",
      name: "signup_link",
      url: "https://example.org",
      displayText: "Open signup form",
      urlParams: [
        { key: "token", value: "abc123" },
        {
          key: "name",
          reference: "self.prompt.namedPrompt",
        },
      ],
    },
  ];
  const result = elementsSchema.safeParse(elements);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("tracked link with custom helperText", () => {
  const elements = [
    {
      type: "trackedLink",
      name: "signup_link",
      url: "https://example.org",
      displayText: "Open signup form",
      helperText: "You'll need about 5 minutes. Return here when done.",
    },
  ];
  const result = elementsSchema.safeParse(elements);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("tracked link rejects non-string helperText", () => {
  const elements = [
    {
      type: "trackedLink",
      name: "signup_link",
      url: "https://example.org",
      displayText: "Open signup form",
      helperText: 42,
    },
  ];
  const result = elementsSchema.safeParse(elements);
  expect(result.success).toBe(false);
});

test("validate entire file", () => {
  const fileJson = {
    templates: [
      {
        name: "template1",
        contentType: "element",
        content: {
          type: "prompt",
          name: "namedPrompt",
          file: "projects/example/testDisplay00.prompt.md",
        },
      },
    ],
    introSequences: [
      {
        name: "intro1",
        introSteps: [
          {
            name: "introStep1",
            elements: [
              {
                type: "prompt",
                name: "introNamedPrompt",
                file: "projects/example/testDisplay00.prompt.md",
                conditions: [
                  {
                    reference: "self.prompt.introNamedPrompt",
                    comparator: "equals",
                    value: "value",
                  },
                ],
              },
              {
                type: "submitButton",
                buttonText: "Continue",
              },
            ],
          },
        ],
      },
    ],
    treatments: [
      {
        name: "treatment1",
        playerCount: 2,
        groupComposition: [
          { position: 0, title: "Bill" },
          { position: 1, title: "Ted" },
        ],
        gameStages: [
          {
            name: "stage1",
            duration: 10,
            elements: [
              {
                type: "prompt",
                name: "namedPrompt",
                file: "projects/example/testDisplay00.prompt.md",
                conditions: [
                  {
                    reference: "1.prompt.namedPrompt",
                    comparator: "equals",
                    value: "value",
                  },
                  {
                    reference: "2.prompt.namedPrompt",
                    comparator: "equals",
                    value: "value2",
                  },
                ],
              },
              {
                type: "prompt",
                name: "namedPrompt2",
                file: "projects/example/testDisplay01.prompt.md",
                conditions: [
                  {
                    reference: "1.prompt.namedPrompt",
                    comparator: "equals",
                    value: "value",
                  },
                  {
                    reference: "2.prompt.namedPrompt",
                    comparator: "equals",
                    value: "value2",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const result = treatmentFileSchema.safeParse(fileJson);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("treatment accepts an optional notes field with Markdown", () => {
  const fileJson = {
    introSequences: [
      {
        name: "introSequence1",
        introSteps: [
          {
            name: "introStep1",
            elements: [{ type: "submitButton", buttonText: "Continue" }],
          },
        ],
      },
    ],
    treatments: [
      {
        name: "treatment1",
        notes: "A **markdown** description of what this treatment does.",
        playerCount: 1,
        gameStages: [
          {
            name: "stage1",
            duration: 10,
            elements: [
              {
                type: "prompt",
                file: "x.prompt.md",
              },
            ],
          },
        ],
      },
    ],
  };
  const result = treatmentFileSchema.safeParse(fileJson);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
  if (result.success) {
    const treatments = result.data.treatments as { notes?: string }[];
    expect(treatments[0].notes).toBe(
      "A **markdown** description of what this treatment does.",
    );
  }
});

// ----------- Discussion Schema with conditions ------------

test("discussion with conditions is valid", () => {
  // After #238, condition leaves use a slot-index `position` instead
  // of the dropped aggregator `"all"`. The boolean-tree operators
  // (#235) handle fan-out across players; this single-leaf example
  // keeps the original intent (gate the discussion on a specific
  // player's prompt response).
  const discussion = {
    chatType: "text",
    showNickname: true,
    showTitle: true,
    conditions: [
      {
        reference: "0.prompt.setupChoice",
        comparator: "equals",
        value: "HTML",
      },
    ],
  };
  const result = discussionSchema.safeParse(discussion);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("discussion with multiple conditions is valid", () => {
  const discussion = {
    chatType: "video",
    showNickname: true,
    showTitle: true,
    conditions: [
      {
        reference: "0.prompt.setupChoice",
        comparator: "equals",
        value: "HTML",
      },
      {
        reference: "self.survey.priorRound.responses.consensus",
        comparator: "doesNotEqual",
        value: "yes",
      },
    ],
  };
  const result = discussionSchema.safeParse(discussion);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("discussion without conditions is still valid", () => {
  const discussion = {
    chatType: "video",
    showNickname: true,
    showTitle: true,
  };
  const result = discussionSchema.safeParse(discussion);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("discussion with empty conditions array is invalid", () => {
  const discussion = {
    chatType: "text",
    showNickname: true,
    showTitle: true,
    conditions: [],
  };
  const result = discussionSchema.safeParse(discussion);
  expect(result.success).toBe(false);
});

test("discussion with invalid condition is invalid", () => {
  const discussion = {
    chatType: "text",
    showNickname: true,
    showTitle: true,
    conditions: [
      {
        reference: "duck.invalidRef",
        comparator: "equals",
        value: "test",
      },
    ],
  };
  const result = discussionSchema.safeParse(discussion);
  expect(result.success).toBe(false);
});

// ----------- mediaPlayerSchema ------------

test("mediaPlayer: minimal valid config (url only)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "https://youtu.be/QC8iQqtG0hg",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: relative path url is valid", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: asset:// file is valid (platform-provided)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "asset://group_recordings/training_video.mp4",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

// --- browserUrlSchema (used by qualtrics.url and trackedLink.url, #249) ---
//
// Browser-direct URL fields: the browser navigates / loads the iframe at
// this URL. http(s)://… only — `asset://` is rejected because the browser
// has no way to resolve it on a direct load (the host's `getAssetURL()`
// resolver runs platform-side, unreachable from a browser-direct path).

test("browserUrlSchema accepts https://", () => {
  expect(browserUrlSchema.safeParse("https://example.com/foo").success).toBe(
    true,
  );
});

test("browserUrlSchema accepts http://", () => {
  expect(browserUrlSchema.safeParse("http://example.com/foo").success).toBe(
    true,
  );
});

test("browserUrlSchema rejects asset:// (now fileSchema-only)", () => {
  expect(
    browserUrlSchema.safeParse("asset://group_recordings/training.mp4").success,
  ).toBe(false);
});

test("browserUrlSchema rejects ftp:// and other non-allowed protocols", () => {
  expect(browserUrlSchema.safeParse("ftp://example.com/clip.mp4").success).toBe(
    false,
  );
  expect(browserUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
  expect(browserUrlSchema.safeParse("file:///etc/passwd").success).toBe(false);
});

test("browserUrlSchema rejects non-URL strings", () => {
  expect(browserUrlSchema.safeParse("not a url").success).toBe(false);
  expect(browserUrlSchema.safeParse("").success).toBe(false);
});

test("browserUrlSchema rejects opaque-scheme URLs without //", () => {
  expect(browserUrlSchema.safeParse("https:example.com").success).toBe(false);
  expect(browserUrlSchema.safeParse("http:foo").success).toBe(false);
});

test("browserUrlSchema rejects http(s):// with an empty host", () => {
  expect(browserUrlSchema.safeParse("https://").success).toBe(false);
  expect(browserUrlSchema.safeParse("http://").success).toBe(false);
});

// --- fileSchema (used by every `file:` field in the schema, #249) ---
//
// File fields are platform-resolved: the host's loader handles relative
// paths (relative to the treatment file's directory), `asset://` URIs
// (via `getAssetURL()`), and bare `https?://` URLs (passed straight to
// the browser).

test("fileSchema accepts a relative path", () => {
  expect(fileSchema.safeParse("prompts/foo.prompt.md").success).toBe(true);
  expect(fileSchema.safeParse("clips/intro.mp4").success).toBe(true);
});

test("fileSchema accepts asset:// URIs", () => {
  expect(fileSchema.safeParse("asset://clips/clip1.mp4").success).toBe(true);
  expect(fileSchema.safeParse("ASSET://clip.mp4").success).toBe(true);
});

test("fileSchema accepts http(s):// URLs", () => {
  expect(fileSchema.safeParse("https://cdn.example.com/clip.mp4").success).toBe(
    true,
  );
  expect(fileSchema.safeParse("http://example.com/x.png").success).toBe(true);
});

test("fileSchema rejects an empty string", () => {
  expect(fileSchema.safeParse("").success).toBe(false);
});

test("fileSchema rejects a whitespace-only string", () => {
  expect(fileSchema.safeParse("   ").success).toBe(false);
  expect(fileSchema.safeParse("\t\n").success).toBe(false);
});

test("fileSchema rejects an absolute path", () => {
  // Absolute paths can't be resolved against the treatment file's directory —
  // POSIX-relative is the contract for relative-form paths.
  expect(fileSchema.safeParse("/etc/passwd").success).toBe(false);
});

test("fileSchema rejects backslash-separated (Windows-style) paths", () => {
  // The host loader expects POSIX paths; a backslash slipping through would
  // resolve to a different file on Windows than on POSIX hosts.
  expect(fileSchema.safeParse("shared\\clip.mp4").success).toBe(false);
  expect(fileSchema.safeParse("\\\\server\\share\\x.mp4").success).toBe(false);
  expect(fileSchema.safeParse("a/b\\c").success).toBe(false);
});

test("fileSchema rejects opaque-scheme variants (no //)", () => {
  expect(fileSchema.safeParse("asset:clip.mp4").success).toBe(false);
  expect(fileSchema.safeParse("https:cdn.example.com/x").success).toBe(false);
});

test("fileSchema rejects bare `asset://` with no host or path", () => {
  expect(fileSchema.safeParse("asset://").success).toBe(false);
});

test("fileSchema rejects `https://` with an empty host", () => {
  expect(fileSchema.safeParse("https://").success).toBe(false);
});

test("fileSchema rejects unsupported schemes (ftp:, mailto:)", () => {
  expect(fileSchema.safeParse("ftp://example.com/x").success).toBe(false);
  expect(fileSchema.safeParse("mailto:foo@bar.com").success).toBe(false);
  expect(fileSchema.safeParse("file:///etc/passwd").success).toBe(false);
});

// --- elementBaseSchema no longer carries `file:` (#249) ---

test("element: stray `file:` on a separator (no file: in its schema) is rejected", () => {
  const result = elementSchema.safeParse({
    type: "separator",
    file: "stray.txt",
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) => i.code === "unrecognized_keys"),
    ).toBe(true);
  }
});

test("element: stray `file:` on a submitButton is rejected", () => {
  const result = elementSchema.safeParse({
    type: "submitButton",
    file: "stray.txt",
  });
  expect(result.success).toBe(false);
});

// --- mediaPlayer.file rename (#249) ---

test("mediaPlayer: legacy `url:` field is rejected as unrecognized", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    url: "clip.mp4",
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) => i.code === "unrecognized_keys"),
    ).toBe(true);
  }
});

test("mediaPlayer: missing `file:` is rejected", () => {
  const result = mediaPlayerSchema.safeParse({ type: "mediaPlayer" });
  expect(result.success).toBe(false);
});

test("mediaPlayer: malformed captionsFile (asset: with no //) is rejected", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "clip.mp4",
    captionsFile: "asset:cap.vtt",
  });
  expect(result.success).toBe(false);
});

// --- qualtrics.url / trackedLink.url stricter (#249) ---

test("qualtrics: asset:// url is rejected (browser-direct only)", () => {
  const result = elementSchema.safeParse({
    type: "qualtrics",
    url: "asset://external/survey",
  });
  expect(result.success).toBe(false);
});

test("trackedLink: asset:// url is rejected (browser-direct only)", () => {
  const result = elementSchema.safeParse({
    type: "trackedLink",
    name: "external_form",
    url: "asset://external/form",
    displayText: "Open form",
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: full config with all fields", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/interview.mp4",
    name: "coding_video",
    playVideo: true,
    playAudio: true,
    captionsFile: "shared/captions.vtt",
    startAt: 45,
    stopAt: 120,
    allowScrubOutsideBounds: false,
    stepDuration: 0.033,
    syncToStageTime: false,
    submitOnComplete: true,
    playback: "manual",
    controls: {
      playPause: true,
      seek: true,
      step: true,
      speed: true,
    },
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: startAt/stopAt/stepDuration accept ${field} placeholders", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/interview.mp4",
    startAt: "${clipStart}",
    stopAt: "${clipEnd}",
    stepDuration: "${stepSize}",
  });
  expect(result.success).toBe(true);
});

test("mediaPlayer: stopAt <= startAt check skipped when either is a placeholder", () => {
  // With concrete numbers, stopAt <= startAt would fail. With a placeholder,
  // the cross-field check should be skipped.
  // This check lives in elementSchema.superRefine (not mediaPlayerSchema),
  // so we must parse through elementSchema to exercise it.
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/interview.mp4",
    startAt: 100,
    stopAt: "${clipEnd}",
  });
  expect(result.success).toBe(true);
});

test("mediaPlayer: stopAt <= startAt IS rejected when both are concrete numbers", () => {
  // Sanity check: the cross-field check still fires when both values are numbers.
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/interview.mp4",
    startAt: 100,
    stopAt: 50,
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.includes("stopAt must be greater than startAt"),
    );
    expect(issue).toBeDefined();
  }
});

test("mediaPlayer: negative startAt is invalid", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    startAt: -5,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: stopAt of zero is invalid (must be positive)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    stopAt: 0,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: unknown fields are rejected (strict)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    unknownField: true,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: controls with unknown keys are rejected (strict)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    controls: { playPause: true, unknownControl: true },
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: zero startAt is valid (nonnegative)", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    startAt: 0,
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: stepDuration must be positive", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    stepDuration: 0,
  });
  expect(result.success).toBe(false);
});

test("elementsSchema accepts type: mediaPlayer", () => {
  const result = elementsSchema.safeParse([
    { type: "mediaPlayer", file: "shared/footage.mp4" },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: stopAt must be greater than startAt", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    startAt: 30,
    stopAt: 10,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: startAt equal to stopAt is invalid", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    startAt: 30,
    stopAt: 30,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: startAt < stopAt is valid", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    startAt: 10,
    stopAt: 90,
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: playback 'once' is valid", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "once",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: playback 'manual' is valid", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "manual",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("mediaPlayer: playback rejects invalid value", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "loop",
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: playback is optional (omitted in schema, component defaults to 'once')", () => {
  const result = mediaPlayerSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.playback).toBeUndefined();
  }
});

test("mediaPlayer: playback 'once' with controls is invalid", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "once",
    controls: { playPause: true },
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: playback 'once' with syncToStageTime is invalid", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "once",
    syncToStageTime: true,
  });
  expect(result.success).toBe(false);
});

test("mediaPlayer: playback 'manual' with controls is valid", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "shared/footage.mp4",
    playback: "manual",
    controls: { playPause: true },
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

// ----------- introStepsSchema / exitStepsSchema: advancement element requirement ------------

test("intro step with submitButton is valid", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "consent",
      elements: [
        { type: "prompt", file: "intro/consent.prompt.md" },
        { type: "submitButton", buttonText: "I agree" },
      ],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("intro step with only prompt and no submitButton is invalid", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "consent",
      elements: [{ type: "prompt", file: "intro/consent.prompt.md" }],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(false);
});

test("intro step with survey element auto-submits (no submitButton needed)", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "party_affiliation",
      elements: [{ type: "survey", surveyName: "PoliticalPartyUS" }],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("intro step with qualtrics element auto-submits (no submitButton needed)", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "screener",
      elements: [
        {
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_xxx",
        },
      ],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("intro step with mediaPlayer submitOnComplete auto-submits (no submitButton needed)", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "watch_video",
      elements: [
        {
          type: "mediaPlayer",
          file: "shared/intro.mp4",
          submitOnComplete: true,
        },
      ],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("intro step with mediaPlayer without submitOnComplete requires submitButton", () => {
  const result = introStepsSchema.safeParse([
    {
      name: "watch_video",
      elements: [{ type: "mediaPlayer", file: "shared/intro.mp4" }],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(false);
});

test("exit step with submitButton is valid", () => {
  const result = exitStepsSchema.safeParse([
    {
      name: "debrief",
      elements: [
        { type: "prompt", file: "exit/debrief.prompt.md" },
        { type: "submitButton", buttonText: "Done" },
      ],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("exit step with only prompt and no submitButton is invalid", () => {
  const result = exitStepsSchema.safeParse([
    {
      name: "debrief",
      elements: [{ type: "prompt", file: "exit/debrief.prompt.md" }],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(false);
});

test("exit step with qualtrics auto-submits (no submitButton needed)", () => {
  const result = exitStepsSchema.safeParse([
    {
      name: "exit_survey",
      elements: [
        {
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_yyy",
        },
      ],
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

// ----------- timelineSchema ------------

test("timeline: minimal valid config", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("timeline: full config with all fields", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
    selectionScope: "track",
    multiSelect: true,
    showWaveform: true,
    trackLabels: ["Interviewer", "Participant"],
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("timeline: point selectionType is valid", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "agreements",
    selectionType: "point",
    multiSelect: true,
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("timeline: missing source is invalid", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    name: "interruptions",
    selectionType: "range",
  });
  expect(result.success).toBe(false);
});

test("timeline: missing name is invalid", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    selectionType: "range",
  });
  expect(result.success).toBe(false);
});

test("timeline: missing selectionType is invalid", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
  });
  expect(result.success).toBe(false);
});

test("timeline: invalid selectionType is rejected", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "segment",
  });
  expect(result.success).toBe(false);
});

test("timeline: invalid selectionScope is rejected", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
    selectionScope: "global",
  });
  expect(result.success).toBe(false);
});

test("timeline: unknown fields are rejected (strict)", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
    unknownField: true,
  });
  expect(result.success).toBe(false);
});

test("timeline: trackLabels accepts array of strings", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
    trackLabels: ["Speaker A", "Speaker B", "Speaker C"],
  });
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("timeline: defaults — selectionScope defaults to all, multiSelect to false, showWaveform to true", () => {
  const result = timelineSchema.safeParse({
    type: "timeline",
    source: "coding_video",
    name: "interruptions",
    selectionType: "range",
  });
  expect(result.success).toBe(true);
});

test("elementsSchema accepts type: timeline", () => {
  const result = elementsSchema.safeParse([
    {
      type: "timeline",
      source: "coding_video",
      name: "interruptions",
      selectionType: "range",
    },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

test("elementsSchema accepts timeline alongside mediaPlayer", () => {
  const result = elementsSchema.safeParse([
    { type: "mediaPlayer", file: "shared/interview.mp4", name: "coding_video" },
    {
      type: "timeline",
      source: "coding_video",
      name: "interruptions",
      selectionType: "range",
      multiSelect: true,
    },
    {
      type: "timeline",
      source: "coding_video",
      name: "agreements",
      selectionType: "point",
      multiSelect: true,
    },
    { type: "submitButton", buttonText: "Submit" },
  ]);
  if (!result.success) console.log(result.error.message);
  expect(result.success).toBe(true);
});

// ----------- Stage: timeline.source must name a mediaPlayer in the same stage -----------

test("stage accepts a timeline whose source matches a sibling mediaPlayer.name", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      { type: "mediaPlayer", file: "v.mp4", name: "interview" },
      {
        type: "timeline",
        source: "interview",
        name: "segments",
        selectionType: "range",
      },
    ],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("stage rejects a timeline whose source doesn't match any mediaPlayer.name", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      { type: "mediaPlayer", file: "v.mp4", name: "interview" },
      {
        type: "timeline",
        source: "typo_video",
        name: "segments",
        selectionType: "range",
      },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) =>
        i.path.join(".") === "elements.1.source" &&
        i.message.includes("typo_video"),
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"interview"');
  }
});

test("stage rejects a timeline when no mediaPlayer exists in the stage", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      {
        type: "timeline",
        source: "missing",
        name: "segments",
        selectionType: "range",
      },
      { type: "submitButton" },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "elements.0.source",
    );
    expect(issue?.message).toContain("No mediaPlayer elements");
  }
});

test("stage with an unnamed mediaPlayer distinguishes 'none named' from 'none at all'", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      { type: "mediaPlayer", file: "v.mp4" }, // no name
      {
        type: "timeline",
        source: "missing",
        name: "segments",
        selectionType: "range",
      },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "elements.1.source",
    );
    expect(issue?.message).toContain("`name:` field");
    expect(issue?.message).not.toContain("No mediaPlayer elements are defined");
  }
});

test("stage skips source validation when source is a ${field} placeholder", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      { type: "mediaPlayer", file: "v.mp4", name: "interview" },
      {
        type: "timeline",
        source: "${playerName}",
        name: "segments",
        selectionType: "range",
      },
    ],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("stage allows multiple timelines pointing at different mediaPlayers", () => {
  const result = stageSchema.safeParse({
    name: "review",
    duration: 120,
    elements: [
      { type: "mediaPlayer", file: "a.mp4", name: "clip_a" },
      { type: "mediaPlayer", file: "b.mp4", name: "clip_b" },
      {
        type: "timeline",
        source: "clip_a",
        name: "clip_a_segments",
        selectionType: "range",
      },
      {
        type: "timeline",
        source: "clip_b",
        name: "clip_b_segments",
        selectionType: "range",
      },
    ],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("intro/exit step also rejects a timeline whose source doesn't match a sibling mediaPlayer", () => {
  // Regression: the timeline-source check was originally only wired into
  // `stageSchema.superRefine` (game stages). Intro and exit steps can
  // also mix timelines with mediaPlayers (e.g. a practice-annotation
  // intro step with a sample video), and the same typo footgun applies.
  const result = introExitStepSchema.safeParse({
    name: "practice",
    elements: [
      {
        type: "mediaPlayer",
        file: "asset://recordings/sample.mp4",
        name: "practiceStory",
      },
      {
        type: "timeline",
        source: "practiceStoryy", // typo
        name: "practiceSegment",
        selectionType: "range",
      },
      { type: "submitButton" },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) =>
        i.path.join(".") === "elements.1.source" &&
        i.message.includes("practiceStoryy"),
    );
    expect(issue).toBeDefined();
    expect(issue?.message).toContain('"practiceStory"');
  }
});

test("intro/exit step accepts a matching timeline source", () => {
  const result = introExitStepSchema.safeParse({
    name: "practice",
    elements: [
      {
        type: "mediaPlayer",
        file: "asset://recordings/sample.mp4",
        name: "practiceStory",
      },
      {
        type: "timeline",
        source: "practiceStory",
        name: "practiceSegment",
        selectionType: "range",
      },
      { type: "submitButton" },
    ],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("stage reports one issue per mismatched timeline (not a single aggregated error)", () => {
  const result = stageSchema.safeParse({
    name: "coding",
    duration: 60,
    elements: [
      { type: "mediaPlayer", file: "v.mp4", name: "interview" },
      {
        type: "timeline",
        source: "bogus_a",
        name: "seg_a",
        selectionType: "range",
      },
      {
        type: "timeline",
        source: "bogus_b",
        name: "seg_b",
        selectionType: "range",
      },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("elements.1.source");
    expect(paths).toContain("elements.2.source");
  }
});

// ----------- Stage-level conditions (#183) -----------

test("stageSchema accepts stage-level conditions with a cross-client position", () => {
  // After #238, the stage-level cross-client positions are `shared`
  // and a numeric slot index. The dropped aggregator value `"all"`
  // would now be rewritten as an `all:` operator with explicit
  // slot-index leaves (covered separately below).
  const result = stageSchema.safeParse({
    name: "r2",
    duration: 120,
    conditions: [
      {
        reference: "shared.survey.continueVote.responses.keepGoing",
        comparator: "equals",
        value: "yes",
      },
    ],
    elements: [{ type: "submitButton" }],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("stageSchema accepts stage-level conditions with `all.X` reference (cross-client list, #298)", () => {
  // After #298, `all.X` is a list-returning reference (one entry per
  // participant). It's cross-client safe — every client resolves the
  // same list — so it's allowed at game-stage level.
  const result = stageSchema.safeParse({
    name: "r2",
    duration: 120,
    conditions: [
      {
        reference: "all.survey.continueVote.responses.keepGoing",
        comparator: "equals",
        value: "yes",
      },
    ],
    elements: [{ type: "submitButton" }],
  });
  expect(result.success).toBe(true);
});

test("stageSchema accepts the boolean-tree migration of `position: all` — `all:` operator with explicit slot-index leaves", () => {
  // The mechanical migration recipe documented in #238: for
  // `playerCount: 2`, `position: all` becomes `all: [{position: 0},
  // {position: 1}]`. This test pins the recipe schema-validates.
  const result = stageSchema.safeParse({
    name: "r2",
    duration: 120,
    conditions: {
      all: [
        {
          reference: "0.survey.continueVote.responses.keepGoing",
          comparator: "equals",
          value: "yes",
        },
        {
          reference: "1.survey.continueVote.responses.keepGoing",
          comparator: "equals",
          value: "yes",
        },
      ],
    },
    elements: [{ type: "submitButton" }],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

test("stageSchema rejects stage-level conditions with `self` position prefix (#298)", () => {
  // After #298, position is part of the reference itself. `self.X` at
  // a game-stage condition would desync (one client sees this player's
  // value, another sees their own); rejected with a cross-client
  // migration hint.
  const result = stageSchema.safeParse({
    name: "r2",
    duration: 120,
    conditions: [
      {
        reference: "self.prompt.vote",
        comparator: "equals",
        value: "yes",
      },
    ],
    elements: [{ type: "submitButton" }],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "conditions.0.reference",
    );
    expect(issue?.message).toMatch(/cross-client position prefix/);
  }
});

test("introExitStepSchema allows stage-level conditions with any position, including default", () => {
  const result = introExitStepSchema.safeParse({
    name: "optional_info",
    conditions: [
      // Intro/exit is per-participant — default (player) position is fine
      {
        reference: "self.entryUrl.params.showOptionalInfo",
        comparator: "equals",
        value: "true",
      },
    ],
    elements: [{ type: "submitButton" }],
  });
  if (!result.success) console.log(result.error.issues);
  expect(result.success).toBe(true);
});

// Tests for the pre-#298 dropped position selectors (`all`, `any`,
// `percentAgreement` as leaf-position values) are removed in favor of
// the position-prefixed reference grammar. The relevant rejections now
// surface as either invalid-reference errors (parser rejects unknown
// position selectors) or game-stage forbid-self errors (see below).

test("game-stage forbid-self error message points at the boolean-tree migration recipe (#298)", () => {
  // When an author writes `self.X` at a game stage, the desync-prevention
  // rule fires with a message suggesting the `all:` / `any:` operator
  // migration with explicit slot indices.
  const result = stageSchema.safeParse({
    name: "r2",
    duration: 120,
    conditions: [
      {
        reference: "self.prompt.vote",
        comparator: "equals",
        value: "yes",
      },
    ],
    elements: [{ type: "submitButton" }],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "conditions.0.reference",
    );
    expect(issue?.message).toMatch(/cross-client position prefix/);
    expect(issue?.message).toMatch(/`all:` or `any:` operator/);
  }
});

// ----------- Boolean condition tree (#235) ------------

const leaf = (value: string) => ({
  reference: "self.prompt.q",
  comparator: "equals" as const,
  value,
});

test("conditionsSchema accepts the legacy flat-array form (backward compat)", () => {
  const result = conditionsSchema.safeParse([leaf("a"), leaf("b")]);
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts an `all:` operator at the root", () => {
  const result = conditionsSchema.safeParse({
    all: [leaf("a"), leaf("b")],
  });
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts an `any:` operator at the root", () => {
  const result = conditionsSchema.safeParse({
    any: [leaf("a"), leaf("b")],
  });
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts a `none:` operator at the root", () => {
  const result = conditionsSchema.safeParse({
    none: [leaf("a"), leaf("b")],
  });
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts a single leaf at the root (no array)", () => {
  const result = conditionsSchema.safeParse(leaf("a"));
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts nested operators", () => {
  const result = conditionsSchema.safeParse({
    all: [{ any: [leaf("a"), leaf("b")] }, { none: [leaf("c")] }, leaf("d")],
  });
  expect(result.success).toBe(true);
});

test("conditionsSchema accepts deeply nested operators", () => {
  // 3-deep nesting: all -> any -> none -> leaf
  const result = conditionsSchema.safeParse({
    all: [{ any: [{ none: [leaf("a")] }, leaf("b")] }],
  });
  expect(result.success).toBe(true);
});

test("conditionsSchema rejects empty `all:` array", () => {
  const result = conditionsSchema.safeParse({ all: [] });
  expect(result.success).toBe(false);
});

test("conditionsSchema rejects empty `any:` array", () => {
  const result = conditionsSchema.safeParse({ any: [] });
  expect(result.success).toBe(false);
});

test("conditionsSchema rejects empty `none:` array", () => {
  const result = conditionsSchema.safeParse({ none: [] });
  expect(result.success).toBe(false);
});

test("conditionsSchema rejects extra keys on operator object", () => {
  // `.strict()` on the operator branches should reject
  // `{all: [...], reference: ...}` etc. as ambiguous shapes.
  const result = conditionsSchema.safeParse({
    all: [leaf("a")],
    reference: "self.prompt.q",
  });
  expect(result.success).toBe(false);
});

test("conditionsSchema suggests `all` for `al:` typo", () => {
  const result = conditionsSchema.safeParse({ al: [leaf("a")] });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.includes('Did you mean "all"'),
    );
    expect(issue).toBeDefined();
  }
});

test("conditionsSchema suggests `any` for `anny:` typo", () => {
  const result = conditionsSchema.safeParse({ anny: [leaf("a")] });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.includes('Did you mean "any"'),
    );
    expect(issue).toBeDefined();
  }
});

test("conditionsSchema suggests `none` for `nones:` typo", () => {
  const result = conditionsSchema.safeParse({ nones: [leaf("a")] });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.includes('Did you mean "none"'),
    );
    expect(issue).toBeDefined();
  }
});

test("conditionsSchema doesn't false-positive a leaf as a typo", () => {
  // A leaf has `reference` and `comparator` keys — the typo heuristic
  // should skip it (no "did you mean ..." for `reference`).
  const result = conditionsSchema.safeParse(leaf("a"));
  expect(result.success).toBe(true);
});

test("stageSchema accepts boolean-tree conditions", () => {
  const result = stageSchema.safeParse({
    name: "stage1",
    duration: 60,
    conditions: {
      any: [
        {
          reference: "0.prompt.consent",
          comparator: "equals",
          value: "yes",
        },
        {
          reference: "1.prompt.consent",
          comparator: "equals",
          value: "yes",
        },
      ],
    },
    elements: [{ type: "submitButton" }],
  });
  expect(result.success).toBe(true);
});

test("validateConditionRules recurses into operator branches (game-stage forbidSelfPosition)", () => {
  // A nested `any:` containing a leaf without `position` (default
  // "player") should be rejected by the game-stage rule.
  const result = stageSchema.safeParse({
    name: "stage1",
    duration: 60,
    conditions: {
      any: [
        {
          reference: "self.prompt.q",
          comparator: "equals",
          value: "yes",
          // position omitted — defaults to "player", forbidden at
          // game-stage level
        },
      ],
    },
    elements: [{ type: "submitButton" }],
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) =>
      i.message.includes("cross-client position"),
    );
    expect(issue).toBeDefined();
  }
});

test("conditionSchema (single node) accepts a leaf", () => {
  // Backward-compat: `conditionSchema` previously meant a leaf; it
  // now means any tree node (leaf or operator). Existing leaf inputs
  // still validate.
  const result = conditionSchema.safeParse(leaf("a"));
  expect(result.success).toBe(true);
});

test("conditionSchema (single node) accepts an operator node", () => {
  const result = conditionSchema.safeParse({ all: [leaf("a")] });
  expect(result.success).toBe(true);
});

// ----------- Template Schema (#244) ------------
//
// Templates are now `{ name, contentType, notes?, content }` with a required
// contentType that dispatches the content through one of the named per-type
// schemas. The fuzzy-match fallback (`templateContentSchema`) and the
// `contentType: "other"` escape hatch are gone — every template body
// validates against an explicit schema.

test("template: missing contentType is rejected", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    content: { name: "s1", duration: 10, elements: [{ type: "submitButton" }] },
  });
  expect(result.success).toBe(false);
});

test("template: contentType 'other' is rejected", () => {
  const result = templateSchema.safeParse({
    name: "myThing",
    contentType: "other",
    content: { anything: 1 },
  });
  expect(result.success).toBe(false);
});

test("template: typo'd contentType is rejected", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stagez",
    content: { name: "s1" },
  });
  expect(result.success).toBe(false);
});

test("template: legacy `templateName` key is rejected as unrecognized", () => {
  const result = templateSchema.safeParse({
    // Both `name:` (the new field) and `templateName:` (the legacy field)
    // present. The new field satisfies `nameSchema`; the legacy field must
    // be rejected by `.strict()` for this assertion to be meaningful.
    name: "myStage",
    templateName: "myStage",
    contentType: "stage",
    content: { name: "s1", duration: 10, elements: [{ type: "submitButton" }] },
  });
  expect(result.success).toBe(false);
});

test("template: legacy `templateContent` key is rejected as unrecognized", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stage",
    templateContent: {
      name: "s1",
      duration: 10,
      elements: [{ type: "submitButton" }],
    },
  });
  expect(result.success).toBe(false);
});

test("template: legacy `templateDesc` key is rejected as unrecognized", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stage",
    templateDesc: "a description",
    content: { name: "s1", duration: 10, elements: [{ type: "submitButton" }] },
  });
  expect(result.success).toBe(false);
});

test("template: contentType 'stage' validates a stage body", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stage",
    content: { name: "s1", duration: 10, elements: [{ type: "submitButton" }] },
  });
  expect(result.success).toBe(true);
});

test("template: contentType 'stage' rejects an invalid stage body, with the contentType named in the error", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stage",
    content: { name: "s1" }, // missing duration + elements
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0].path[0]).toBe("content");
    expect(result.error.issues[0].message).toContain("'stage'");
  }
});

test("template: contentType 'discussion' validates a discussion body", () => {
  const result = templateSchema.safeParse({
    name: "lobby",
    contentType: "discussion",
    content: { chatType: "text", showNickname: true, showTitle: false },
  });
  expect(result.success).toBe(true);
});

test("template: contentType 'conditions' validates a condition array", () => {
  const result = templateSchema.safeParse({
    name: "wantsToProceed",
    contentType: "conditions",
    content: [
      { reference: "self.prompt.q1", comparator: "equals", value: "yes" },
    ],
  });
  expect(result.success).toBe(true);
});

test("template: contentType 'introSteps' validates an intro-steps array", () => {
  const result = templateSchema.safeParse({
    name: "warmup",
    contentType: "introSteps",
    content: [{ name: "step1", elements: [{ type: "submitButton" }] }],
  });
  expect(result.success).toBe(true);
});

test("template: contentType 'groupComposition' validates a player array", () => {
  const result = templateSchema.safeParse({
    name: "twoSides",
    contentType: "groupComposition",
    content: [{ position: 0 }, { position: 1 }],
  });
  expect(result.success).toBe(true);
});

test("template: contentType 'broadcastAxisValues' validates an axis-values array", () => {
  const result = templateSchema.safeParse({
    name: "topics",
    contentType: "broadcastAxisValues",
    content: [{ topic: "a" }, { topic: "b" }],
  });
  expect(result.success).toBe(true);
});

test("template: notes field is accepted", () => {
  const result = templateSchema.safeParse({
    name: "myStage",
    contentType: "stage",
    notes: "Reusable two-person discussion stage.",
    content: { name: "s1", duration: 10, elements: [{ type: "submitButton" }] },
  });
  expect(result.success).toBe(true);
});

// ----------- Element Schema (#245) ------------
//
// promptShorthandSchema is gone — bare strings inside an `elements` array no
// longer become prompts. They fail discriminated-union validation with a
// clear "Expected object" message instead.

test("element: bare string inside elements array is rejected", () => {
  const result = elementsSchema.safeParse(["prompts/intro.prompt.md"]);
  expect(result.success).toBe(false);
  if (!result.success) {
    // Zod's discriminated-union complaint about a non-object — the surface
    // message says it expected an object, not a string.
    const messages = result.error.issues.map((i) => i.message).join("\n");
    expect(messages.toLowerCase()).toMatch(/object/);
  }
});

test("element: typo'd plain string in elements array is rejected (no silent prompt parse)", () => {
  const result = elementsSchema.safeParse(["not-a-prompt.txt"]);
  expect(result.success).toBe(false);
});

test("element: explicit prompt element still validates", () => {
  const result = elementsSchema.safeParse([
    { type: "prompt", file: "prompts/intro.prompt.md" },
  ]);
  expect(result.success).toBe(true);
});

test("element: missing `type` discriminator is rejected", () => {
  // Each array item is validated through `elementSchema` (which dispatches
  // via `altTemplateContext`). With no `template:` key, the object falls
  // straight through to the discriminated union and fails on the missing
  // `type:` discriminator.
  const result = elementsSchema.safeParse([
    { file: "prompts/intro.prompt.md" },
  ]);
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) => i.code === "invalid_union_discriminator"),
    ).toBe(true);
  }
});

test("element: mediaPlayer cross-field rule (stopAt > startAt) still applies", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "clip.mp4",
    startAt: 10,
    stopAt: 5,
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) =>
        i.message.includes("stopAt must be greater than startAt"),
      ),
    ).toBe(true);
  }
});

test("element: mediaPlayer playback 'once' + syncToStageTime still rejected", () => {
  const result = elementSchema.safeParse({
    type: "mediaPlayer",
    file: "clip.mp4",
    playback: "once",
    syncToStageTime: true,
  });
  expect(result.success).toBe(false);
});

// ----------- Element Types (#250) ------------

test("element: type 'talkMeter' is rejected (removed in #250)", () => {
  const result = elementSchema.safeParse({ type: "talkMeter" });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) => i.code === "invalid_union_discriminator"),
    ).toBe(true);
  }
});

test("element: type 'sharedNotepad' is rejected (removed in #250)", () => {
  const result = elementSchema.safeParse({
    type: "sharedNotepad",
    name: "groupNotes",
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(
      result.error.issues.some((i) => i.code === "invalid_union_discriminator"),
    ).toBe(true);
  }
});

test("element: type 'survey' still accepted with a one-time deprecation warning", async () => {
  const { vi } = await import("vitest");
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    // First parse fires the warning.
    const r1 = elementSchema.safeParse({
      type: "survey",
      surveyName: "deprecation_test_TIPI",
    });
    expect(r1.success).toBe(true);
    // Second parse with the same surveyName does NOT re-warn — the dedupe is
    // module-scoped per process, keyed on surveyName.
    const r2 = elementSchema.safeParse({
      type: "survey",
      surveyName: "deprecation_test_TIPI",
    });
    expect(r2.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("`type: survey` is deprecated");
  } finally {
    warnSpy.mockRestore();
  }
});

test("element: survey deprecation warning escapes newlines/quotes in surveyName", async () => {
  const { vi } = await import("vitest");
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const result = elementSchema.safeParse({
      type: "survey",
      surveyName: 'has\nnewline and "quotes"',
    });
    expect(result.success).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    // The message stays a single line — no raw newlines from the user input.
    expect(message.split("\n")).toHaveLength(1);
    // JSON.stringify escapes the embedded quote → \" and the newline → \\n.
    expect(message).toContain('\\"quotes\\"');
    expect(message).toContain("\\n");
  } finally {
    warnSpy.mockRestore();
  }
});

test("validElementTypes does not include talkMeter or sharedNotepad", async () => {
  const { validElementTypes } = await import("./treatment.js");
  expect(validElementTypes).not.toContain("talkMeter");
  expect(validElementTypes).not.toContain("sharedNotepad");
});

// ----------- entryUrl rename (#246) ------------

test("entryUrl.params.<key> string reference is accepted", () => {
  const result = referenceSchema.safeParse("self.entryUrl.params.condition");
  expect(result.success).toBe(true);
});

test("entryUrl bare-key string reference is rejected (`params` subpath required)", () => {
  const result = referenceSchema.safeParse("self.entryUrl.condition");
  expect(result.success).toBe(false);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("\n");
    expect(message).toContain("self.entryUrl.params");
  }
});

test("legacy urlParams.<key> string reference is rejected with a migration hint", () => {
  const result = referenceSchema.safeParse("urlParams.condition");
  expect(result.success).toBe(false);
  if (!result.success) {
    const message = result.error.issues.map((i) => i.message).join("\n");
    expect(message).toContain("self.entryUrl.params");
  }
});

test("structured `{position, source: entryUrl, path: [params, key]}` is accepted", () => {
  const result = referenceSchema.safeParse({
    position: "self",
    source: "entryUrl",
    path: ["params", "condition"],
  });
  expect(result.success).toBe(true);
});

test("structured `{position, source: entryUrl, path: [<key>]}` is rejected", () => {
  const result = referenceSchema.safeParse({
    position: "self",
    source: "entryUrl",
    path: ["condition"],
  });
  expect(result.success).toBe(false);
});

test("structured `{position, source: entryUrl, name: ...}` is rejected (external sources forbid name)", () => {
  const result = referenceSchema.safeParse({
    position: "self",
    source: "entryUrl",
    name: "condition",
    path: ["params", "x"],
  });
  expect(result.success).toBe(false);
});

// =====================================================================
// #284 — `${field}` placeholders in complex slots
// =====================================================================
//
// Pre-fill schema must accept placeholder strings where complex array
// values are expected, so a template field can carry the structured
// value at substitution time. Resolved-shape validation in resolved.ts
// catches placeholders that survive substitution.

test("discussion.rooms accepts a ${field} placeholder pre-fill (#284)", () => {
  const result = discussionSchema.safeParse({
    chatType: "video",
    showNickname: true,
    showTitle: true,
    rooms: "${roomAssignments}",
  });
  expect(result.success).toBe(true);
});

test("discussion.rooms still accepts a literal array (no regression)", () => {
  const result = discussionSchema.safeParse({
    chatType: "video",
    showNickname: true,
    showTitle: true,
    rooms: [{ includePositions: [0, 1] }, { includePositions: [2, 3] }],
  });
  expect(result.success).toBe(true);
});

test("discussion.rooms rejects a non-placeholder string (#284)", () => {
  // A plain string that doesn't match the ${...} pattern must be rejected
  // — accepting it would let typos like `rooms: "roomAssignments"` slip
  // through pre-fill validation.
  const result = discussionSchema.safeParse({
    chatType: "video",
    showNickname: true,
    showTitle: true,
    rooms: "roomAssignments",
  });
  expect(result.success).toBe(false);
});

test("discussion.layout.feeds accepts a ${field} placeholder (#284)", () => {
  const result = discussionSchema.safeParse({
    chatType: "video",
    showNickname: true,
    showTitle: true,
    layout: {
      "0": {
        grid: { rows: 2, cols: 2 },
        feeds: "${feedAssignments}",
      },
    },
  });
  expect(result.success).toBe(true);
});

test("conditions.all accepts a ${field} placeholder (#284)", () => {
  const result = conditionsSchema.safeParse({
    all: "${ruleSet}",
  });
  expect(result.success).toBe(true);
});

test("conditions.any accepts a ${field} placeholder (#284)", () => {
  const result = conditionsSchema.safeParse({
    any: "${alternatives}",
  });
  expect(result.success).toBe(true);
});

test("conditions.none accepts a ${field} placeholder (#284)", () => {
  const result = conditionsSchema.safeParse({
    none: "${exclusions}",
  });
  expect(result.success).toBe(true);
});

test("top-level conditions accepts a ${field} placeholder (#284)", () => {
  // The top-level `conditions:` slot accepts an array, an operator object,
  // a single leaf, or a placeholder.
  const result = conditionsSchema.safeParse("${gateExpression}");
  expect(result.success).toBe(true);
});

test("top-level conditions still accepts an array literal (no regression)", () => {
  const result = conditionsSchema.safeParse([
    { reference: "self.prompt.q1", comparator: "exists" },
  ]);
  expect(result.success).toBe(true);
});

test("groupComposition field on a treatment accepts a ${field} placeholder (#284)", () => {
  // A single `treatment` template can vary group structure per condition
  // (dyads vs. triads under the same protocol) by binding groupComposition
  // to a broadcast-row field.
  const result = treatmentFileSchema.safeParse({
    treatments: [
      {
        name: "varies",
        playerCount: 4,
        groupComposition: "${composition}",
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            elements: [{ type: "submitButton" }],
          },
        ],
      },
    ],
  });
  // playerCount/groupComposition cross-checks are skipped when
  // groupComposition is a placeholder; the literal-array case still
  // enforces them.
  expect(result.success).toBe(true);
});

test("end-to-end: rooms placeholder resolves through fillTemplates and re-validates (#284)", () => {
  const templates = [
    {
      name: "storytelling_round",
      contentType: "stages",
      content: [
        {
          name: "storytelling_${story_round}",
          duration: 180,
          discussion: {
            chatType: "video",
            showNickname: true,
            showTitle: true,
            rooms: "${roomAssignments}",
          },
          elements: [{ type: "submitButton" }],
        },
      ],
    },
  ];

  const obj = {
    treatments: [
      {
        name: "example",
        playerCount: 4,
        gameStages: [
          {
            template: "storytelling_round",
            broadcast: {
              d0: [
                {
                  story_round: "1",
                  roomAssignments: [
                    { includePositions: [0, 1] },
                    { includePositions: [2, 3] },
                  ],
                },
                {
                  story_round: "2",
                  roomAssignments: [
                    { includePositions: [0, 3] },
                    { includePositions: [2, 1] },
                  ],
                },
              ],
            },
          },
        ],
      },
    ],
  };

  // Pre-fill validation passes (placeholder accepted in `rooms` slot).
  const preFill = treatmentFileSchema.safeParse(obj);
  expect(preFill.success).toBe(true);

  // fillTemplates substitutes the broadcast row's roomAssignments into
  // the rooms slot — the placeholder string becomes a literal array.
  const filled = fillTemplates({ obj, templates });
  const result: unknown = filled.result;
  const stages = (
    result as {
      treatments: { gameStages: { discussion: { rooms: unknown } }[] }[];
    }
  ).treatments[0].gameStages;
  expect(stages).toHaveLength(2);
  expect(stages[0].discussion.rooms).toEqual([
    { includePositions: [0, 1] },
    { includePositions: [2, 3] },
  ]);
  expect(stages[1].discussion.rooms).toEqual([
    { includePositions: [0, 3] },
    { includePositions: [2, 1] },
  ]);

  // Post-fill: the resolved value is a literal array; schema still accepts.
  const postFill = treatmentFileSchema.safeParse(result);
  expect(postFill.success).toBe(true);

  // The resolved-shape schema is the actual safety net: it rejects any
  // `${...}` that survived substitution. Validate each filled treatment
  // against `resolvedTreatmentSchema` to confirm the broadcast resolution
  // produced strict, placeholder-free values.
  const filledTreatments = (result as { treatments: unknown[] }).treatments;
  for (const t of filledTreatments) {
    const resolved = resolvedTreatmentSchema.safeParse(t);
    expect(resolved.success).toBe(true);
  }
});

test("end-to-end: an unbound complex placeholder survives fillTemplates and is rejected by resolvedTreatmentSchema (#284)", () => {
  // Authoring uses `${unboundRoomAssignments}` but the broadcast never
  // binds it. fillTemplates leaves the placeholder string in place;
  // pre-fill validation passes (placeholders are allowed); the resolved
  // schema then catches the unsubstituted string at the safety boundary.
  const obj = {
    treatments: [
      {
        name: "broken",
        playerCount: 2,
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            discussion: {
              chatType: "video",
              showNickname: true,
              showTitle: true,
              rooms: "${unboundRoomAssignments}",
            },
            elements: [{ type: "submitButton" }],
          },
        ],
      },
    ],
  };

  // Pre-fill passes (placeholders allowed in `rooms` per #284).
  const preFill = treatmentFileSchema.safeParse(obj);
  expect(preFill.success).toBe(true);

  // fillTemplates with no templates and no fields leaves the placeholder
  // untouched. `allowUnresolved` is what hosts pass when they intend to
  // surface unresolved fields back to the user (e.g. via FieldForm) — the
  // resolved-shape check below is the safety net for that path.
  const filled = fillTemplates({
    obj,
    templates: [],
    allowUnresolved: true,
  });
  const result: unknown = filled.result;

  // Resolved-shape validation rejects the unbound placeholder.
  const treatments = (result as { treatments: unknown[] }).treatments;
  const resolved = resolvedTreatmentSchema.safeParse(treatments[0]);
  expect(resolved.success).toBe(false);
  if (!resolved.success) {
    expect(
      resolved.error.issues.some((i) => i.message.includes("unresolved")),
    ).toBe(true);
  }
});

// ----------------------------------------------------------------
// Template-as-fields-value rejection (#304 deprecation)
// ----------------------------------------------------------------
// `fields:` is a flat map of values, never a place to invoke
// templates. Both literal (14a) and parameterized (14b) forms are
// rejected at parse time so authors get pointed at the cleaner
// alternative (Pattern C — invocation in the slot where it's used).

test("rejects template invocation in `fields:` value (literal name, #304/14a)", () => {
  const result = treatmentFileSchema.safeParse({
    templates: [
      {
        name: "imageList",
        contentType: "elements",
        content: [{ type: "image", file: "a.jpg" }],
      },
      {
        name: "treatmentBase",
        contentType: "treatment",
        content: {
          name: "${treatmentName}",
          playerCount: 1,
          gameStages: [
            {
              name: "stage1",
              duration: 60,
              elements: [{ type: "submitButton" }],
            },
          ],
        },
      },
    ],
    treatments: [
      {
        template: "treatmentBase",
        fields: {
          treatmentName: "t",
          // 14a: literal template invocation as a fields value
          recallImages: { template: "imageList" },
        },
      },
    ],
  });
  expect(result.success).toBe(false);
  if (result.success) return;
  const issue = result.error.issues.find((i) =>
    i.message?.includes("Template invocations are not allowed"),
  );
  expect(issue).toBeDefined();
  expect(issue!.message).toContain("broadcast");
  expect(issue!.message).toContain("template name as a string field");
});

test("rejects template invocation in `fields:` value (parameterized name, #304/14b)", () => {
  const result = treatmentFileSchema.safeParse({
    templates: [
      {
        name: "easySet",
        contentType: "elements",
        content: [{ type: "image", file: "easy.jpg" }],
      },
      {
        name: "treatmentBase",
        contentType: "treatment",
        content: {
          name: "${treatmentName}",
          playerCount: 1,
          gameStages: [
            {
              name: "stage1",
              duration: 60,
              elements: [{ type: "submitButton" }],
            },
          ],
        },
      },
    ],
    treatments: [
      {
        template: "treatmentBase",
        fields: {
          treatmentName: "t",
          imageSet: "easySet",
          // 14b: parameterized template invocation as a fields value
          recallImages: { template: "${imageSet}" },
        },
      },
    ],
  });
  expect(result.success).toBe(false);
  if (result.success) return;
  const issue = result.error.issues.find((i) =>
    i.message?.includes("Template invocations are not allowed"),
  );
  expect(issue).toBeDefined();
});

test("groupComposition rejects a non-placeholder string", () => {
  const result = treatmentFileSchema.safeParse({
    treatments: [
      {
        name: "bad",
        playerCount: 2,
        groupComposition: "not a placeholder",
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            elements: [{ type: "submitButton" }],
          },
        ],
      },
    ],
  });
  expect(result.success).toBe(false);
});
