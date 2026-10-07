import { z } from "zod";
import type { ExpressionStaticType } from "./expression.js";
import { hostRecordSchemas, type HostRecordSource } from "./hostRecords.js";

export type HostReferenceTypeResult =
  | { kind: "known"; type: ExpressionStaticType }
  | { kind: "unknown"; detail: string; unlisted?: true }
  | { kind: "invalid"; detail: string };

const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const known = (type: ExpressionStaticType): HostReferenceTypeResult => ({
  kind: "known",
  type,
});
const invalid = (): HostReferenceTypeResult => ({
  kind: "invalid",
  detail: "the path cannot be traversed through the declared host field type",
});

function union(results: HostReferenceTypeResult[]): HostReferenceTypeResult {
  // Timeline modes have different optional fields on open records. A declared
  // field in one mode supplies its type; its absence from another mode does
  // not make it an untyped passthrough field everywhere.
  const declared = results.filter(
    (result) => !(result.kind === "unknown" && result.unlisted),
  );
  if (declared.length === 0) return results[0];
  const unknown = declared.find((result) => result.kind === "unknown");
  if (unknown) return unknown;
  const present = declared.filter((result) => result.kind === "known");
  if (present.length === 0) return invalid();
  const types = present.map((result) => JSON.stringify(result.type));
  return new Set(types).size === 1
    ? present[0]
    : {
        kind: "unknown",
        detail:
          "declared host schema variants disagree about this field's type",
      };
}

/** Follow the actual saved-record schemas rather than maintaining field tables.
 * Optional/nullable fields have the type of their present values. */
function atPath(
  schema: z.core.$ZodType,
  path: readonly string[],
  depth = 0,
): HostReferenceTypeResult {
  if (depth > 128)
    return { kind: "unknown", detail: "the host schema is too deeply nested" };
  const next = (inner: z.core.$ZodType, rest = path) =>
    atPath(inner, rest, depth + 1);
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodNonOptional
  )
    return next(schema.unwrap());
  // Zod 4 stores refinements and brands on their underlying schema. Pipes
  // and transforms can change its type, so they remain gradual here.
  if (schema instanceof z.ZodPipe || schema instanceof z.ZodTransform)
    return { kind: "unknown", detail: "the host field has a transformed type" };
  if (schema instanceof z.ZodUnion)
    return union(schema.options.map((option) => next(option)));
  if (schema instanceof z.ZodObject) {
    if (path.length === 0) return known("record");
    const [key, ...rest] = path;
    const shape = schema.shape as z.core.$ZodShape;
    if (own(shape, key)) return next(shape[key], rest);
    const catchall = schema.def.catchall;
    // In Zod 4, passthrough objects have an unknown catchall; strip objects
    // have none, and strict objects have a never catchall.
    if (!catchall || catchall instanceof z.ZodNever) return invalid();
    return catchall instanceof z.ZodUnknown
      ? {
          kind: "unknown",
          unlisted: true,
          detail: `field ${key} is a passthrough field without a declared type`,
        }
      : next(catchall, rest);
  }
  if (schema instanceof z.ZodArray) {
    if (path.length === 0) {
      const element = next(schema.element, []);
      return element.kind === "known" ? known({ list: element.type }) : element;
    }
    const [key, ...rest] = path;
    if (key === "length") return next(z.number(), rest);
    return /^(0|[1-9]\d*)$/.test(key) ? next(schema.element, rest) : invalid();
  }
  if (schema instanceof z.ZodRecord)
    return path.length === 0
      ? known("record")
      : next(schema.valueType, path.slice(1));
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny)
    return { kind: "unknown", detail: "the host field has no declared type" };
  if (schema instanceof z.ZodEnum || schema instanceof z.ZodLiteral) {
    const values =
      schema instanceof z.ZodEnum ? schema.options : [...schema.values];
    return union(
      values.map((value) => {
        if (typeof value === "string") return next(z.string());
        if (typeof value === "number") return next(z.number());
        if (typeof value === "boolean") return next(z.boolean());
        if (value === null || value === undefined) return next(z.null());
        return path.length > 0
          ? invalid()
          : {
              kind: "unknown",
              detail: "the host field is not an expression value",
            };
      }),
    );
  }
  if (schema instanceof z.ZodString) {
    if (path.length === 0) return known("string");
    const [key, ...rest] = path;
    if (key === "length") return next(z.number(), rest);
    return /^(0|[1-9]\d*)$/.test(key) ? next(z.string(), rest) : invalid();
  }
  if (path.length > 0) return invalid();
  if (schema instanceof z.ZodNumber) return known("number");
  if (schema instanceof z.ZodBoolean) return known("boolean");
  if (
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodUndefined ||
    schema instanceof z.ZodNever
  )
    return known("missing");
  return {
    kind: "unknown",
    detail: "the host field type is not yet supported",
  };
}

/** Undefined means this source has no saved-record schema. URL parameters have
 * their existing string contract even though they are not host record helpers. */
export function hostReferenceType(
  source: string,
  path: readonly string[],
): HostReferenceTypeResult | undefined {
  if (path.some((segment) => forbidden.has(segment))) return invalid();
  if (source === "entryUrl")
    return path[0] === "params" && path.length >= 2
      ? atPath(z.string(), path.slice(2))
      : invalid();
  return own(hostRecordSchemas, source)
    ? atPath(hostRecordSchemas[source as HostRecordSource], path)
    : undefined;
}
