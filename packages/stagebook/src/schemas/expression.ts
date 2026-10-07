import { z } from "zod";
import {
  EXPRESSION_OPERATORS,
  type ExpressionOperandLayout,
  type ExpressionOperatorDefinition,
  type ExpressionValueType,
} from "../expressions/operators.js";
import type { ExpressionReference } from "../expressions/evaluateExpression.js";
import { referenceSchema } from "./reference.js";
import { nameSchema } from "./primitives.js";
import { parseRegexLiteral, validateRegex } from "../expressions/regex.js";

type LiteralScalar = string | number | boolean | null;
type ReferenceDescriptor = z.infer<typeof rawReferenceSchema>;
type ExistingOperator =
  | "sumExisting"
  | "averageExisting"
  | "minExisting"
  | "maxExisting";
type CollectionOperator = Exclude<
  keyof typeof EXPRESSION_OPERATORS,
  | ExistingOperator
  | "includes"
  | "matches"
  | "subtract"
  | "divide"
  | "length"
  | "case"
  | "firstExisting"
>;

// Explicit recursive annotations keep the public AST precise. Leaf/template
// fields below are inferred from their schemas; this map supplies the recursive
// operator edges rather than erasing the public AST to Record<string, unknown>.
interface ExpressionRecursion {
  collection: {
    [K in CollectionOperator]: { [P in K]: ExpressionInput };
  }[CollectionOperator];
  existing: {
    [K in ExistingOperator]: {
      [P in K]:
        | ExpressionInput
        | { inputs: ExpressionInput; atLeast?: number | string };
    };
  }[ExistingOperator];
}
type DeferredExpression = string | TemplateInvocation;
type ExpressionInput = ExpressionNode | ExpressionNode[];
type CaseRule =
  | { when: ExpressionNode; value: ExpressionNode }
  | { default: true | string; value: ExpressionNode }
  | DeferredExpression;
export type ExpressionNode =
  | LiteralScalar
  | TemplateInvocation
  | ComparatorLeaf
  | { reference: ReferenceDescriptor }
  | { literal: LiteralScalar | LiteralScalar[] | TemplateInvocation }
  | ExpressionRecursion["collection"]
  | ExpressionRecursion["existing"]
  | {
      includes:
        | {
            container: ExpressionNode;
            members: ExpressionNode[] | DeferredExpression;
          }
        | DeferredExpression;
    }
  | {
      matches:
        | {
            string: ExpressionNode;
            patterns: string[] | DeferredExpression;
            flags?: string;
          }
        | DeferredExpression;
    }
  | {
      subtract:
        | { from: ExpressionNode; value: ExpressionNode }
        | DeferredExpression;
    }
  | {
      divide:
        | { numerator: ExpressionNode; denominator: ExpressionNode }
        | DeferredExpression;
    }
  | { length: ExpressionNode }
  | { firstExisting: ExpressionNode[] | DeferredExpression }
  | { case: { rules: CaseRule[] | DeferredExpression } | DeferredExpression };
export type ExpressionConditions = ExpressionNode | ExpressionNode[];

export type ExpressionStaticType =
  | "number"
  | "string"
  | "boolean"
  | "record"
  | "unknown"
  | "missing"
  | { list: ExpressionStaticType };

export interface ExpressionSchemaOptions {
  mode: "authoring" | "resolved";
  /** The final reference value type. Group references include their list shape.
   * Unknown reference types remain gradual; warnings belong to validation. */
  referenceType?: (
    reference: ExpressionReference,
  ) => ExpressionStaticType | undefined;
  /** Inject treatment.ts's templateContextSchema when composing its schemas,
   * avoiding a circular dependency from this module back into treatment.ts. */
  templateSchema?: z.ZodType;
  /** Syntax checking only; defaults to the native JavaScript regex validator.
   * An override must never match researcher patterns against text. */
  validateRegex?: (pattern: string, flags: string) => string | undefined;
}

type Path = PropertyKey[];
type ScalarType = "number" | "string" | "boolean";
type Type =
  | { kind: "unknown" | "missing" | "record" }
  | { kind: "scalar"; type: ScalarType }
  | { kind: "list"; element: Type; groupLeaf?: boolean };

const unknownType: Type = { kind: "unknown" };
const missingType: Type = { kind: "missing" };
const numberType: Type = { kind: "scalar", type: "number" };
const booleanType: Type = { kind: "scalar", type: "boolean" };
const stringType: Type = { kind: "scalar", type: "string" };
const PLACEHOLDER = /\$\{[a-zA-Z0-9_]+\}/;
const WHOLE_PLACEHOLDER = /^\$\{[a-zA-Z0-9_]+\}$/;
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const wholePlaceholder = (value: unknown): value is string =>
  typeof value === "string" && WHOLE_PLACEHOLDER.test(value);
const groupConsumers = new Set(["all", "any", "none", "countTrue"]);
const pairOperators = new Set([
  "allEqual",
  "allUnique",
  "strictlyIncreasing",
  "nonDecreasing",
  "strictlyDecreasing",
  "nonIncreasing",
]);
const numericComparators = new Set([
  "isAbove",
  "isBelow",
  "isAtLeast",
  "isAtMost",
]);

// Standalone expression validation supports the same invocation shape. Callers
// embedding this in treatment validation inject the authoritative template schema.
const templateFieldsSchema = z
  .record(
    z
      .string()
      .regex(/^(?!type$)(?!d[0-9]+$)([a-zA-Z0-9_]+|\$\{[a-zA-Z0-9_]+\})$/),
    z.unknown(),
  )
  .superRefine((fields, ctx) => {
    for (const [key, value] of Object.entries(fields)) {
      if (record(value) && own(value, "template"))
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Template invocations are not allowed as fields values.",
        });
    }
  });
const templateBaseSchema = z
  .object({
    template: nameSchema,
    fields: templateFieldsSchema.optional(),
  })
  .strict();
type TemplateInvocation = z.infer<typeof templateBaseSchema> & {
  broadcast?: Record<
    string,
    z.infer<typeof templateFieldsSchema>[] | TemplateInvocation | string
  >;
};
const wholePlaceholderSchema = z.string().regex(WHOLE_PLACEHOLDER);
const defaultTemplateSchema: z.ZodType<TemplateInvocation> = z.lazy(() =>
  templateBaseSchema
    .extend({
      broadcast: z
        .record(
          z.string().regex(/^d\d+$/),
          z.union([
            z.array(templateFieldsSchema).nonempty(),
            defaultTemplateSchema,
            wholePlaceholderSchema,
          ]),
        )
        .optional(),
    })
    .strict(),
);

const rawReferenceSchema = z.union([
  z.string(),
  z
    .object({
      position: z.union([z.number().int().nonnegative().safe(), z.string()]),
      source: z.string(),
      name: z.string().optional(),
      path: z.array(z.string()).optional(),
    })
    .strict(),
]);

function createComparatorSchema(templateSchema: z.ZodType<TemplateInvocation>) {
  const deferred = <T extends z.ZodType>(schema: T) =>
    z.union([schema, wholePlaceholderSchema, templateSchema]);
  const scalar = z.union([z.string(), z.number().finite(), z.boolean()]);
  const comparison = deferred(
    z.union([scalar, z.array(scalar)], {
      error: (issue) =>
        issue.input === null
          ? "Null is not allowed in a comparison value; use exists or doesNotExist for presence."
          : undefined,
    }),
  );
  const leaf = <C extends string, V extends z.ZodType>(name: C, value: V) =>
    z
      .object({
        reference: rawReferenceSchema,
        comparator: z.literal(name),
        value,
      })
      .strict();
  const presence = <C extends string>(name: C) =>
    z
      .object({ reference: rawReferenceSchema, comparator: z.literal(name) })
      .strict();
  const alternatives = [
    presence("exists"),
    presence("doesNotExist"),
    leaf("equals", comparison),
    leaf("doesNotEqual", comparison),
    leaf("isAbove", deferred(z.number().finite())),
    leaf("isBelow", deferred(z.number().finite())),
    leaf("isAtLeast", deferred(z.number().finite())),
    leaf("isAtMost", deferred(z.number().finite())),
    leaf("hasLengthAtLeast", deferred(z.number().int().nonnegative())),
    leaf("hasLengthAtMost", deferred(z.number().int().nonnegative())),
    leaf("includes", deferred(scalar)),
    leaf("doesNotInclude", deferred(scalar)),
    leaf("matches", deferred(z.string())),
    leaf("doesNotMatch", deferred(z.string())),
    leaf("isOneOf", deferred(z.array(scalar).nonempty())),
    leaf("isNotOneOf", deferred(z.array(scalar).nonempty())),
  ] as const;
  return z.discriminatedUnion("comparator", alternatives, {
    error: (issue) =>
      issue.code === "invalid_union"
        ? `Unsupported comparator. Expected one of: ${alternatives
            .map((alternative) => alternative.shape.comparator.value)
            .join(", ")}.`
        : undefined,
  });
}
type ComparatorLeaf = z.infer<ReturnType<typeof createComparatorSchema>>;

/** Keep native issue codes and paths, without retaining recursive union errors.
 * This boundary is applied at every expression, before a parent can accumulate
 * its children's failed alternatives. Deepest existing paths take precedence
 * over Required errors from unrelated union alternatives. */
function nativeStructure<T>(select: (input: unknown) => z.ZodType<T, unknown>) {
  return z.unknown().transform((input, ctx): T => {
    const result = select(input).safeParse(input);
    if (result.success) return result.data;
    const pending = result.error.issues.map((issue) => ({
      issue,
      prefix: [] as PropertyKey[],
    }));
    const visited = new Set<z.ZodIssue>();
    const retained = new Map<
      string,
      { issue: z.ZodIssue; depth: number; quality: number }
    >();
    const compare = (
      left: { depth: number; quality: number },
      right: { depth: number; quality: number },
    ) => left.depth - right.depth || left.quality - right.quality;
    let omitted = false;
    while (pending.length && visited.size < 100000) {
      const { issue, prefix } = pending.pop()!;
      if (visited.has(issue)) continue;
      visited.add(issue);
      const path = [...prefix, ...issue.path];
      if (issue.code === "invalid_union") {
        // Zod 4 stores branch issues with paths relative to the union site.
        // Empty branches also represent an unmatched discriminator, so retain
        // that native issue even when its message is the generic union error.
        for (const errors of issue.errors)
          for (const child of errors)
            pending.push({ issue: child, prefix: path });
        if (issue.errors.length && issue.message === "Invalid input") continue;
      }
      const flat: z.ZodIssue =
        issue.code === "invalid_union"
          ? { ...issue, path, errors: [] }
          : { ...issue, path };
      let site = input;
      let depth = 0;
      for (const key of path) {
        if (site === null || typeof site !== "object" || !(key in site)) {
          site = undefined;
          break;
        }
        site = (site as Record<PropertyKey, unknown>)[key];
        depth++;
      }
      const candidate = {
        issue: flat,
        depth,
        quality:
          issue.code === "invalid_type" ? (site === undefined ? 0 : 1) : 2,
      };
      const key = JSON.stringify(flat);
      if (retained.has(key)) continue;
      if (retained.size === 64) {
        const least = [...retained.entries()].reduce((left, right) =>
          compare(left[1], right[1]) <= 0 ? left : right,
        );
        omitted = true;
        if (compare(candidate, least[1]) <= 0) continue;
        retained.delete(least[0]);
      }
      retained.set(key, candidate);
    }
    for (const { issue } of [...retained.values()].sort((left, right) =>
      compare(right, left),
    ))
      ctx.addIssue({ ...issue, fatal: true });
    if (omitted || pending.length)
      ctx.addIssue({
        code: "custom",
        message: "Additional expression validation errors were omitted.",
        fatal: true,
      });
    return z.NEVER;
  });
}

/** Zod is the canonical structural grammar. Metadata supplies discovery and
 * operand type expectations; each registered key must also have a schema. */
function createExpressionStructure(
  templateSchema: z.ZodType<TemplateInvocation>,
) {
  const deferred = <T extends z.ZodType>(schema: T) =>
    z.union([schema, wholePlaceholderSchema, templateSchema]);
  const scalar = z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
  ]);
  const comparatorSchema = createComparatorSchema(templateSchema);
  const referenceExpressionSchema = z
    .object({
      reference: rawReferenceSchema,
      comparator: z.never().optional(),
      value: z.never().optional(),
    })
    .strict();
  const literalSchema = z
    .object({ literal: deferred(z.union([scalar, z.array(scalar)])) })
    .strict();
  const expression: z.ZodType<ExpressionNode, unknown> =
    nativeStructure<ExpressionNode>((input) => {
      if (!record(input)) return scalar;
      // Routing does not validate a shape: the selected strict native schema
      // still owns required fields, unknown keys, arity, and every operand.
      // Avoid trying 28 irrelevant recursive operators for each known key.
      if ("reference" in input || "comparator" in input)
        return "comparator" in input
          ? comparatorSchema
          : referenceExpressionSchema;
      if ("literal" in input) return literalSchema;
      if ("template" in input) return templateSchema;
      for (const key of Object.keys(operators) as (keyof typeof operators)[])
        if (key in input) return operators[key];
      return unknownExpression;
    });
  const inputs = (minimum = 1) =>
    z.union([z.array(expression).min(minimum), expression]);
  const named = <T extends z.ZodRawShape>(shape: T) =>
    deferred(z.object(shape).strict());
  const existing = deferred(
    z.union([
      named({
        inputs: inputs(),
        atLeast: z
          .union([z.number().int().positive(), wholePlaceholderSchema])
          .optional(),
      }),
      inputs(),
    ]),
  );
  const whenRule = z.object({ when: expression, value: expression }).strict();
  const defaultRule = z
    .object({
      default: z.union([z.literal(true), wholePlaceholderSchema]),
      value: expression,
    })
    .strict();
  // Route selectors to strict schemas so the recursive value parses once.
  // An intersection can discard nested unrecognized-key issues while merging
  // its two sides, and a union repeats recursive work at each default rule.
  const caseRule = deferred(
    nativeStructure<Exclude<CaseRule, DeferredExpression>>((input) =>
      record(input) && "when" in input ? whenRule : defaultRule,
    ),
  );
  const operators = {
    all: z.object({ all: inputs() }).strict(),
    any: z.object({ any: inputs() }).strict(),
    none: z.object({ none: inputs() }).strict(),
    allEqual: z.object({ allEqual: inputs(2) }).strict(),
    allUnique: z.object({ allUnique: inputs(2) }).strict(),
    strictlyIncreasing: z.object({ strictlyIncreasing: inputs(2) }).strict(),
    nonDecreasing: z.object({ nonDecreasing: inputs(2) }).strict(),
    strictlyDecreasing: z.object({ strictlyDecreasing: inputs(2) }).strict(),
    nonIncreasing: z.object({ nonIncreasing: inputs(2) }).strict(),
    includes: z
      .object({
        includes: named({
          container: expression,
          members: deferred(z.array(expression).nonempty()),
        }),
      })
      .strict(),
    matches: z
      .object({
        matches: named({
          string: expression,
          patterns: deferred(z.array(z.string()).nonempty()),
          flags: z.string().optional(),
        }),
      })
      .strict(),
    sum: z.object({ sum: inputs() }).strict(),
    average: z.object({ average: inputs() }).strict(),
    product: z.object({ product: inputs() }).strict(),
    min: z.object({ min: inputs() }).strict(),
    max: z.object({ max: inputs() }).strict(),
    subtract: z
      .object({ subtract: named({ from: expression, value: expression }) })
      .strict(),
    divide: z
      .object({
        divide: named({ numerator: expression, denominator: expression }),
      })
      .strict(),
    length: z.object({ length: expression }).strict(),
    case: z
      .object({
        case: named({ rules: deferred(z.array(caseRule).nonempty()) }),
      })
      .strict(),
    sumExisting: z.object({ sumExisting: existing }).strict(),
    averageExisting: z.object({ averageExisting: existing }).strict(),
    minExisting: z.object({ minExisting: existing }).strict(),
    maxExisting: z.object({ maxExisting: existing }).strict(),
    firstExisting: z
      .object({ firstExisting: deferred(z.array(expression).nonempty()) })
      .strict(),
    countExisting: z.object({ countExisting: inputs() }).strict(),
    countTrue: z.object({ countTrue: inputs() }).strict(),
    countUnique: z.object({ countUnique: inputs() }).strict(),
  } satisfies Record<
    keyof typeof EXPRESSION_OPERATORS,
    z.ZodType<ExpressionNode, unknown>
  >;
  // All recognized grammar keys route above. Unknown objects get native strict
  // key errors, while never rejects the empty object, without constructing
  // missing-field diagnostics for every unrelated operator.
  const unknownExpression = z
    .object({})
    .strict()
    .pipe(
      z.never({
        message:
          "Expected an expression with a reference, literal, template, or operator key.",
      }),
    );
  return {
    expression,
    conditions: nativeStructure(() =>
      z.union([z.array(expression).nonempty(), expression]),
    ),
  };
}

function fromStatic(type: ExpressionStaticType | undefined): Type {
  if (type === undefined || type === "unknown") return unknownType;
  if (type === "missing") return missingType;
  if (type === "record") return { kind: "record" };
  if (typeof type === "object")
    return { kind: "list", element: fromStatic(type.list) };
  return { kind: "scalar", type };
}

function sameKnownType(left: Type, right: Type): boolean {
  if (
    left.kind === "unknown" ||
    right.kind === "unknown" ||
    left.kind === "missing" ||
    right.kind === "missing"
  )
    return true;
  if (left.kind !== right.kind) return false;
  if (left.kind === "record" && right.kind === "record") return true;
  if (left.kind === "scalar" && right.kind === "scalar")
    return left.type === right.type;
  return (
    left.kind === "list" &&
    right.kind === "list" &&
    sameKnownType(left.element, right.element)
  );
}

/** Native Zod structure is followed by semantic type/placement refinements.
 * Unknown references cannot erase another known mismatch. Authored reference
 * descriptors are preserved; readReference owns reading and normalization. */
export function createExpressionSchemas(options: ExpressionSchemaOptions) {
  const authoring = options.mode === "authoring";
  const templateSchema = (options.templateSchema ??
    defaultTemplateSchema) as z.ZodType<TemplateInvocation>;
  const structure = createExpressionStructure(templateSchema);
  const resourceSchema = z.unknown().superRefine((input, ctx) => {
    const active = new Set<object>();
    const issue = (path: Path, message: string) =>
      ctx.addIssue({ code: "custom", path, message, fatal: true });
    // YAML permits cyclic aliases, including inside opaque template fields.
    // Guard the whole object graph before a delegated Zod template parser can
    // recurse into it. Repeated acyclic aliases remain valid authored values.
    let graphNodes = 0;
    function safeGraph(value: unknown, path: Path): boolean {
      if (++graphNodes > 10000 || path.length > 128) {
        issue(path, "Expression exceeds the validation complexity limit.");
        return false;
      }
      if (value === null || typeof value !== "object") return true;
      // Zod's object cloning deliberately drops this key. Reject it before
      // cloning so a strict expression cannot silently accept an extra key.
      if (own(value, "__proto__")) {
        issue(path, "The own key '__proto__' is not supported in expressions.");
        return false;
      }
      if (active.has(value)) {
        issue(path, "Cyclic expression aliases are not allowed.");
        return false;
      }
      active.add(value);
      try {
        const arrayLength = Array.isArray(value) ? value.length : 0;
        if (arrayLength > 10000 - graphNodes) {
          issue(path, "Expression exceeds the validation complexity limit.");
          return false;
        }
        let sparseSlots = arrayLength;
        const seen = new Set<string>();
        let prototypeDepth = 0;
        // Native object schemas read declared inherited/nonenumerable fields.
        // Inspect descriptors, including prototypes, instead of executing
        // getters. Programmatic expression input must contain data properties;
        // opaque values such as YAML timestamps remain supported.
        for (
          let owner: object | null = value;
          owner !== null;
          owner = Object.getPrototypeOf(owner) as object | null
        ) {
          if (++prototypeDepth > 128 || ++graphNodes > 10000) {
            issue(path, "Expression exceeds the validation complexity limit.");
            return false;
          }
          for (const key of Object.getOwnPropertyNames(owner)) {
            if (seen.has(key)) continue;
            seen.add(key);
            const descriptor = Object.getOwnPropertyDescriptor(owner, key)!;
            // Object.prototype's standard nonenumerable helpers cannot be
            // expression fields. Its extra enumerable data is still guarded.
            if (
              owner === Object.prototype &&
              !descriptor.enumerable &&
              (key === "__proto__" || typeof descriptor.value === "function")
            )
              continue;
            const index = Number(key);
            const arrayIndex =
              Array.isArray(value) &&
              Number.isInteger(index) &&
              index >= 0 &&
              index < arrayLength &&
              String(index) === key;
            const propertyPath = [...path, arrayIndex ? index : key];
            if (!own(descriptor, "value")) {
              issue(
                propertyPath,
                "Expression input must use data properties, not getters or setters.",
              );
              return false;
            }
            if (arrayIndex) sparseSlots--;
            if (
              typeof descriptor.value !== "function" &&
              !safeGraph(descriptor.value, propertyPath)
            )
              return false;
          }
        }
        graphNodes += sparseSlots;
        if (graphNodes > 10000) {
          issue(path, "Expression exceeds the validation complexity limit.");
          return false;
        }
        return true;
      } finally {
        active.delete(value);
      }
    }
    safeGraph(input, []);
  });

  function validate(input: unknown, ctx: z.RefinementCtx, condition: boolean) {
    const active = new Set<object>();
    let nodes = 0;
    const issue = (path: Path, message: string) => {
      let site: unknown = input;
      for (const key of path)
        site =
          site && typeof site === "object"
            ? (site as Record<PropertyKey, unknown>)[key]
            : undefined;
      const unresolved =
        !authoring &&
        (message.toLowerCase().startsWith("unresolved") ||
          (typeof site === "string" && PLACEHOLDER.test(site)));
      ctx.addIssue({
        code: "custom",
        path,
        message,
        ...(unresolved ? { params: { reason: "unresolved-placeholder" } } : {}),
      });
    };
    function merge(types: readonly Type[], path: Path, label?: string): Type {
      let result: Type = missingType;
      for (const type of types) {
        if (!sameKnownType(result, type))
          issue(
            path,
            `${label ? `${label}: ` : ""}Known operand types must agree, including scalar/list shape and list element type.`,
          );
        if (result.kind === "missing" || result.kind === "unknown") {
          if (type.kind !== "missing") result = type;
        } else if (result.kind === "list" && type.kind === "list") {
          result = {
            kind: "list",
            element: merge([result.element, type.element], path, label),
          };
        }
      }
      return result;
    }
    function expectType(
      type: Type,
      expected: ExpressionValueType,
      path: Path,
      label?: string,
    ) {
      if (
        type.kind === "missing" ||
        type.kind === "unknown" ||
        expected === "value"
      )
        return;
      const accepted =
        expected === "scalarOrList"
          ? type.kind === "scalar" ||
            (type.kind === "list" &&
              ["scalar", "unknown", "missing"].includes(type.element.kind))
          : expected === "stringOrList"
            ? (type.kind === "list" &&
                ["scalar", "unknown", "missing"].includes(type.element.kind)) ||
              (type.kind === "scalar" && type.type === "string")
            : expected === "scalar"
              ? type.kind === "scalar"
              : type.kind === "scalar" && type.type === expected;
      if (!accepted)
        issue(
          path,
          `${label ? `${label}: ` : ""}Expected ${expected}; known expression type is ${type.kind === "scalar" ? type.type : type.kind}.`,
        );
    }
    function deferred(value: unknown, path: Path): boolean {
      if (wholePlaceholder(value)) {
        if (!authoring)
          issue(
            path,
            "An unresolved placeholder remains; expand templates before resolved validation.",
          );
        return true;
      }
      if (record(value) && own(value, "template")) {
        if (!authoring)
          issue(
            path,
            "Unresolved template invocation; expand templates before resolved validation.",
          );
        return true;
      }
      return false;
    }
    function checkString(value: string, path: Path) {
      if (!authoring && PLACEHOLDER.test(value))
        issue(
          path,
          "An unresolved placeholder remains; expand templates before resolved validation.",
        );
    }
    function literal(value: unknown, path: Path): Type {
      if (deferred(value, path)) return unknownType;
      if (value === null) {
        return missingType;
      }
      if (typeof value === "string") {
        checkString(value, path);
        if (!authoring && PLACEHOLDER.test(value)) return unknownType;
        return stringType;
      }
      if (typeof value === "number") {
        return numberType;
      }
      if (typeof value === "boolean") return booleanType;
      if (Array.isArray(value)) {
        const types = value.map((item, index) =>
          literal(item, [...path, index]),
        );
        return { kind: "list", element: merge(types, path) };
      }
      return unknownType;
    }
    function reference(
      value: unknown,
      path: Path,
    ): { type: Type; everyone: boolean } {
      const everyone =
        typeof value === "string"
          ? value.startsWith("everyone.")
          : record(value) && value.position === "everyone";
      const legacyAll =
        typeof value === "string"
          ? value.startsWith("all.")
          : record(value) && value.position === "all";
      if (legacyAll)
        issue(
          path,
          "The all position is replaced by everyone. Wrap group comparator leaves in all, any, none, or countTrue.",
        );
      if (authoring && wholePlaceholder(value))
        return { type: unknownType, everyone: false };
      if (!authoring) {
        let unresolved = false;
        const visit = (part: unknown, partPath: Path) => {
          if (typeof part === "string" && PLACEHOLDER.test(part)) {
            checkString(part, partPath);
            unresolved = true;
          } else if (part && typeof part === "object") {
            for (const [key, child] of Object.entries(part))
              visit(child, [
                ...partPath,
                Array.isArray(part) ? Number(key) : key,
              ]);
          }
        };
        visit(value, path);
        if (unresolved)
          return {
            type: everyone
              ? { kind: "list", element: unknownType }
              : unknownType,
            everyone,
          };
      }
      let candidate: unknown = value;
      if (typeof value === "string") {
        checkString(value, path);
        if (authoring && wholePlaceholder(value.split(".")[0])) {
          // A prefix field can expand to several segments (self.prompt.name),
          // so neither its final position nor its source is knowable yet.
          return { type: unknownType, everyone: false };
        }
        if (authoring) {
          candidate = value
            .split(".")
            .map((part, index) => {
              if (index === 0 && wholePlaceholder(part)) return "self";
              if (index === 1 && wholePlaceholder(part)) return "prompt";
              return part.replace(/\$\{[a-zA-Z0-9_]+\}/g, "field");
            })
            .join(".");
        }
      } else if (record(value)) {
        candidate = { ...value };
        for (const [key, field] of Object.entries(value)) {
          if (typeof field === "string") {
            checkString(field, [...path, key]);
            if (authoring && PLACEHOLDER.test(field))
              (candidate as Record<string, unknown>)[key] =
                key === "position" && wholePlaceholder(field)
                  ? "self"
                  : key === "source" && wholePlaceholder(field)
                    ? own(value, "name")
                      ? "prompt"
                      : "attributes"
                    : field.replace(/\$\{[a-zA-Z0-9_]+\}/g, "field");
          } else if (key === "path" && Array.isArray(field)) {
            (candidate as Record<string, unknown>)[key] = (
              field as unknown[]
            ).map((part, index) => {
              if (typeof part === "string") {
                checkString(part, [...path, key, index]);
                return authoring
                  ? part.replace(/\$\{[a-zA-Z0-9_]+\}/g, "field")
                  : part;
              }
              return part;
            });
          }
        }
      }
      const parsed = referenceSchema.safeParse(candidate);
      if (!parsed.success)
        for (const error of parsed.error.issues)
          issue([...path, ...error.path], error.message);
      const type = parsed.success
        ? fromStatic(options.referenceType?.(value as ExpressionReference))
        : unknownType;
      return {
        type:
          everyone && type.kind === "unknown"
            ? { kind: "list", element: unknownType }
            : type,
        everyone,
      };
    }
    function regex(pattern: string, flags: string, path: Path) {
      if (PLACEHOLDER.test(pattern) || PLACEHOLDER.test(flags)) return;
      const error = (options.validateRegex ?? validateRegex)(pattern, flags);
      if (error) issue(path, error);
    }
    function comparator(
      node: Record<string, unknown>,
      path: Path,
      groupAllowed: boolean,
    ): Type {
      const resolved = reference(node.reference, [...path, "reference"]);
      const name = node.comparator;
      if (typeof name !== "string") return unknownType;
      if (resolved.everyone && !groupAllowed)
        issue(
          path,
          "Wrap an everyone comparator leaf directly in all, any, none, or countTrue; do not put it in an operand list.",
        );
      const valueType =
        resolved.everyone && resolved.type.kind === "list"
          ? resolved.type.element
          : resolved.type;
      if (name !== "exists" && name !== "doesNotExist") {
        const comparison = literal(node.value, [...path, "value"]);
        if (numericComparators.has(name)) {
          expectType(comparison, "number", [...path, "value"], name);
          expectType(valueType, "number", [...path, "reference"], name);
        } else if (name.startsWith("hasLength")) {
          expectType(valueType, "stringOrList", [...path, "reference"], name);
          expectType(comparison, "number", [...path, "value"], name);
        } else if (name === "matches" || name === "doesNotMatch") {
          expectType(valueType, "string", [...path, "reference"], name);
          expectType(comparison, "string", [...path, "value"], name);
          if (typeof node.value === "string") {
            const parsed = parseRegexLiteral(node.value);
            if (!parsed)
              issue(
                [...path, "value"],
                "Regex /pattern/flags requires a closing slash.",
              );
            else regex(parsed.pattern, parsed.flags, [...path, "value"]);
          }
        } else if (name === "isOneOf" || name === "isNotOneOf") {
          expectType(valueType, "scalar", [...path, "reference"], name);
          if (comparison.kind === "list")
            merge([valueType, comparison.element], path, name);
        } else if (name === "includes" || name === "doesNotInclude") {
          expectType(valueType, "stringOrList", [...path, "reference"], name);
          merge(
            [
              valueType.kind === "list" ? valueType.element : valueType,
              comparison,
            ],
            path,
            name,
          );
        } else merge([valueType, comparison], path, name);
      }
      return resolved.everyone
        ? { kind: "list", element: booleanType, groupLeaf: true }
        : booleanType;
    }
    function collection(
      value: unknown,
      path: Path,
      expected: ExpressionValueType,
      operator: string,
    ): Type[] {
      if (deferred(value, path)) return [unknownType];
      const minimum = pairOperators.has(operator) ? 2 : 1;
      if (Array.isArray(value)) {
        return value.map((operand, index) => {
          const type = expression(operand, [...path, index]);
          expectType(type, expected, [...path, index]);
          return type;
        });
      }
      const type = expression(value, path, groupConsumers.has(operator));
      const operand = type.kind === "list" ? type.element : type;
      expectType(operand, expected, path);
      if (minimum > 1 && (type.kind === "scalar" || type.kind === "missing"))
        issue(
          path,
          `Expected at least ${minimum} operands, or a runtime list expression.`,
        );
      return [operand];
    }
    function layout(
      value: unknown,
      path: Path,
      definition: ExpressionOperandLayout,
      operator: string,
    ): Record<string, Type[]> {
      if (definition.kind === "expression") {
        const type = expression(value, path);
        expectType(type, definition.valueType, path);
        return { [definition.role]: [type] };
      }
      if (
        definition.kind === "expressionList" ||
        definition.kind === "expressionOrList"
      )
        return {
          [definition.role]: collection(
            value,
            path,
            definition.valueType,
            operator,
          ),
        };
      return {};
    }
    function operator(name: string, value: unknown, path: Path): Type {
      const definition = EXPRESSION_OPERATORS[
        name as keyof typeof EXPRESSION_OPERATORS
      ] as ExpressionOperatorDefinition;
      if (deferred(value, path))
        return definition.resultType === "boolean"
          ? booleanType
          : definition.resultType === "number"
            ? numberType
            : unknownType;
      let inputTypes: Type[] = [];
      if (name === "case") {
        if (!record(value)) return unknownType;
        if (
          deferred(value.rules, [...path, "rules"]) ||
          !Array.isArray(value.rules)
        )
          return unknownType;
        const rules = value.rules as unknown[];
        rules.forEach((rule, index) => {
          const rulePath = [...path, "rules", index];
          if (deferred(rule, rulePath)) {
            inputTypes.push(unknownType);
            return;
          }
          if (!record(rule)) return;

          const hasWhen = own(rule, "when"),
            hasDefault = own(rule, "default");
          if (hasWhen)
            expectType(
              expression(rule.when, [...rulePath, "when"]),
              "boolean",
              [...rulePath, "when"],
            );
          if (hasDefault) {
            if (typeof rule.default === "string")
              checkString(rule.default, [...rulePath, "default"]);
            if (index !== rules.length - 1)
              issue(rulePath, "The single default rule must be last.");
          }
          inputTypes.push(expression(rule.value, [...rulePath, "value"]));
        });
        return merge(inputTypes, path);
      }
      if (definition.operands.kind === "withOptions") {
        const optionsForm =
          record(value) && (own(value, "inputs") || own(value, "atLeast"));
        if (optionsForm) {
          inputTypes = Object.values(
            layout(
              value.inputs,
              [...path, "inputs"],
              definition.operands.input,
              name,
            ),
          ).flat();
          if (
            own(value, "atLeast") &&
            !(authoring && wholePlaceholder(value.atLeast))
          ) {
            if (typeof value.atLeast === "string")
              checkString(value.atLeast, [...path, "atLeast"]);
            else if (
              Array.isArray(value.inputs) &&
              typeof value.atLeast === "number" &&
              value.atLeast > value.inputs.length
            )
              issue(
                [...path, "atLeast"],
                "atLeast cannot exceed the authored input count.",
              );
          }
        } else
          inputTypes = Object.values(
            layout(value, path, definition.operands.input, name),
          ).flat();
      } else if (definition.operands.kind === "fields") {
        if (!record(value)) return unknownType;

        const roles: Record<string, Type[]> = {};
        for (const [key, field] of Object.entries(definition.operands.fields))
          Object.assign(roles, layout(value[key], [...path, key], field, name));
        inputTypes = Object.values(roles).flat();
        if (name === "includes") {
          const container = roles.container?.[0] ?? unknownType;
          merge(
            [
              container.kind === "list" ? container.element : container,
              ...(roles.members ?? []),
            ],
            path,
          );
        }
        if (
          name === "divide" &&
          (value.denominator === 0 ||
            (record(value.denominator) && value.denominator.literal === 0))
        )
          issue(
            [...path, "denominator"],
            "A literal zero denominator is not allowed.",
          );
        if (name === "matches") {
          const patterns =
            deferred(value.patterns, [...path, "patterns"]) ||
            !Array.isArray(value.patterns)
              ? undefined
              : (value.patterns as unknown[]);
          const flags = own(value, "flags") ? value.flags : "";
          if (typeof flags === "string") checkString(flags, [...path, "flags"]);
          patterns?.forEach((pattern, index) => {
            if (typeof pattern === "string") {
              checkString(pattern, [...path, "patterns", index]);
              regex(pattern, typeof flags === "string" ? flags : "", [
                ...path,
                "patterns",
                index,
              ]);
            }
          });
        }
      } else
        inputTypes = Object.values(
          layout(value, path, definition.operands, name),
        ).flat();
      if (
        ["allEqual", "allUnique", "countUnique", "firstExisting"].includes(name)
      )
        merge(inputTypes, path);
      return definition.resultType === "boolean"
        ? booleanType
        : definition.resultType === "number"
          ? numberType
          : merge(inputTypes, path);
    }
    function expression(
      value: unknown,
      path: Path,
      groupAllowed = false,
    ): Type {
      if (++nodes > 10000 || path.length > 256) {
        issue(path, "Expression exceeds the validation complexity limit.");
        return unknownType;
      }
      if (deferred(value, path)) return unknownType;
      if (!record(value)) return literal(value, path);
      if (active.has(value)) {
        issue(path, "Cyclic expression aliases are not allowed.");
        return unknownType;
      }
      active.add(value);
      try {
        if (own(value, "reference")) {
          if (own(value, "comparator"))
            return comparator(value, path, groupAllowed);

          const type = reference(value.reference, [...path, "reference"]).type;
          if (type.kind === "list" && type.element.kind === "list")
            issue(
              path,
              "Nested list expression values are not supported; compare each seat's answer with an everyone comparator leaf.",
            );
          return type;
        }
        if (own(value, "literal")) {
          return literal(value.literal, [...path, "literal"]);
        }
        const keys = Object.keys(value);
        return operator(keys[0], value[keys[0]], [...path, keys[0]]);
      } finally {
        active.delete(value);
      }
    }
    if (condition) {
      if (input === null)
        issue(
          [],
          "A conditions root cannot be null; omit the field for no gate.",
        );
      if (Array.isArray(input)) {
        input.forEach((item, index) =>
          expectType(expression(item, [index]), "boolean", [index]),
        );
      } else expectType(expression(input, []), "boolean", []);
    } else expression(input, []);
  }

  return {
    expressionSchema: resourceSchema
      .pipe(structure.expression)
      .superRefine((value, ctx) => validate(value, ctx, false)),
    conditionsSchema: resourceSchema
      .pipe(structure.conditions)
      .superRefine((value, ctx) => validate(value, ctx, true)),
  };
}

const authoring = createExpressionSchemas({ mode: "authoring" });
const resolved = createExpressionSchemas({ mode: "resolved" });
export const expressionSchema = authoring.expressionSchema;
export const expressionConditionsSchema = authoring.conditionsSchema;
export const resolvedExpressionSchema = resolved.expressionSchema;
export const resolvedExpressionConditionsSchema = resolved.conditionsSchema;
