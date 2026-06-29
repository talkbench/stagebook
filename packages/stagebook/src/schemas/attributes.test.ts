import { describe, test, expect } from "vitest";
import { attributesSchema, hasStableParticipantId } from "./attributes.js";

describe("attributesSchema", () => {
  test("accepts a minimal bag with only stableParticipantId", () => {
    expect(
      attributesSchema.safeParse({ stableParticipantId: "abc" }).success,
    ).toBe(true);
  });

  test("rejects a missing or empty stableParticipantId", () => {
    expect(attributesSchema.safeParse({}).success).toBe(false);
    expect(
      attributesSchema.safeParse({ stableParticipantId: "" }).success,
    ).toBe(false);
  });

  test("sampleId is optional (absent pre-assignment)", () => {
    expect(
      attributesSchema.safeParse({ stableParticipantId: "abc" }).success,
    ).toBe(true);
    expect(
      attributesSchema.safeParse({
        stableParticipantId: "abc",
        sampleId: "row-1",
      }).success,
    ).toBe(true);
  });

  test("passes through host-added fields without a schema change", () => {
    const parsed = attributesSchema.parse({
      stableParticipantId: "abc",
      country: "US",
      screenWidth: 1280,
      customCohort: "panel-a",
    });
    expect(parsed.customCohort).toBe("panel-a");
    expect(parsed.country).toBe("US");
  });
});

describe("hasStableParticipantId", () => {
  test("true only for a non-empty, non-whitespace string id", () => {
    expect(hasStableParticipantId({ stableParticipantId: "abc" })).toBe(true);
    expect(hasStableParticipantId({ stableParticipantId: "" })).toBe(false);
    expect(hasStableParticipantId({ stableParticipantId: "   " })).toBe(false);
    expect(hasStableParticipantId({})).toBe(false);
    expect(hasStableParticipantId(undefined)).toBe(false);
    expect(hasStableParticipantId(null)).toBe(false);
    expect(hasStableParticipantId([{ stableParticipantId: "abc" }])).toBe(
      false,
    );
  });

  test("tolerates loosely-typed soft fields (only the id matters)", () => {
    // A host that typed screenWidth as a string still passes the gate —
    // the mount check enforces presence of the export id, not full shape.
    expect(
      hasStableParticipantId({
        stableParticipantId: "abc",
        screenWidth: "1280",
      }),
    ).toBe(true);
  });
});
