import {
  parseDottedReference,
  type ReferenceType,
} from "../schemas/reference.js";

// Path segments that traverse into Object.prototype are rejected to prevent
// accidental exposure of inherited properties (e.g. `constructor`) via
// arbitrary reference strings. Read-only today, but the viewer's
// StateInspector combines path traversal with writes — defence in depth.
const DISALLOWED_PATH_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

export function getNestedValueByPath(
  obj: unknown,
  path: string[] = [],
): unknown {
  return path.reduce((acc: unknown, key: string) => {
    if (acc === null || acc === undefined) return undefined;
    if (DISALLOWED_PATH_SEGMENTS.has(key)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(acc, key)) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export interface ReferenceKeyAndPath {
  referenceKey: string;
  path: string[];
}

// Per-named-source default `path` applied when the reference omits one.
// Today only `prompt` has a non-empty default (`["value"]`) — other named
// sources read the whole stored record. The implicit prompt default is kept
// for backward compatibility (#240); new code should write the path
// explicitly.
const NAMED_SOURCE_DEFAULTS: Record<string, string[]> = {
  prompt: ["value"],
};

/**
 * Resolve a reference (string-shorthand or structured) into its storage key
 * and path-into-the-record. Storage-key conventions (#240):
 *
 *   - **Named sources** — `<source>_<name>`. After #240 this includes
 *     `discussion_<name>` (was a bare `<name>` before — hosts that read
 *     or write the discussion bucket need to rename their key).
 *   - **External sources** — `<source>` (singleton).
 *
 * `path` is the user-supplied path, or the per-named-source default when
 * omitted (only `prompt` has one today: `["value"]`).
 */
export function getReferenceKeyAndPath(
  reference: string | ReferenceType,
): ReferenceKeyAndPath {
  let ref: ReferenceType;
  if (typeof reference === "string") {
    const parsed = parseDottedReference(reference);
    if (!parsed.ok) throw new Error(parsed.message);
    ref = parsed.value;
  } else {
    ref = reference;
  }
  if ("name" in ref) {
    // The default only applies when `path` is *omitted*. Writing `path: []`
    // explicitly opts out of the default and addresses the whole stored
    // record — the rule-of-least-surprise reading for "I gave you an
    // explicit path." Defensive copy so callers can't mutate either the
    // shared `NAMED_SOURCE_DEFAULTS` array or the caller's input ref.
    return {
      referenceKey: `${ref.source}_${ref.name}`,
      path: [...(ref.path ?? NAMED_SOURCE_DEFAULTS[ref.source] ?? [])],
    };
  }
  return { referenceKey: ref.source, path: [...ref.path] };
}
