import { describe, test, expect } from "vitest";
import { sanitizeName, deriveStorageKeyName } from "./deriveStorageKeyName.js";
import { referenceNameSchema, nameSchema } from "../schemas/primitives.js";
import { parseDottedReference } from "../schemas/reference.js";

describe("sanitizeName", () => {
  test("strips .prompt.md trailing extension", () => {
    expect(sanitizeName("foo.prompt.md")).toBe("foo");
  });

  test("replaces slashes with underscores", () => {
    expect(sanitizeName("game/topics/abortion")).toBe("game_topics_abortion");
  });

  test("replaces interior dots with underscores", () => {
    expect(sanitizeName("game.topics.abortion")).toBe("game_topics_abortion");
  });

  test("strips .prompt.md before sanitizing slashes", () => {
    expect(sanitizeName("game/topics/abortion.prompt.md")).toBe(
      "game_topics_abortion",
    );
  });

  test("replaces other disallowed chars with underscores", () => {
    expect(sanitizeName("foo!@#bar")).toBe("foo___bar");
  });

  test("preserves allowed characters (alphanumeric, space, _, -)", () => {
    expect(sanitizeName("foo bar_baz-qux")).toBe("foo bar_baz-qux");
  });
});

describe("deriveStorageKeyName", () => {
  test("real production example #1: returns plain sanitized form when ≤256 chars", () => {
    // From the issue #359 examples:
    const input = "game_0_attitude_attributes_topics/abortion.prompt.md";
    const result = deriveStorageKeyName(input);
    expect(result).toBe("game_0_attitude_attributes_topics_abortion");
    expect(referenceNameSchema.safeParse(result).success).toBe(true);
  });

  test("real production example #2: 75-char path passes the lookup cap without hashing", () => {
    // From the issue #359 examples — this was reported as exceeding the
    // previous 64-char cap. Under the relaxed 256-char lookup cap it
    // fits without hashing.
    const input =
      "game_0_attitude_attributes_game/attitude_attribute_instructions_A.prompt.md";
    const result = deriveStorageKeyName(input);
    expect(result.length).toBeLessThanOrEqual(256);
    expect(referenceNameSchema.safeParse(result).success).toBe(true);
    // Hashing should NOT have fired for this length — the result is the
    // straight sanitization.
    expect(result).toBe(
      "game_0_attitude_attributes_game_attitude_attribute_instructions_A",
    );
  });

  test("inputs over 256 chars get truncated with an 8-char hash suffix", () => {
    const input = "a/".repeat(200); // 400 chars, alternating a and /
    const result = deriveStorageKeyName(input);
    expect(result.length).toBeLessThanOrEqual(256);
    // Last 9 chars: underscore + 8 hex chars
    expect(result.slice(-9)).toMatch(/^_[0-9a-f]{8}$/);
  });

  test("hash is deterministic — same input produces same output", () => {
    const long = "x".repeat(300);
    expect(deriveStorageKeyName(long)).toBe(deriveStorageKeyName(long));
  });

  test("two long inputs sharing a long common prefix produce distinct outputs", () => {
    const prefix = "shared_".repeat(40); // 280 chars of common prefix
    const a = prefix + "_alpha";
    const b = prefix + "_beta";
    const ra = deriveStorageKeyName(a);
    const rb = deriveStorageKeyName(b);
    expect(ra).not.toBe(rb);
    // Both still pass the lookup schema
    expect(referenceNameSchema.safeParse(ra).success).toBe(true);
    expect(referenceNameSchema.safeParse(rb).success).toBe(true);
  });

  test("output always satisfies referenceNameSchema", () => {
    const cases = [
      "simple",
      "game/topics/abortion.prompt.md",
      "with spaces and-dashes",
      "x".repeat(500),
      "weird!@#$chars/in/path",
    ];
    for (const input of cases) {
      const result = deriveStorageKeyName(input);
      const parsed = referenceNameSchema.safeParse(result);
      expect(
        parsed.success,
        `failed for input ${JSON.stringify(input)}: ${result}`,
      ).toBe(true);
    }
  });

  test("authoring nameSchema rejects what the lookup schema accepts (≥65 chars)", () => {
    // Confirms the split: authoring stays strict, lookup is permissive.
    const long = "a".repeat(100);
    expect(referenceNameSchema.safeParse(long).success).toBe(true);
    expect(nameSchema.safeParse(long).success).toBe(false);
  });

  test("end-to-end: synthesized reference parses without error (#331, #359)", () => {
    // Mirrors the synthesis flow in Element.tsx — given a progress
    // label and a bad file path, the synthesized reference must round-trip
    // through `parseDottedReference` without error.
    const progressLabel = "game_16";
    const filePath = "game/pre_A_shared.prompt.md";
    const promptName = deriveStorageKeyName(`${progressLabel}_${filePath}`);
    const refStr = `self.prompt.${promptName}`;
    const parsed = parseDottedReference(refStr);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        position: "self",
        source: "prompt",
        name: promptName,
      });
    }
  });
});
