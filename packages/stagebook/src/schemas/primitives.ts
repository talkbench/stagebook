/**
 * Tiny schema primitives shared between `reference.ts` and `treatment.ts`.
 * Lives in its own file so `reference.ts` (imported by the cross-stage
 * walker) can pull these schemas without dragging in `treatment.ts`'s
 * import-cycle with the walker.
 */

import { z } from "zod";

// Allowed identifier characters: a-z, A-Z, 0-9, -, _, and space.
// Plus optional `${field}` template placeholders.
const NAME_REGEX = /^(?:[a-zA-Z0-9 _-]|\$\{[a-zA-Z0-9_]+\})+$/;
const NAME_REGEX_MESSAGE =
  "Name must be alphanumeric, cannot have special characters, with optional template fields in the format ${fieldname}";

/**
 * Authoring constraint: applied where a human writes an identifier
 * (treatment YAML `element.name`, prompt-file frontmatter `name:`).
 * 64-char cap keeps hand-authored names short and readable.
 */
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(64)
  .regex(NAME_REGEX, { message: NAME_REGEX_MESSAGE });
export type NameType = z.infer<typeof nameSchema>;

/**
 * Lookup constraint: applied where the runtime parses a reference
 * string and matches it against storage keys. Auto-derived names join
 * separately-validated components (e.g. `<progressLabel>_<file slug>`)
 * so the joined identifier can exceed the 64-char authoring cap even
 * when every component is well-formed. 256 is a hard sanity ceiling
 * that catches genuine bugs (unbounded key construction) without
 * rejecting reasonable auto-derived names. The character regex is
 * identical — no looser at the lookup boundary.
 */
export const referenceNameSchema = z
  .string()
  .min(1, "Name is required")
  .max(256)
  .regex(NAME_REGEX, { message: NAME_REGEX_MESSAGE });

// BCP-47-ish language tag: a 2-3 letter primary subtag plus optional
// `-`-separated subtags (`en`, `he`, `he-IL`, `zh-Hant`). This validates the
// tag's SHAPE, not membership in stagebook's shipped-catalog set — a study may
// declare a locale a host supplies via `messages` overrides, and the runtime
// resolves any unshipped locale to `en` (with a warning). The syntactic check
// still catches gross typos like `hebrew`.
const LOCALE_REGEX = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$/;
export const localeSchema = z
  .string()
  .max(35) // longest legal BCP-47 tags are ~35 chars; consistent with other primitives' caps
  .regex(LOCALE_REGEX, {
    message:
      "`locale` must be a BCP-47 language tag — a 2-3 letter primary subtag with optional `-`-separated subtags (e.g. `en`, `he`, `he-IL`).",
  });
