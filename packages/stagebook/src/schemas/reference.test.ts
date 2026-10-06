import { describe, expect, test } from "vitest";
import {
  externalReferenceSchema,
  formatReference,
  namedReferenceSchema,
  parseDottedReference,
  positionSelectorSchema,
  referenceSchema,
} from "./reference.js";

describe("everyone references (#757)", () => {
  test.each([
    [
      "everyone.prompt.answer.value",
      {
        position: "everyone",
        source: "prompt",
        name: "answer",
        path: ["value"],
      },
    ],
    [
      "everyone.attributes.country",
      { position: "everyone", source: "attributes", path: ["country"] },
    ],
    [
      "everyone.entryUrl.params.condition",
      {
        position: "everyone",
        source: "entryUrl",
        path: ["params", "condition"],
      },
    ],
    [
      "everyone.timeline.selection.0.start",
      {
        position: "everyone",
        source: "timeline",
        name: "selection",
        path: ["0", "start"],
      },
    ],
  ])("parses both forms of %s identically", (string, structured) => {
    expect(referenceSchema.parse(string)).toEqual(structured);
    expect(referenceSchema.parse(structured)).toEqual(structured);
    expect(formatReference(referenceSchema.parse(structured))).toBe(string);
  });
  test.each(["self", "shared", "everyone", 0, 2])(
    "accepts position %s",
    (position) => {
      expect(positionSelectorSchema.parse(position)).toBe(position);
    },
  );
  test("retains normalization of quoted numeric structured positions", () => {
    expect(
      referenceSchema.parse({ position: "2", source: "prompt", name: "x" }),
    ).toEqual({ position: 2, source: "prompt", name: "x" });
  });
  test.each([
    "all.prompt.answer.value",
    "all.attributes.country",
    { position: "all", source: "prompt", name: "answer", path: ["value"] },
    { position: "all", source: "attributes", path: ["country"] },
  ])("rejects legacy all with an actionable migration hint", (reference) => {
    const parsed = referenceSchema.safeParse(reference);
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.message).toMatch(/all.*renamed.*everyone/i);
  });
  test("individual reference schemas also reject old position all with the hint", () => {
    expect(() =>
      namedReferenceSchema.parse({
        position: "all",
        source: "prompt",
        name: "x",
      }),
    ).toThrow(/all.*renamed.*everyone/i);
    expect(() =>
      externalReferenceSchema.parse({
        position: "all",
        source: "attributes",
        path: ["country"],
      }),
    ).toThrow(/all.*renamed.*everyone/i);
  });
  test.each([
    -1,
    1.5,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    "-1",
    "1.5",
    "9007199254740992",
    "player",
    "any",
  ])("rejects invalid position %s", (position) => {
    expect(positionSelectorSchema.safeParse(position).success).toBe(false);
  });
  test.each([
    "everyone.prompt",
    "everyone.attributes",
    "everyone.entryUrl.country",
    "everyone.entryUrl.params",
    "everyone.prompt.answer..value",
    "everyone.prompt.answer.",
    "01.prompt.answer",
    "9007199254740992.prompt.answer",
  ])("keeps source, path and numeric-seat validation for %s", (reference) => {
    expect(parseDottedReference(reference).ok).toBe(false);
  });
  test("missing-prefix diagnostic names the current selectors", () => {
    const parsed = parseDottedReference("prompt.answer.value");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.message).toContain("`everyone`");
      expect(parsed.message).not.toContain("`all`");
    }
  });
});
