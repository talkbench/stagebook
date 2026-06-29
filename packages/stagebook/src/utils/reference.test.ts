import { describe, test, expect } from "vitest";
import { getReferenceKeyAndPath, getNestedValueByPath } from "./reference.js";

// ----------- getReferenceKeyAndPath ------------

describe("getReferenceKeyAndPath", () => {
  test("survey reference", () => {
    const result = getReferenceKeyAndPath("self.survey.bigFive.result.score");
    expect(result.referenceKey).toBe("survey_bigFive");
    expect(result.path).toEqual(["result", "score"]);
  });

  test("submitButton reference", () => {
    const result = getReferenceKeyAndPath("self.submitButton.continue.time");
    expect(result.referenceKey).toBe("submitButton_continue");
    expect(result.path).toEqual(["time"]);
  });

  test("qualtrics reference", () => {
    const result = getReferenceKeyAndPath(
      "self.qualtrics.mySurvey.responses.Q1",
    );
    expect(result.referenceKey).toBe("qualtrics_mySurvey");
    expect(result.path).toEqual(["responses", "Q1"]);
  });

  test("prompt reference defaults path to ['value']", () => {
    const result = getReferenceKeyAndPath("self.prompt.myQuestion");
    expect(result.referenceKey).toBe("prompt_myQuestion");
    expect(result.path).toEqual(["value"]);
  });

  test("trackedLink reference", () => {
    const result = getReferenceKeyAndPath("self.trackedLink.followUp.events");
    expect(result.referenceKey).toBe("trackedLink_followUp");
    expect(result.path).toEqual(["events"]);
  });

  test("entryUrl.params reference (renamed from urlParams in #246)", () => {
    const result = getReferenceKeyAndPath("self.entryUrl.params.condition");
    expect(result.referenceKey).toBe("entryUrl");
    expect(result.path).toEqual(["params", "condition"]);
  });

  test("legacy urlParams.<key> reference is rejected with a migration hint", () => {
    expect(() => getReferenceKeyAndPath("urlParams.condition")).toThrow(
      /entryUrl\.params/,
    );
  });

  test("attributes reference (connectionInfo+browserInfo+participantInfo merged flat in #473)", () => {
    // The three legacy host-supplied bags are unified under one flat
    // `attributes` source; the field is addressed via the nested path.
    const result = getReferenceKeyAndPath("self.attributes.country");
    expect(result.referenceKey).toBe("attributes");
    expect(result.path).toEqual(["country"]);
  });

  test("attributes identity reference: stableParticipantId", () => {
    const result = getReferenceKeyAndPath(
      "self.attributes.stableParticipantId",
    );
    expect(result.referenceKey).toBe("attributes");
    expect(result.path).toEqual(["stableParticipantId"]);
  });

  test("attributes reference with deep path", () => {
    const result = getReferenceKeyAndPath("self.attributes.sampleId.raw");
    expect(result.referenceKey).toBe("attributes");
    expect(result.path).toEqual(["sampleId", "raw"]);
  });

  test("legacy bag sources are rejected after the #473 consolidation", () => {
    for (const legacy of ["connectionInfo", "browserInfo", "participantInfo"]) {
      expect(() => getReferenceKeyAndPath(`self.${legacy}.country`)).toThrow(
        /Invalid reference source/,
      );
    }
  });

  test("timeline reference", () => {
    const result = getReferenceKeyAndPath("self.timeline.myAnnotations");
    expect(result.referenceKey).toBe("timeline_myAnnotations");
    expect(result.path).toEqual([]);
  });

  test("discussion reference (now namespaced as `discussion_<name>` per #240)", () => {
    const result = getReferenceKeyAndPath("self.discussion.main.messageCount");
    expect(result.referenceKey).toBe("discussion_main");
    expect(result.path).toEqual(["messageCount"]);
  });

  test("throws on invalid reference type", () => {
    expect(() => getReferenceKeyAndPath("self.duck.quack")).toThrow(
      'Invalid reference source "duck"',
    );
  });

  test("throws on missing name segment", () => {
    expect(() => getReferenceKeyAndPath("self.survey")).toThrow();
  });

  test("throws on missing path segment for external sources", () => {
    // External-source references require at least one path segment.
    expect(() => getReferenceKeyAndPath("self.attributes")).toThrow(
      "A path must be provided",
    );
    expect(() => getReferenceKeyAndPath("self.entryUrl")).toThrow(
      "A path must be provided",
    );
  });

  test("entryUrl bare-key is rejected by the dotted-string parser (`params` subpath required)", () => {
    // The `params` subpath check on `entryUrl` lives in
    // `externalReferenceSchema.superRefine` and runs through
    // `parseDottedReference`'s post-validation.
    expect(() => getReferenceKeyAndPath("self.entryUrl.condition")).toThrow(
      /entryUrl\.params/,
    );
  });

  // ----- Structured form (#240) -----

  test("structured named reference: prompt with no path defaults to ['value']", () => {
    const result = getReferenceKeyAndPath({
      source: "prompt",
      name: "myQuestion",
    });
    expect(result.referenceKey).toBe("prompt_myQuestion");
    expect(result.path).toEqual(["value"]);
  });

  test("structured named reference: prompt with explicit override path", () => {
    // The new capability — write `path: [debugMessages]` to address other
    // fields on the prompt record beyond the implicit `value`.
    const result = getReferenceKeyAndPath({
      source: "prompt",
      name: "myQuestion",
      path: ["debugMessages"],
    });
    expect(result.referenceKey).toBe("prompt_myQuestion");
    expect(result.path).toEqual(["debugMessages"]);
  });

  test("structured named reference: discussion uses the discussion_<name> namespace", () => {
    const result = getReferenceKeyAndPath({
      source: "discussion",
      name: "lobby",
    });
    expect(result.referenceKey).toBe("discussion_lobby");
    expect(result.path).toEqual([]);
  });

  test("structured external reference: entryUrl.params.<key>", () => {
    const result = getReferenceKeyAndPath({
      source: "entryUrl",
      path: ["params", "condition"],
    });
    expect(result.referenceKey).toBe("entryUrl");
    expect(result.path).toEqual(["params", "condition"]);
  });

  test("string and structured forms produce equivalent output", () => {
    expect(getReferenceKeyAndPath("self.survey.TIPI.responses.q1")).toEqual(
      getReferenceKeyAndPath({
        source: "survey",
        name: "TIPI",
        path: ["responses", "q1"],
      }),
    );
    expect(getReferenceKeyAndPath("self.entryUrl.params.PROLIFIC_PID")).toEqual(
      getReferenceKeyAndPath({
        source: "entryUrl",
        path: ["params", "PROLIFIC_PID"],
      }),
    );
  });
});

// ----------- getNestedValueByPath ------------

describe("getNestedValueByPath", () => {
  test("traverses nested object", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getNestedValueByPath(obj, ["a", "b", "c"])).toBe(42);
  });

  test("returns undefined for missing path", () => {
    const obj = { a: { b: 1 } };
    expect(getNestedValueByPath(obj, ["a", "x", "y"])).toBeUndefined();
  });

  test("empty path returns the object itself", () => {
    const obj = { a: 1 };
    expect(getNestedValueByPath(obj, [])).toEqual({ a: 1 });
  });

  test("default path is empty array", () => {
    const obj = { a: 1 };
    expect(getNestedValueByPath(obj)).toEqual({ a: 1 });
  });

  test("rejects prototype-polluting path segments", () => {
    // Arbitrary reference paths must not be able to traverse into
    // Object.prototype — these segments are denied even if present.
    const obj = {};
    expect(getNestedValueByPath(obj, ["__proto__"])).toBeUndefined();
    expect(getNestedValueByPath(obj, ["constructor"])).toBeUndefined();
    expect(getNestedValueByPath(obj, ["prototype"])).toBeUndefined();
    expect(
      getNestedValueByPath(obj, ["__proto__", "polluted"]),
    ).toBeUndefined();
  });
});
