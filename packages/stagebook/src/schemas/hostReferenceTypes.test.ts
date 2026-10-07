import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { hostReferenceType } from "./hostReferenceTypes.js";

const { hostRecordSchemas } = vi.hoisted(() => ({
  hostRecordSchemas: {} as Record<string, z.ZodType>,
}));

vi.mock("./hostRecords.js", () => ({ hostRecordSchemas }));

// Exercise schema shapes independently of which ones current hosts happen
// to use. Expression type tests also cover the real saved-record schemas.
function typeAt(schema: z.ZodType, path: readonly string[] = []) {
  hostRecordSchemas.fixture = schema;
  return hostReferenceType("fixture", path);
}

describe("host schema inspection", () => {
  const record = z.object({ score: z.number() });

  test.each([
    ["optional", record.optional()],
    ["nullable", record.nullable()],
    ["readonly", record.readonly()],
    ["default", record.default({ score: 0 })],
    ["prefault", record.prefault({ score: 0 })],
    ["catch", record.catch({ score: 0 })],
    ["nonoptional", record.optional().nonoptional()],
    ["branded", record.brand<"Score">()],
    ["refined", record.refine(({ score }) => score >= 0)],
  ])("follows %s schemas to their present field types", (_, schema) => {
    expect(typeAt(schema, ["score"])).toEqual({
      kind: "known",
      type: "number",
    });
    expect(typeAt(schema, ["score", "extra"])).toMatchObject({
      kind: "invalid",
    });
  });

  test.each([
    ["transform", record.transform(({ score }) => String(score))],
    ["preprocess", z.preprocess(Number, z.number())],
    ["pipe", z.string().pipe(z.string().min(1))],
    ["standalone transform", z.transform(String)],
  ])("keeps %s output types gradual", (_, schema) => {
    expect(typeAt(schema)).toMatchObject({
      kind: "unknown",
      detail: "the host field has a transformed type",
    });
  });

  test.each([
    ["strip", z.object({})],
    ["strict", z.strictObject({})],
  ])("rejects undeclared fields on %s objects", (_, schema) => {
    expect(typeAt(schema, ["extra"])).toMatchObject({ kind: "invalid" });
  });

  test("distinguishes passthrough fields from declared unknown fields", () => {
    const schema = z.looseObject({ declared: z.unknown() });
    expect(typeAt(schema, ["extra", "nested"])).toMatchObject({
      kind: "unknown",
      unlisted: true,
    });
    expect(typeAt(schema, ["declared"])).toEqual({
      kind: "unknown",
      detail: "the host field has no declared type",
    });
  });

  test("follows typed catchalls and record values", () => {
    for (const schema of [
      z.object({}).catchall(record),
      z.record(z.string(), record),
    ]) {
      expect(typeAt(schema)).toEqual({ kind: "known", type: "record" });
      expect(typeAt(schema, ["extra", "score"])).toEqual({
        kind: "known",
        type: "number",
      });
      expect(typeAt(schema, ["extra", "score", "nested"])).toMatchObject({
        kind: "invalid",
      });
    }
  });

  test("uses fields declared in only one open union variant", () => {
    const options = [
      z.looseObject({ mode: z.literal("range"), start: z.number() }),
      z.looseObject({ mode: z.literal("point"), time: z.number() }),
    ] as const;
    for (const schema of [
      z.union(options),
      z.discriminatedUnion("mode", options),
    ]) {
      expect(typeAt(schema, ["start"])).toEqual({
        kind: "known",
        type: "number",
      });
      expect(typeAt(schema, ["time"])).toEqual({
        kind: "known",
        type: "number",
      });
      expect(typeAt(schema, ["extra"])).toMatchObject({
        kind: "unknown",
        unlisted: true,
      });
    }
  });

  test.each([
    [z.literal(["click", "blur"]), "string"],
    [z.literal([1, 2]), "number"],
    [z.literal([true, false]), "boolean"],
    [z.literal([null, undefined]), "missing"],
    [z.enum({ first: 1, second: 2 }), "number"],
  ])("reads all values of a literal or enum", (schema, type) => {
    expect(typeAt(schema)).toEqual({ kind: "known", type });
  });

  test("reads string literal paths and keeps mixed literal types gradual", () => {
    expect(typeAt(z.literal(["click", "blur"]), ["length"])).toEqual({
      kind: "known",
      type: "number",
    });
    expect(typeAt(z.literal(["click", 1]))).toMatchObject({ kind: "unknown" });
    expect(typeAt(z.literal([1, 2]), ["length"])).toMatchObject({
      kind: "invalid",
    });
  });

  test("preserves list element types through wrappers", () => {
    expect(typeAt(z.array(z.string().nullable()).readonly())).toEqual({
      kind: "known",
      type: { list: "string" },
    });
  });
});
