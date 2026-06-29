# Adding a language (locale)

How to register a new locale for stagebook's **chrome** — the participant-facing
strings stagebook owns (submit button, slider/timer labels, character counter,
error fallbacks, the help popover, …). It's deliberately mechanical: the closed
`RegisteredLocale` union makes the TypeScript compiler list every string you
still owe, and adding a locale is **not a breaking change** for consumers.

For the _why_, see the ADR
[2026-06-localization.md](../decisions/2026-06-localization.md); for reviewing a
translated **study** (researcher prompt content, not chrome), see the
[localization review checklist](../localization-review-checklist.md).

> **Chrome vs. content.** This doc covers stagebook's own strings only.
> Researcher-authored prompt content is per-study: the author ships
> `prompts/<locale>/…` files and declares `locale:` on the treatment / intro
> sequence. The [`examples/i18n-gallery`](../../examples/i18n-gallery) treatment
> shows that pattern end to end — you don't touch stagebook to add a language to
> a study, only to translate stagebook's chrome.

## TL;DR

Three edits (four for an RTL language), all under
[`packages/stagebook/src/messages/`](../../packages/stagebook/src/messages),
using French (`fr`) as the example:

1. Add `"fr"` to the `RegisteredLocale` union (`types.ts`). Use the **BCP-47
   primary subtag** (`fr`, `pt`, `zh` — not `pt-BR` / `zh-Hant`; see Step 1).
2. Create `fr.ts` implementing `StagebookMessages` (copy `en.ts`, translate).
3. Add `fr` to `defaultMessages` in `index.ts`.
4. _RTL languages only:_ add it to `RTL_LOCALES` in `index.ts`.

Then get a native-speaker review and run `npm test` + `npm run build`.

The compiler does the bookkeeping: steps 1+3 are what `defaultMessages`'
`Record<RegisteredLocale, …>` type forces, so the build stays red until the
catalog is complete — that failure list _is_ your checklist. `REGISTERED_LOCALES`
is **derived** from `defaultMessages`, not a second list to maintain, so there's
no way to add a catalog yet leave the locale "unregistered". The **one** thing
the compiler can't check for you is `RTL_LOCALES` (step 4) — forget it and an
RTL language renders left-to-right.

## Step 1 — extend the closed union

In [`messages/types.ts`](../../packages/stagebook/src/messages/types.ts):

```ts
export type RegisteredLocale = "en" | "he" | "fr";
```

`defaultMessages` is typed `Record<RegisteredLocale, StagebookMessages>`, so
this single line turns "missing French catalog" into a **compile error**. That's
the catalog-completeness guarantee — there's no way to half-add a catalog.

**Use the BCP-47 primary subtag as the ID.** `resolveCatalog()` normalizes an
incoming locale to its primary subtag (`"fr-CA"` → `"fr"`) before matching, so a
catalog keyed by a region/script tag like `pt-BR` or `zh-Hant` would **never be
selected** — `resolveCatalog("pt-BR")` looks up `pt` and, finding none, falls
back to English. Register `pt` / `zh`. Region- or script-specific catalogs
(distinguishing `pt-BR` from `pt-PT`) aren't supported without changing the
resolver's normalization, which is out of scope for this runbook.

## Step 2 — write the catalog

Copy [`messages/en.ts`](../../packages/stagebook/src/messages/en.ts) to
`messages/fr.ts`, rename the export (`export const fr: StagebookMessages = {…}`),
and translate each value. Two rules carried over from the design:

- **Interpolating keys are functions, not placeholder strings.** Keep the
  signatures exactly — e.g. `charCount: (n, min, max) => \`(${n} / …)\`` and
  `timerRemaining: (time) => \`${time} restant\``. The compiler checks each
  key's parameter types, so a wrong shape won't build.
- **Stay count-neutral.** Stagebook ships no plural framework. Count-bearing
  strings are phrased so the noun never inflects on the number
  (e.g. English "Ranges selected: 3", not "3 range(s)"). Preserve that in the
  target language — pick a phrasing that reads naturally for any count rather
  than reintroducing singular/plural forms.

Let tsc drive you: run `npm run build -w stagebook` (or your editor's
type-check) and fix each "Property 'X' is missing" until it's clean. `en.ts` is
the canonical source of truth and the fallback for any key — there's no partial
catalog, so every key in `StagebookMessages` must be present.

## Step 3 — register the catalog

In [`messages/index.ts`](../../packages/stagebook/src/messages/index.ts), add the
catalog to `defaultMessages`:

```ts
import { fr } from "./fr.js";

export const defaultMessages: Record<RegisteredLocale, StagebookMessages> = {
  en,
  he,
  fr, // ← add
};
```

That's it for a left-to-right language. `REGISTERED_LOCALES` is **derived** from
`defaultMessages` (`Object.keys(defaultMessages)`), so adding the catalog here
registers the locale automatically — there's no parallel array to forget.
`resolveCatalog()`, `isRTLLocale()`, the unknown → `en` fallback, and the
host-override merge all flow from `defaultMessages` and these derived exports.

### Step 4 (RTL languages only) — mark it right-to-left

This is the one registration the compiler **cannot** check — `RTL_LOCALES` is a
hand-listed set, because right-to-left-ness isn't encoded in the catalog. Add the
locale if its script reads right-to-left (French does not):

```ts
export const RTL_LOCALES: ReadonlySet<RegisteredLocale> =
  new Set<RegisteredLocale>([
    "he",
    // "fa", "ar", … ← add an RTL locale here
  ]);
```

Once it's in `RTL_LOCALES`, the RTL layer takes over automatically:
value/quantity components mirror (the slider paints min on the right, the char
counter and timer label swap sides, option rows flip), driven by `isRTLLocale`
and the `isRTL` flag on the provider context. Time-axis controls (the media
transport, the timeline) intentionally **stay** left-to-right — only their text
chrome follows the locale. You shouldn't need new component code; if a specific
string or layout looks wrong under the new script, fix it where `he` already
exercises that path. See the ADR's "Right-to-left" section.

## Step 5 — review and verify

- **Native-speaker review.** Machine/first-draft translations are a starting
  point, not the deliverable (the same caveat stands for the seed Hebrew
  catalog). Have a fluent speaker check wording and the count-neutral phrasing.
- **Tests + build:**
  ```bash
  npm test            # vitest across workspaces (resolveCatalog, schema, …)
  npm run build       # type-checks the closed-union completeness
  ```
  Consider adding the new locale to a `resolveCatalog` test case and, if you
  want a rendered manual check, a `fr` arm in
  [`examples/i18n-gallery`](../../examples/i18n-gallery) (mirror an existing arm
  and add `prompts/fr/…`). Validate any treatment edits with
  `npx --package=stagebook stagebook validate examples/i18n-gallery/i18n-gallery.stagebook.yaml`.

## What you do _not_ need to do

- **No consumer changes.** The public `locale` prop stays an open `string` with
  a runtime registered-set check (unknown → `en` + a `console.warn`). Adding a
  locale touches stagebook's catalog, never deliberation-lab / annotator types —
  it's backward compatible by construction.
- **No browser detection.** Stagebook never reads the browser locale; the active
  locale comes from the treatment / intro sequence declaration. Assignment of
  who-sees-which-language is the host's decision.
- **No plural library, no i18n framework.** The catalog _is_ the framework.
