import type {
  RegisteredLocale,
  StagebookMessages,
  DeepPartial,
} from "./types.js";
import { en } from "./en.js";
import { he } from "./he.js";

export type {
  RegisteredLocale,
  StagebookMessages,
  DeepPartial,
} from "./types.js";

/**
 * Canonical catalogs, keyed by the closed `RegisteredLocale` union. The
 * `Record<RegisteredLocale, …>` type makes a locale that's missing a key a
 * compile error — that's the build-time completeness guarantee.
 */
export const defaultMessages: Record<RegisteredLocale, StagebookMessages> = {
  en,
  he,
};

/** Locales stagebook ships a catalog for — **derived** from `defaultMessages`,
 *  not a hand-maintained list. `defaultMessages` is already forced complete by
 *  its `Record<RegisteredLocale, …>` type, so deriving the registered set from
 *  it means a locale can never be in the catalog but missing from the resolver's
 *  known set (which would make `resolveCatalog` silently fall back to `en`).
 *  `Object.keys` on an object literal is safe — own enumerable string keys
 *  only — and its values are exactly the `RegisteredLocale` union members. */
export const REGISTERED_LOCALES: readonly RegisteredLocale[] = Object.keys(
  defaultMessages,
) as RegisteredLocale[];

/** Subset of registered locales that render right-to-left. */
export const RTL_LOCALES: ReadonlySet<RegisteredLocale> =
  new Set<RegisteredLocale>(["he"]);

/** BCP-47 primary subtag, lowercased (`"he-IL"` → `"he"`). Empty/undefined
 *  input yields `""`, which is not a registered locale → `en` fallback. */
function primarySubtag(locale: string | undefined): string {
  return (locale ?? "").toLowerCase().split("-")[0] ?? "";
}

function isRegistered(tag: string): tag is RegisteredLocale {
  return (REGISTERED_LOCALES as readonly string[]).includes(tag);
}

/** True when the (normalized) locale renders right-to-left. Unknown locales are
 *  treated as LTR. */
export function isRTLLocale(locale: string | undefined): boolean {
  const tag = primarySubtag(locale);
  return isRegistered(tag) && RTL_LOCALES.has(tag);
}

/**
 * Resolve the active catalog for a locale, applying optional host overrides.
 *
 * - The locale is normalized to its primary subtag and matched against the
 *   registered set. An unknown locale falls back to `en` with a `console.warn`.
 * - Host overrides (a `DeepPartial`) are applied per key on top of the base
 *   catalog. Overrides are **trusted host input**, but a malformed one (wrong
 *   shape — e.g. a string where a function is expected, from an untyped JS
 *   consumer) is skipped with a warning rather than crashing render: the bundled
 *   entry wins. This is a robustness guard, not a security boundary.
 */
export function resolveCatalog(
  locale: string | undefined,
  overrides?: DeepPartial<StagebookMessages>,
): StagebookMessages {
  const tag = primarySubtag(locale);
  let base: StagebookMessages;
  if (isRegistered(tag)) {
    base = defaultMessages[tag];
  } else {
    if (locale !== undefined && locale !== "") {
      console.warn(
        `[stagebook] Unknown locale "${locale}" — no catalog registered; ` +
          `falling back to "en". Registered locales: ${REGISTERED_LOCALES.join(", ")}.`,
      );
    }
    base = defaultMessages.en;
  }

  if (!overrides) return base;

  const merged: StagebookMessages = { ...base };
  for (const key of Object.keys(overrides) as (keyof StagebookMessages)[]) {
    // Defense-in-depth: never let an override key reach a prototype. Today the
    // flat string/function catalog + the `typeof` guard below make this
    // unreachable, but an explicit skip keeps it safe if a future catalog key
    // is ever object-valued (which would make the `typeof` guard permissive).
    const keyName = key as string;
    if (
      keyName === "__proto__" ||
      keyName === "constructor" ||
      keyName === "prototype"
    ) {
      continue;
    }
    const overrideValue = overrides[key];
    if (overrideValue === undefined) continue;
    // Malformed-override guard: the override must match the bundled entry's
    // runtime type (string vs function). Otherwise keep the bundled entry.
    if (typeof overrideValue !== typeof base[key]) {
      console.warn(
        `[stagebook] Ignoring messages override for "${String(key)}": expected ` +
          `${typeof base[key]}, got ${typeof overrideValue}.`,
      );
      continue;
    }
    // Types line up at runtime; the DeepPartial mapped type already constrains
    // the static shape for typed consumers. Cast via `unknown` since
    // StagebookMessages has no index signature.
    (merged as unknown as Record<string, unknown>)[key as string] =
      overrideValue;
  }
  return merged;
}
