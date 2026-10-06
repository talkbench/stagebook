import {
  BOOLEAN_OPERATOR_KEYS,
  EXPRESSION_OPERATOR_KEYS,
  EXPRESSION_OPERATORS,
  type ExpressionOperandLayout,
  type ExpressionOperatorKey,
} from "./operators.js";

export type ExpressionPath = (string | number)[];

export interface ExpressionAncestor {
  operator: ExpressionOperatorKey;
  /** Path to the enclosing operator object, before its operator key. */
  path: ExpressionPath;
  /** Operand role from the operator table, e.g. inputs, when, numerator. */
  role: string;
}

export interface ExpressionVisit {
  node: unknown;
  path: ExpressionPath;
  ancestors: ExpressionAncestor[];
  kind: "operator" | "leaf" | "reference" | "literal" | "unknown";
  operator?: ExpressionOperatorKey;
}

export interface WalkExpressionOptions {
  path?: ExpressionPath;
  /** The conditions field supports an outer array as implicit all. A plain
   * expression does not: list data belongs inside a literal wrapper. */
  allowImplicitArray?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

interface OperandSite {
  node: unknown;
  path: ExpressionPath;
  role: string;
}

/** Interpret operand structure rather than recursively visiting every object
 * property. Literal-only options and arbitrary payloads remain opaque. */
function* operandSites(
  value: unknown,
  path: ExpressionPath,
  layout: ExpressionOperandLayout,
  active: Set<object>,
): Generator<OperandSite> {
  // Operand containers are syntax too. Track them while yielding children so
  // a cyclic array/options object cannot re-enter the same active branch.
  const container =
    ((layout.kind === "expressionList" ||
      layout.kind === "expressionOrList" ||
      layout.kind === "items") &&
      Array.isArray(value)) ||
    (layout.kind === "fields" && isRecord(value)) ||
    (layout.kind === "withOptions" &&
      isRecord(value) &&
      own(value, layout.inputField))
      ? (value as object)
      : undefined;
  if (container && active.has(container)) return;
  if (container) active.add(container);
  try {
    switch (layout.kind) {
      case "expression":
        yield { node: value, path, role: layout.role };
        return;
      case "expressionList":
      case "expressionOrList":
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            yield { node: value[i], path: [...path, i], role: layout.role };
          }
        } else if (layout.kind === "expressionOrList") {
          yield { node: value, path, role: layout.role };
        }
        return;
      case "fields":
        if (!isRecord(value)) return;
        for (const [field, fieldLayout] of Object.entries(layout.fields)) {
          if (own(value, field)) {
            yield* operandSites(
              value[field],
              [...path, field],
              fieldLayout,
              active,
            );
          }
        }
        return;
      case "items":
        if (!Array.isArray(value)) return;
        for (let i = 0; i < value.length; i++) {
          yield* operandSites(value[i], [...path, i], layout.item, active);
        }
        return;
      case "withOptions":
        if (isRecord(value) && own(value, layout.inputField)) {
          yield* operandSites(
            value[layout.inputField],
            [...path, layout.inputField],
            layout.input,
            active,
          );
        } else {
          yield* operandSites(value, path, layout.input, active);
        }
    }
  } finally {
    if (container) active.delete(container);
  }
}

function* walkNodes(
  node: unknown,
  path: ExpressionPath,
  ancestors: ExpressionAncestor[],
  active: Set<object>,
  legacy: boolean,
  allowImplicitArray: boolean,
): Generator<ExpressionVisit> {
  // Track the active branch, rather than all visited objects: YAML aliases and
  // shared subtrees still need one visit per distinct authored source path.
  const object = node !== null && typeof node === "object" ? node : undefined;
  if (object && active.has(object)) return;
  if (object) active.add(object);
  try {
    if (Array.isArray(node)) {
      if (allowImplicitArray) {
        for (let i = 0; i < node.length; i++) {
          yield* walkNodes(
            node[i],
            [...path, i],
            ancestors,
            active,
            legacy,
            legacy,
          );
        }
      }
      return;
    }

    if (!isRecord(node)) {
      if (
        !legacy &&
        (node === null || ["string", "number", "boolean"].includes(typeof node))
      ) {
        yield { node, path, ancestors, kind: "literal" };
      }
      return;
    }

    // Existing validators check array-valued operators before template/leaf
    // forms. Keep that precedence even on malformed multi-form objects.
    const operator = legacy
      ? BOOLEAN_OPERATOR_KEYS.find(
          (key) => own(node, key) && Array.isArray(node[key]),
        )
      : undefined;

    if (!operator) {
      if (own(node, "template")) return;
      if (!legacy && own(node, "literal")) {
        yield { node, path, ancestors, kind: "literal" };
        return;
      }
      if (!legacy && own(node, "reference")) {
        yield {
          node,
          path,
          ancestors,
          kind: own(node, "comparator") ? "leaf" : "reference",
        };
        return;
      }
    }

    const selected =
      operator ??
      (!legacy
        ? EXPRESSION_OPERATOR_KEYS.find((key) => own(node, key))
        : undefined);
    if (selected) {
      yield { node, path, ancestors, kind: "operator", operator: selected };
      for (const operand of operandSites(
        node[selected],
        [...path, selected],
        EXPRESSION_OPERATORS[selected].operands,
        active,
      )) {
        yield* walkNodes(
          operand.node,
          operand.path,
          [...ancestors, { operator: selected, path, role: operand.role }],
          active,
          legacy,
          legacy,
        );
      }
      return;
    }

    yield { node, path, ancestors, kind: legacy ? "leaf" : "unknown" };
  } finally {
    if (object) active.delete(object);
  }
}

/** Pre-order, best-effort structural traversal of the settled expression
 * vocabulary. This does not validate, evaluate, expand templates, or enable
 * syntax in treatment schemas. Every branch is visited, even case defaults. */
export function* walkExpression(
  expression: unknown,
  options: WalkExpressionOptions = {},
): Generator<ExpressionVisit> {
  yield* walkNodes(
    expression,
    options.path ?? [],
    [],
    new Set(),
    false,
    options.allowImplicitArray ?? false,
  );
}

export interface ConditionLeafSite {
  leaf: Record<string, unknown>;
  path: ExpressionPath;
  ancestors: ExpressionAncestor[];
}

/** Compatibility traversal for today's conditions grammar. Only array-valued
 * all/any/none operators recurse; other objects remain leaf candidates for
 * callers' existing guards. Templates and malformed primitive nodes are skipped. */
export function* walkConditionLeaves(
  conditions: unknown,
  pathPrefix: ExpressionPath = [],
): Generator<ConditionLeafSite> {
  for (const visit of walkNodes(
    conditions,
    pathPrefix,
    [],
    new Set(),
    true,
    true,
  )) {
    if (visit.kind === "leaf" && isRecord(visit.node)) {
      yield { leaf: visit.node, path: visit.path, ancestors: visit.ancestors };
    }
  }
}

/** Legacy dead-leaf checks are sound only when every enclosing operator is
 * all. Use recorded ancestors so unrelated source-path names cannot interfere. */
export function hasNonAllAncestor(
  ancestors: readonly ExpressionAncestor[],
): boolean {
  return ancestors.some(({ operator }) => operator !== "all");
}
