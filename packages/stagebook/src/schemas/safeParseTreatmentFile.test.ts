import { describe, expect, it, test } from "vitest";
import {
  getValidKeysForComparator,
  getValidKeysForDiscussion,
  getValidKeysForElementType,
  getValidKeysForIntroExitStep,
  getValidKeysForPlayer,
  getValidKeysForStage,
  getValidKeysForTreatment,
  safeParseTreatmentFile,
  validComparators,
  validElementTypes,
  type UnrecognizedKeyIssueParams,
} from "./index.js";

// --- getValidKeysFor* introspection ---

describe("getValidKeysForElementType", () => {
  test.each(validElementTypes.map((t) => [t]))(
    "returns the valid-keys list for element type %s",
    (type) => {
      const keys = getValidKeysForElementType(type);
      expect(keys).not.toBeNull();
      // Every element schema extends elementBaseSchema, so the base
      // keys must be present alongside the type literal.
      expect(keys).toContain("type");
      expect(keys).toContain("conditions");
      expect(keys).toContain("displayTime");
    },
  );

  it("includes per-type keys (survey)", () => {
    expect(getValidKeysForElementType("survey")).toContain("surveyName");
  });

  it("includes per-type keys (mediaPlayer)", () => {
    const keys = getValidKeysForElementType("mediaPlayer");
    expect(keys).toContain("file");
    expect(keys).toContain("captionsFile");
    expect(keys).toContain("startAt");
    expect(keys).toContain("stopAt");
    // `url:` was renamed to `file:` in #249.
    expect(keys).not.toContain("url");
  });

  it("returns null for an unknown type", () => {
    expect(getValidKeysForElementType("notARealType")).toBeNull();
  });
});

describe("getValidKeysForComparator", () => {
  test.each(validComparators.map((c) => [c]))(
    "returns the valid-keys list for comparator %s",
    (comparator) => {
      const keys = getValidKeysForComparator(comparator);
      expect(keys).not.toBeNull();
      // baseConditionSchema contributes reference + position; the per-
      // comparator extensions add comparator + value.
      expect(keys).toContain("reference");
      expect(keys).toContain("comparator");
      expect(keys).toContain("value");
    },
  );

  it("returns null for an unknown comparator", () => {
    expect(getValidKeysForComparator("isExactly")).toBeNull();
  });
});

describe("container key getters", () => {
  it("getValidKeysForStage exposes the documented keys", () => {
    expect(getValidKeysForStage()).toEqual([
      "name",
      "notes",
      "conditions",
      "discussion",
      "duration",
      "elements",
    ]);
  });

  it("getValidKeysForIntroExitStep exposes the documented keys", () => {
    expect(getValidKeysForIntroExitStep()).toEqual([
      "name",
      "notes",
      "conditions",
      "elements",
    ]);
  });

  it("getValidKeysForTreatment includes the schema fields", () => {
    const keys = getValidKeysForTreatment();
    expect(keys).toContain("name");
    expect(keys).toContain("playerCount");
    expect(keys).toContain("gameStages");
    expect(keys).toContain("groupComposition");
    expect(keys).toContain("exitSequence");
  });

  it("getValidKeysForDiscussion includes chatType + the optional flags", () => {
    const keys = getValidKeysForDiscussion();
    expect(keys).toContain("chatType");
    expect(keys).toContain("showNickname");
    expect(keys).toContain("layout");
    expect(keys).toContain("rooms");
    expect(keys).toContain("conditions");
  });

  it("getValidKeysForPlayer includes position + title + conditions", () => {
    expect(getValidKeysForPlayer()).toEqual(
      expect.arrayContaining(["position", "title", "conditions"]),
    );
  });
});

// --- safeParseTreatmentFile rich messages ---

/**
 * Build a minimal-valid treatment file we can selectively corrupt to
 * exercise each unrecognized-key surface. Every helper below mutates a
 * deep clone so tests don't share state.
 */
function makeBaseTreatmentFile(): Record<string, unknown> {
  return {
    introSequences: [
      {
        name: "intro1",
        introSteps: [
          {
            name: "welcome",
            elements: [{ type: "submitButton" }],
          },
        ],
      },
    ],
    treatments: [
      {
        name: "study1",
        playerCount: 1,
        introSequences: [],
        gameStages: [
          {
            name: "stage1",
            duration: 300,
            elements: [{ type: "submitButton" }],
          },
        ],
      },
    ],
  };
}

describe("safeParseTreatmentFile — element unrecognized keys", () => {
  it("emits a rich message for an element-of-type-survey bad key", () => {
    // `survyName` (missing 'e') is distance 1 from the real key
    // `surveyName`; well within `findClosestMatch`'s default threshold.
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].elements = [
      { type: "survey", surveyName: "intro", survyName: "typo" },
    ];

    const result = safeParseTreatmentFile(tf);
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find(
      (i) => Array.isArray(i.path) && i.path[i.path.length - 1] === "survyName",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toBe(
      "Unrecognized key 'survyName' on element of type 'survey'. Did you mean 'surveyName'? Valid keys: name, notes, displayTime, hideTime, showToPositions, hideFromPositions, conditions, tags, type, surveyName",
    );

    const params = (issue as { params?: UnrecognizedKeyIssueParams }).params;
    expect(params).toEqual({
      badKey: "survyName",
      suggestion: "surveyName",
      validKeys: expect.arrayContaining(["surveyName"]) as unknown,
    });
  });

  it("splits a multi-key issue into one diagnostic per bad key", () => {
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].elements = [
      {
        type: "survey",
        surveyName: "intro",
        // Two bad keys at once — Zod surfaces them in a single issue;
        // the wrapper must split them so each key gets its own squiggle.
        bogus1: 1,
        bogus2: 2,
      },
    ];

    const result = safeParseTreatmentFile(tf);
    expect(result.success).toBe(false);
    if (result.success) return;

    const badKeys = result.error.issues
      .map((i) => i.path[i.path.length - 1])
      .filter((k) => k === "bogus1" || k === "bogus2");
    expect(badKeys).toEqual(expect.arrayContaining(["bogus1", "bogus2"]));
    expect(badKeys.length).toBe(2);
  });

  it("omits the suggestion when no key is within Levenshtein distance", () => {
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].elements = [
      { type: "survey", surveyName: "intro", zzzzzzzzzz: "x" },
    ];

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "zzzzzzzzzz",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain(
      "Unrecognized key 'zzzzzzzzzz' on element of type 'survey'.",
    );
    expect(issue!.message).not.toContain("Did you mean");

    const params = (issue as { params?: UnrecognizedKeyIssueParams }).params;
    expect(params?.suggestion).toBeNull();
  });
});

describe("safeParseTreatmentFile — condition unrecognized keys", () => {
  it("identifies the comparator and suggests value for 'val'", () => {
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].elements = [
      {
        type: "submitButton",
        conditions: [
          {
            reference: "self.prompt.something",
            comparator: "equals",
            value: "ok",
            val: 3,
          },
        ],
      },
    ];

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "val",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toBe(
      "Unrecognized key 'val' on condition with comparator 'equals'. Did you mean 'value'? Valid keys: reference, comparator, value",
    );
  });
});

describe("safeParseTreatmentFile — stage / treatment / discussion / player", () => {
  it("labels stage-level bad keys as 'stage'", () => {
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].game = 300; // typo for `duration`/`name`/etc.

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "game",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("on stage.");
    expect(issue!.message).toContain("Valid keys:");
  });

  it("labels treatment-level bad keys as 'treatment'", () => {
    const tf = makeBaseTreatmentFile();
    (tf.treatments as Record<string, unknown>[])[0].plyerCount = 1;

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "plyerCount",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toBe(
      "Unrecognized key 'plyerCount' on treatment. Did you mean 'playerCount'? Valid keys: name, notes, playerCount, introSequences, locale, groupComposition, gameStages, exitSequence",
    );
  });

  it("labels discussion-level bad keys as 'discussion'", () => {
    const tf = makeBaseTreatmentFile();
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].discussion = {
      chatType: "text",
      showNickname: true,
      showTitle: true,
      // `reactToself` → `reactToSelf` is a single-char (case) edit;
      // well within the default Levenshtein threshold.
      reactToself: false,
    };

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "reactToself",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("on discussion.");
    expect(issue!.message).toContain("Did you mean 'reactToSelf'");
  });

  it("labels player blocks as 'player block'", () => {
    const tf = makeBaseTreatmentFile();
    (tf.treatments as Record<string, unknown>[])[0].groupComposition = [
      { position: 0, ttle: "x" }, // typo for title
    ];

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "ttle",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("on player block.");
    expect(issue!.message).toContain("Did you mean 'title'");
  });

  it("labels intro-step bad keys as 'intro/exit step'", () => {
    const tf = makeBaseTreatmentFile();
    const introStep = (tf.introSequences as Record<string, unknown>[])[0]
      .introSteps as Record<string, unknown>[];
    introStep[0].nme = "welcome"; // typo for `name`

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "nme",
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toContain("on intro/exit step.");
    expect(issue!.message).toContain("Did you mean 'name'");
  });
});

describe("safeParseTreatmentFile — fallbacks", () => {
  it("emits the bare 'Unrecognized key X.' form when the container is unknown", () => {
    // A bad key directly at the treatment-file root won't classify into
    // any of the named containers (last segment is a string at depth 0,
    // not "treatments"/"gameStages"/etc.). The wrapper should fall back
    // to the no-suggestion, no-key-list form.
    const tf = makeBaseTreatmentFile();
    // Treatment-file root is not strict (no .strict() on
    // treatmentFileSchema's outer object), so an unknown key at depth 0
    // wouldn't trip Zod. Instead, force an unknown-container case by
    // putting a bad key inside a layoutFeed (that schema is strict but
    // not on our recognized list) — depth-0 unknown isn't reachable.
    const stage = (tf.treatments as Record<string, unknown>[])[0]
      .gameStages as Record<string, unknown>[];
    stage[0].discussion = {
      chatType: "video",
      showNickname: true,
      showTitle: true,
      layout: {
        "0": {
          grid: { rows: 1, cols: 1 },
          feeds: [
            {
              source: { type: "self" },
              displayRegion: { rows: 0, cols: 0 },
              bogus: 1, // unknown key on a layoutFeed (not classified)
            },
          ],
        },
      },
    };

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) => i.path[i.path.length - 1] === "bogus",
    );
    expect(issue).toBeDefined();
    // Container path doesn't end with one of our named segments
    // (it ends with `feeds[0]`), so we fall back to the bare form.
    expect(issue!.message).toBe("Unrecognized key 'bogus'.");

    const params = (issue as { params?: UnrecognizedKeyIssueParams }).params;
    expect(params).toEqual({
      badKey: "bogus",
      suggestion: null,
      validKeys: null,
    });
  });

  it("passes through non-unrecognized-keys issues unchanged", () => {
    const tf = makeBaseTreatmentFile();
    (tf.treatments as Record<string, unknown>[])[0].playerCount =
      "not-a-number";

    const result = safeParseTreatmentFile(tf);
    if (result.success) {
      throw new Error("expected failure");
    }
    const issue = result.error.issues.find(
      (i) =>
        i.code === "invalid_type" &&
        i.path[i.path.length - 1] === "playerCount",
    );
    expect(issue).toBeDefined();
  });

  it("returns success unchanged for valid input", () => {
    const tf = makeBaseTreatmentFile();
    const result = safeParseTreatmentFile(tf);
    expect(result.success).toBe(true);
  });
});
