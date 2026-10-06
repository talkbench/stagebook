import type { ExpressionPath } from "../expressions/walkExpression.js";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

interface PreparedSource {
  /** A shallow effective object; unrelated data is never materialized. */
  view: (value: unknown) => unknown;
  /** Materialize one condition, using the expression traversal's own bounds. */
  expression: (value: unknown) => unknown;
  /** Translate an effective field path back to an authored anchor/merge site. */
  sourcePath: (path: ExpressionPath) => ExpressionPath;
}

/** The source mapper preserves `<<` keys; runtime js-yaml resolves them. Read
 * their effective fields lazily as the detector follows schema roles, keeping
 * each field's original source path. Opaque literals and invocation fields do
 * not become condition sites. No authored object is mutated.
 *
 * A large file can contain many individually valid conditions, so it has no
 * aggregate node limit. Source indexing is iterative and visits each object
 * identity once. Merge graphs and individual conditions have finite budgets;
 * aliases cannot expand them without bound or hide other condition sites. */
export function prepareGrammarUpgradeSource(file: unknown): PreparedSource {
  const firstPaths = new WeakMap<object, ExpressionPath>();
  function* entries(node: object): Generator<[string | number, unknown]> {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) yield [i, node[i] as unknown];
    } else {
      for (const key of Object.keys(node))
        yield [key, (node as Record<string, unknown>)[key]];
    }
  }
  const frames: Array<{
    value: unknown;
    path: ExpressionPath;
    children?: Generator<[string | number, unknown]>;
  }> = [{ value: file, path: [] }];
  while (frames.length) {
    const frame = frames[frames.length - 1];
    const node = frame.value;
    if (!frame.children) {
      if (
        node === null ||
        typeof node !== "object" ||
        firstPaths.has(node) ||
        frame.path.length > 256
      ) {
        frames.pop();
        continue;
      }
      // Parsed aliases share object identity. The first occurrence is the
      // anchor definition, or the alias node if that definition was discarded
      // by a duplicate YAML key. Very deep opaque branches need no indexing.
      firstPaths.set(node, frame.path);
      frame.children = entries(node);
    }
    const next = frame.children.next();
    if (next.done) frames.pop();
    else
      frames.push({
        value: next.value[1],
        path: [...frame.path, next.value[0]],
      });
  }

  const views = new WeakMap<object, Record<string, unknown> | undefined>();
  const isView = new WeakSet<object>();
  const origins = new WeakMap<object, ExpressionPath>();
  const fieldOrigins = new WeakMap<object, Map<string, ExpressionPath>>();
  function view(value: unknown): unknown {
    if (!record(value) || isView.has(value)) return value;
    let remaining = 10000;
    const active = new Set<object>();
    function resolve(
      raw: Record<string, unknown>,
      depth: number,
    ): Record<string, unknown> | undefined {
      if (views.has(raw)) return views.get(raw);
      if (--remaining < 0 || depth > 128 || active.has(raw)) return;
      active.add(raw);
      try {
        const path = firstPaths.get(raw) ?? [];
        const result = Object.create(null) as Record<string, unknown>;
        const fields = new Map<string, ExpressionPath>();
        const merge = Object.hasOwn(raw, "<<") ? raw["<<"] : undefined;
        const sources: unknown[] = Array.isArray(merge) ? merge : [merge];
        const explicit = Object.keys(raw).filter((key) => key !== "<<");
        let sourceOrigin: ExpressionPath | undefined;
        let sourceCount = 0;
        // YAML merge sequences give earlier maps precedence. Explicit fields
        // override every merged source regardless of authored key order.
        for (const source of sources) {
          if (--remaining < 0) return;
          if (!record(source)) continue;
          const resolved = resolve(source, depth + 1);
          if (!resolved) return;
          sourceCount++;
          sourceOrigin = origins.get(resolved);
          for (const key of Object.keys(resolved)) {
            if (--remaining < 0) return;
            if (Object.hasOwn(result, key)) continue;
            result[key] = resolved[key];
            fields.set(key, fieldOrigins.get(resolved)!.get(key)!);
          }
        }
        for (const key of explicit) {
          if (--remaining < 0) return;
          result[key] = raw[key];
          fields.set(key, [...path, key]);
        }
        origins.set(
          result,
          explicit.length === 0 && sourceCount === 1 ? sourceOrigin! : path,
        );
        fieldOrigins.set(result, fields);
        isView.add(result);
        views.set(raw, result);
        return result;
      } finally {
        active.delete(raw);
      }
    }
    const resolved = resolve(value, 0);
    views.set(value, resolved);
    return resolved;
  }

  function expression(value: unknown): unknown {
    let remaining = 10000;
    let failed = false;
    const active = new Set<object>();
    function copy(raw: unknown, depth: number): unknown {
      if (--remaining < 0 || depth > 128) {
        failed = true;
        return;
      }
      if (raw === null || typeof raw !== "object") return raw;
      if (active.has(raw)) {
        failed = true;
        return;
      }
      active.add(raw);
      try {
        if (Array.isArray(raw)) {
          const result: unknown[] = [];
          for (const item of raw) {
            result.push(copy(item, depth + 1));
            if (failed) return;
          }
          return result;
        }
        const resolved = view(raw);
        if (!record(resolved)) {
          failed = true;
          return;
        }
        const result = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(resolved)) {
          result[key] = copy(resolved[key], depth + 1);
          if (failed) return;
        }
        return result;
      } finally {
        active.delete(raw);
      }
    }
    const result = copy(value, 0);
    return failed ? undefined : result;
  }

  // A parsed object cannot distinguish an inline merge map from an alias whose
  // definition became unreachable. If no earlier anchor path exists, use the
  // merge node's real range rather than inventing a child path below an alias.
  function authored(path: ExpressionPath): ExpressionPath {
    const merge = path.indexOf("<<");
    if (merge < 0) return path;
    return path.slice(0, merge + (typeof path[merge + 1] === "number" ? 2 : 1));
  }
  return {
    view,
    expression,
    sourcePath(path) {
      let node: unknown = file;
      let source: ExpressionPath = [];
      for (const segment of path) {
        node = view(node);
        if (Array.isArray(node) && typeof segment === "number") {
          source = [...(firstPaths.get(node) ?? source), segment];
          node = node[segment] as unknown;
        } else if (record(node) && typeof segment === "string") {
          source = fieldOrigins.get(node)?.get(segment) ?? [...source, segment];
          node = node[segment];
        } else return authored(source);
      }
      node = view(node);
      return authored(
        node !== null && typeof node === "object"
          ? (origins.get(node) ?? firstPaths.get(node) ?? source)
          : source,
      );
    },
  };
}
