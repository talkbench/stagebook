/**
 * Sanitize and length-cap a synthesized identifier so it always satisfies
 * the reference-name regex (`[a-zA-Z0-9 _-]`) and the 256-char lookup
 * cap (`referenceNameSchema`).
 *
 * Used at the auto-derivation sites in `Element.tsx` where a prompt or
 * audio element has no explicit `name:` — the runtime falls back to a
 * synthesized identifier built from the progress label and either
 * `metadata.name` (prompt frontmatter) or `element.file` (raw path).
 * Raw file paths contain `/` and `.`, both of which the regex rejects;
 * long folder-nested paths can exceed 64 chars and (rarely) 256.
 *
 * Background: #331, #359, #360.
 */

const REFERENCE_NAME_MAX = 256;
const PROMPT_FILE_EXT = /\.prompt\.md$/;
const SLUG_REPLACE = /[./]/g;
const NON_NAME_CHAR = /[^a-zA-Z0-9 _-]/g;

/**
 * Slug a raw string into the reference-name character set without any
 * length handling. Strips a trailing `.prompt.md` (the most common
 * extension at synthesis sites), then replaces `.` and `/` with `_`,
 * then replaces any other disallowed char with `_`.
 *
 * Two file paths that differ only in a `.` vs `/` separator collapse to
 * the same slug — that's fine for the auto-derivation use case because
 * the caller pairs the slug with the stage's `progressLabel`, which
 * disambiguates by stage.
 */
export function sanitizeName(raw: string): string {
  return raw
    .replace(PROMPT_FILE_EXT, "")
    .replace(SLUG_REPLACE, "_")
    .replace(NON_NAME_CHAR, "_");
}

/**
 * Sanitize a raw string and ensure the result fits within the 256-char
 * reference-name cap. When the sanitized form is short enough, it's
 * returned as-is — readable, traces back to the source.
 *
 * When it exceeds the cap, truncate the readable portion and append an
 * underscore plus an 8-char stable hash of the full sanitized string.
 * The hash is FNV-1a (non-crypto, fast, deterministic across browser
 * and node, no deps) — sufficient for "two long paths that differ
 * anywhere produce different keys" without crypto-grade guarantees.
 * Two paths sharing a 200-char prefix and differing only in their last
 * segment still produce distinct outputs.
 *
 * The truncation budget is `256 - 1 (underscore) - 8 (hash) = 247`.
 */
export function deriveStorageKeyName(raw: string): string {
  const sanitized = sanitizeName(raw);
  if (sanitized.length <= REFERENCE_NAME_MAX) return sanitized;
  const hash = fnv1aHash8(sanitized);
  return sanitized.slice(0, REFERENCE_NAME_MAX - 1 - 8) + "_" + hash;
}

/**
 * FNV-1a 32-bit hash, returned as an 8-char zero-padded lowercase hex
 * string. Used as a collision-resistant suffix when truncating long
 * synthesized names. Not cryptographic; the goal is "two distinct
 * inputs almost always produce distinct outputs" for the runtime
 * identifier-collision-avoidance use case.
 *
 * Implementation: standard 32-bit FNV-1a. `Math.imul` keeps the
 * 32-bit multiplication in V8's int32 fast path; `>>> 0` after each
 * step coerces back to unsigned 32-bit.
 */
function fnv1aHash8(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0; // FNV prime, mod 2^32
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
