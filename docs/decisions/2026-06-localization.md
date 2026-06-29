# Localization (i18n) — design decision (June 2026)

Status: **proposed** (revised after a four-lens subagent review — architecture,
completeness, consumer-integration, security). Supersedes the loose
recommendations left as comments on [#438]. Tracked as epic [#479]. Once
accepted, the cross-cutting parts fold into [principles.md](./principles.md).

## Motivation

Deliberation Lab is scoping a multilingual effort. Stagebook is the layer where
the deliberation actually happens — every button, timer, counter, error, and
prompt a participant sees while deliberating flows through it. The [#438] audit
established the starting point: **no i18n framework, no `Intl.*`, no
`toLocale*`, no `locale` prop** — stagebook is single-locale by construction
today, with ~70 hardcoded participant-facing English strings and physical
(non-logical) directional CSS in its inline component styles (the `.css`
stylesheets are already logical; the RTL work is in the components).

This ADR records the design for closing that gap.

## The shape in one sentence

**One `locale` declared on the treatment drives two things — stagebook's own
chrome (via a catalog stagebook owns) and the researcher's prompt content (via
locale-keyed file paths) — with no path through the browser's locale at all.**

## At-a-glance decisions

| #   | Decision                 | Resolution                                                                                                                                                                                                                                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Chrome ownership         | **Hybrid** — stagebook ships canonical per-locale catalogs; host overrides individual keys via a `messages` prop. Stagebook owns its ~70-key namespace.                                                                                                                                           |
| 2   | Locale source of truth   | The **treatment's** `locale`. The host derives the provider locale from the resolved treatment (net-new wiring — see [Consumer wiring](#consumer-wiring--breaking-changes)). **Browser locale is never read.**                                                                                    |
| 3   | Treatment `locale` field | New top-level field, sibling of `playerCount`. **Defaults to `en`** (absent = English; every existing study unchanged). Accepts `${...}` placeholders raw; enum-checked post-hydration.                                                                                                           |
| 4   | Researcher content       | **Single-source.** A `contentType: treatment` template carries `${locale}` in both its top-level `locale:` and its prompt `file:` paths; each arm supplies the value once via `fields:` (or `broadcast:` to fan all arms from one declaration). Verified against the existing template machinery. |
| 5   | Prompt frontmatter       | New optional `locale` field (in shared `baseMetadataFields`), **defaults to `en`**.                                                                                                                                                                                                               |
| 6   | Content validation       | Post-hydration rule: **every prompt's resolved locale must equal its treatment's locale.** Structural/semantic checks delegated to an agent checklist, not rule-based code.                                                                                                                       |
| 7   | Plurals                  | **No plural framework.** Count-bearing strings are reworded count-neutrally (e.g. "Ranges selected: N"); fixed strings + `{n}` interpolation otherwise.                                                                                                                                           |
| 8   | Localized defaults       | `buttonText` / tracked-link helper defaults move **into the catalog** — researcher YAML override still wins, otherwise the active locale's default (never English under `he`).                                                                                                                    |
| 9   | Locale typing            | Public `locale` prop is open `string` (BCP-47 primary subtag) + runtime registered-set check (unknown → `en` + warn). The catalog map is keyed by the **closed `RegisteredLocale` union** so a missing translation is a compile error. Adding a locale touches the catalog, not consumer types.   |
| 10  | RTL                      | Value/quantity components mirror under RTL (per Material bidirectionality — **incl. the Slider**); time-based controls (MediaPlayer scrubber, Timeline) stay LTR.                                                                                                                                 |
| 11  | Seed locales             | `en` + `he`. Hebrew (RTL) exercises the RTL layer in v1.                                                                                                                                                                                                                                          |
| 12  | Validator messages       | **Stay English.** Researcher-facing; out of the participant path.                                                                                                                                                                                                                                 |

> **Inventory note.** The ~70 figure must be re-derived from the _render path_,
> not from "Timeline/MediaPlayer chrome." It includes `HelpPopover` (~28
> shortcut strings alone), error boundaries, `role="alert"` early-returns, and
> string-valued maps (see [Layer 1](#layer-1--stagebook-chrome-catalog) and the
> work breakdown).

## Layer 1 — stagebook chrome catalog

> **Adding a locale later** is a mechanical, non-breaking, four-edit change —
> see the runbook: [docs/engineer/adding-a-locale.md](../engineer/adding-a-locale.md).

Stagebook owns the translation of its own strings, the same way it owns its
inline styles, slider debounce, and keystroke stats. If two deployments
translated "Continue" differently, participants in nominally-identical
experiments would see different chrome — exactly the cross-deployment drift
stagebook exists to prevent. So stagebook ships the canonical catalog; hosts
adjust individual keys only when justified (same posture as `--stagebook-*`
CSS variables: a default you can retune one knob at a time without forking).

**Catalog module** — new `packages/stagebook/src/messages/`:

- `types.ts` — `StagebookMessages` interface (~70 keys). Interpolating keys are
  functions _only where a value is embedded_ (e.g. the char counter:
  `charCount: (n, min?, max?) => string`); everything else is a plain `string`.
- `en.ts`, `he.ts` — full catalogs.
- `index.ts` — `defaultMessages: Record<RegisteredLocale, StagebookMessages>`
  (keyed by the **closed** `RegisteredLocale` union, so a locale missing a key
  fails to compile — this is the build-time completeness guarantee),
  `REGISTERED_LOCALES`, `RTL_LOCALES`, and `resolveCatalog(locale, overrides)`,
  which deep-merges `en` ← `locale` ← host overrides, warns on an unknown
  locale, and **guards malformed overrides** (a host override of the wrong
  shape — e.g. a string where a function is expected — falls back to the
  bundled entry rather than crashing render).

Re-exported from `stagebook/components`. The type surface is **additive**.

**The string inventory must cover non-JSX surfaces.** A "sweep the JSX text"
pass misses participant-facing strings that live in error paths and data
structures. The catalog refactor must explicitly include: the
`ElementErrorBoundary` fallback ("Part of this page couldn't load…", rendered on
_any_ element crash), `MediaPlayer`'s `role="alert"` early-return ("Invalid
media URL"), and `MediaPlayer`'s error-code **map** (`Record<number,string>`:
"Network error", "Failed to decode video", …) — none of which a JSX scan finds.

**Interpolating entries are functions, not placeholder strings.** The handful of
keys that embed a value are typed as functions (`charCount: (n) => string`)
rather than a `"{n} characters"` string plus a runtime interpolate helper. The
only axis that distinguished the two — whether a non-developer or a JSON
translation platform must read the catalog — does not apply here: translation is
_Claude drafts, a reviewer returns notes, Claude fixes_, and Claude edits TS as
readily as JSON. Functions then win outright — per-key parameter types are
compiler-checked, and direct interpolation (`charCount(n)`) removes the
placeholder-name-drift error class an AI first pass could otherwise introduce in
a `{n}` string. (If a human/JSON translation platform is ever adopted, the few
function keys convert back to placeholder strings then — a cheap, isolated
bridge.)

**Context API** (`StagebookProvider`) — two optional fields, siblings of
`playerCount`:

- `locale?: string` (default `"en"`)
- `messages?: DeepPartial<StagebookMessages>` (per-key overrides). **Trusted host
  input** — same trust tier as `playerCount`/`getAssetURL`, never researcher- or
  participant-supplied (see [Security](#security)).

The provider resolves the catalog **once, memoized** (an unmemoized
`resolveCatalog` on every render is a hot-path regression) and exposes it on the
internal context; components read it through a `useMessages()` hook. `isRTL`
(derived from `RTL_LOCALES`) also rides the context.

**Localized defaults.** Today `SubmitButton` hardcodes `buttonText = "Next"`.
That default moves into the catalog: `buttonText ?? messages.submitButtonDefault`.
When the researcher sets `buttonText` in YAML, their value wins (any locale);
when they don't, the fallback is the _active locale's_ default. Same for the
tracked-link helper text. A study under `locale: he` never shows an English
default.

**No plural framework — count-neutral phrasing instead.** A few participant-
facing strings genuinely depend on a count, and the original audit undercounted
them: `TimelineFooter` renders "N ranges selected" / "N points marked" (real
singular/plural noun inflection), `SubmissionConditionalRender` has "other
participant(s)", and the `TextArea` char-counter family interpolates a number in
four variants. Rather than add a plural framework for ~5 strings, we **reword
the count-dependent ones count-neutrally** — "Ranges selected: N", "Points
marked: N", "Waiting for other participants" — so each catalog entry is a fixed
string (plus `{n}` interpolation where a number appears) with no count→form
dependency. The translator guideline ships this rule explicitly and names
**Hebrew** (gender + number + dual agreement) as the reason the English `(s)`
orthography must not be mirrored. We revisit `Intl.PluralRules` only if a future
string genuinely can't be phrased count-neutrally.

## Layer 2 — researcher content

The treatment declares its locale; prompt files are duplicated per language with
the locale in the path. This is **single-source and native** to the existing
template machinery — verified against the code, not aspirational:

- `contentType: "treatment"` exists, so a template's `content` can be a _whole
  treatment_ (`schemas/treatment.ts` — `contentTypeEnum` + `matchContentType`).
- `treatmentsSchema` is wrapped in `altTemplateContext`, so a `{template, fields}`
  invocation is accepted in the `treatments:` position.
- `expandTemplate` runs `substituteFields` over the **entire** expanded content
  (`templates/fillTemplates.ts`), so a `${locale}` in the treatment's _top-level_
  `locale:` is filled exactly like one in a nested `file:` path.

```yaml
templates:
  - name: study-body
    contentType: treatment
    content:
      name: study-${locale}
      locale: ${locale}                                # filled from the same field…
      playerCount: 3
      gameStages:
        - elements:
            - { type: prompt, file: prompts/${locale}/intro.prompt.md }   # …as this
treatments:
  - { template: study-body, fields: { locale: en } }   # value written ONCE per arm
  - { template: study-body, fields: { locale: he } }
```

`${locale}` is written once in the template body and drives both the declaration
and the paths; each arm supplies the value once, so the two cannot disagree.
`broadcast: { d0: [{locale: en}, {locale: he}] }` on a single invocation likely
fans out _both_ arms from one declaration (the substitution mechanism is proven;
confirm the array-nesting with an expansion test). No new syntax — the deferred
`locales:` expander is unnecessary.

**Schema requirement.** The new top-level `locale:` field is
`localeEnum.or(fieldPlaceholderSchema)` so a raw `${locale}` validates pre-fill,
with the registered-set enum check applied _post-hydration_ — the same pattern
`groupComposition` and condition `value` already use. It carries `.default("en")`
in zod (so the post-hydration comparison and the provider see the same value;
note a zod `.default()` only materialises on parse, not on a raw object).

**Path-traversal guard (security, acceptance condition).** Because `${locale}`
flows from `fields:` straight into `file:` paths via raw substitution, the
locale value must be constrained before it reaches the host loader: **reject
`..` segments in `fileSchema`** (one line, closes traversal for _all_ file
fields) and gate the substituted locale against the registered set _before_ the
file read. The frontmatter==treatment rule below runs _after_ the read and is
defense-in-depth, not the gate. See [Security](#security).

### Content validation: rule + agent, defense in depth

The template keeps _structure_ in lockstep across locales but cannot keep
_content_ in sync — `prompts/he/intro.prompt.md` is hand-maintained and can
drift or be left untranslated. We catch this in layers, only the first of which
is rule-based:

| Layer                                                                                   | Catches                                                                                                                                        | Cost                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **Rule (CI)**: every prompt's resolved frontmatter `locale` == its treatment's `locale` | wrong/missing tag, untranslated copy with a stale tag                                                                                          | free, deterministic       |
| **Agent checklist** (on demand)                                                         | structural drift (option counts, types, scales), semantic divergence (reversed Likert, "agree"→"disagree"), tagged-but-not-actually-translated | tokens, non-deterministic |
| **Human review**                                                                        | translation quality                                                                                                                            | a colleague               |
| **Gallery visual diff**                                                                 | RTL + English leaking through, at a glance                                                                                                     | seconds                   |

The **rule** is the 80/20: with frontmatter `locale` defaulting to `en`, a
treatment under `locale: he` _cannot_ contain an untagged prompt (absent → `en`
→ mismatch → caught), so the rigor falls exactly on non-English treatments while
English studies stay frictionless. It runs post-hydration in the load/validate
layer (it reads frontmatter), not in pure zod. The structural-congruence and
semantic checks are delegated to the agent checklist
([localization-review-checklist.md](../localization-review-checklist.md)) rather
than rule-based code, because an agent reaches structural _and_ semantic
equivalence that rules can't; the checklist doubles as documentation of how the
pieces interact.

Known edge, not blocking: a genuinely language-neutral prompt (a `noResponse`
image, a bare number) still needs the locale tag under a non-English treatment.
Mildly redundant but cheaper than a `locale: neutral` escape hatch; revisit only
if it bites.

## Right-to-left

`locale` drives direction; there is no separate `dir` prop (so locale and
direction can never disagree). Components split by axis, following Material
Design's bidirectionality guidance:

- **Mirror when `isRTL`** (migrate physical → logical CSS properties): the
  **Slider** (value/quantity controls mirror), KitchenTimer label side, TextArea
  char counter, horizontal RadioGroup/CheckboxGroup rows, Markdown/Display
  blockquote rails, alignment defaults. **Slider needs special care**: the native
  `<input type=range>` _already_ auto-reverses under `dir=rtl`, but the custom
  absolutely-positioned thumb/badge/labels (`left: getPosition()%`) do **not** —
  so they desync today. The fix mirrors the custom layer to match the native
  input's reversed axis; value semantics are unchanged (min still records as
  min, wherever it's painted), locked with a CT. The `2.5rem` end-label padding
  also gets an overflow fix for longer translated labels.
- **Stay LTR always**: MediaPlayer transport + scrub bar, Timeline — time is
  unidirectional left→right in every locale (also per Material: time-based
  controls don't mirror).

`he` registers in `RTL_LOCALES`.

## Precedence / "treatment wins"

There is no `<Stagebook treatment={…}>` god-component — the host composes
`Stage`/`Element` inside `<StagebookProvider value={…}>` and builds the context
value itself. `locale` is one more field on that value, set from the resolved
treatment. Because the treatment `locale` defaults to `en` and is the single
source, behavior is deterministic and **the browser locale is never consulted**.
This supersedes the earlier "#438 comment 4" framing (host wins / warn on
mismatch): the localization is a property of the treatment, so the treatment is
authoritative and there is no "mismatch" to resolve. The only warning case left
is a treatment declaring a locale stagebook has no catalog for → fall back to
`en` + warn. (The _wiring_ by which the host gets `treatment.locale` onto the
context is not a one-liner for every consumer — see
[Consumer wiring](#consumer-wiring--breaking-changes).)

## Relationship to host i18n

The host (Deliberation Lab, annotator) internationalizes its _own_ shell —
consent, equipment check, lobby, debrief — with whatever machinery it likes
(i18next, formatjs, or its own catalog). That system and stagebook's are **fully
independent**: separate catalogs, separate keyspaces, no shared keys. Stagebook's
`messages` prop carries _only_ stagebook's keys; host strings never flow through
it, and stagebook must never expand its catalog to cover host surfaces — that
would re-introduce, in the host layer, the exact cross-deployment drift this
design exists to prevent.

The two systems share exactly **one** value — the active locale — and keeping
them in sync is the **host's** responsibility, because the host is the only place
that knows the participant's language _before and around_ the game (the shell
renders before the treatment is necessarily pinned). A well-formed host derives
both its shell locale and the assigned treatment's `locale` from the same
per-participant decision, so they agree. "Treatment wins" is therefore a
_within-stagebook safety property_ (stagebook renders the treatment's language,
never the browser's), not the origin of the locale decision — that origin is the
host's assignment.

Two consequences worth recording:

- **Composable coverage.** Because `messages` is a `DeepPartial` override, a host
  that supports a locale stagebook doesn't ship (`fr`) can supply the French
  strings for stagebook's keys directly, rather than waiting on a stagebook
  catalog release.
- **RTL needs no negotiation.** The host sets `<html dir>` for its shell;
  stagebook mirrors its own components from its `locale` prop _independent_ of
  `<html dir>`. Even if the host forgets `dir`, stagebook still renders RTL
  correctly — each system derives direction from the same locale rather than
  coordinating one. (A mixed-direction page while the host shell is LTR and a
  stagebook subtree is RTL is the expected intermediate state.)

## Security

A security review (workspace-isolation lens included) cleared the injection
surface and surfaced one fix to make an acceptance condition:

- **Injection — clear.** Every catalog string renders through an auto-escaping
  React sink (a text child or an escaped attribute like `aria-label`/`title`).
  No catalog key flows into the Markdown component, and Markdown has no
  `rehype-raw` / `dangerouslySetInnerHTML` path. **Invariant to preserve:** no
  catalog key may _ever_ be routed through Markdown or raw HTML — the natural
  future request ("let translators **bold** a word in the helper text") is
  exactly what would turn a text sink into an XSS sink. Pin it.
- **`messages` is trusted host input** — same trust tier as
  `playerCount`/`getAssetURL`, never researcher- or participant-supplied.
  Host-supplied function-valued entries are not a new code-execution surface
  (host code already controls the page); `resolveCatalog` still guards a
  malformed override by falling back to the bundled entry rather than crashing.
- **Path traversal — fix required (acceptance condition).** `${locale}` is
  substituted raw into `file:` paths. **Implemented as:** `fileSchema` rejects
  _interior_ `..` segments (a `..` after a real segment — the shape a crafted
  `${locale}` produces in the idiomatic `prompts/${locale}/x` pattern, checked
  both pre-fill and post-fill); a _leading_ run of `..` stays permitted because
  `resolveImports` mechanically produces `../shared/…` paths for templates
  imported from a parent directory (a documented, test-pinned layout — a
  blanket ban would break `imports:` from parent dirs). The CLI's
  locale-consistency pass additionally filters every path through `fileSchema`
  _before_ reading it from disk (gate-before-read). Residual, documented: a
  path that _starts_ with a placeholder (`${x}/q.prompt.md`) can fill to a
  leading-`..` path indistinguishable from import rewriting; host loaders
  remain responsible for sandboxing reads to the study root (the
  `getTextContent` contract).
- **Bidi/homograph spoofing — researcher-facing warning.** Bidi-override control
  chars (U+202A–202E, U+2066–2069) in participant-facing strings (esp.
  `trackedLink.displayText`) can spoof visible link text; RTL makes them less
  conspicuous. Add a deterministic validator **warning** (researcher-facing,
  English) plus a checklist item — _not_ runtime sanitization, which would
  corrupt legitimate Hebrew/Arabic content.

## Gallery harness (dev aid + manual test)

The viewer holds the treatment object, so it can drive stagebook's locale from
`treatment.locale` — but **not in one line**: the context is built in a
`createViewerContext` factory (`apps/viewer/src/lib/context.ts`), so wiring it
touches the factory's options type, the returned object, the `Viewer.tsx` call
site, and the `useMemo` dependency array (without the dep, the live locale
dropdown below won't re-render). Plus:

- a viewer **locale dropdown** (a preview-only override of the treatment-declared
  locale) so en↔he flips live on one gallery — exercising the runtime
  locale-switch path; and
- a **Hebrew sibling** of
  [component-gallery.stagebook.yaml](../../examples/component-gallery/component-gallery.stagebook.yaml)
  declaring `locale: he`, so the full RTL + translated experience renders.

This is both the development aid and the manual RTL/translation test artifact.

## Consumer wiring & breaking changes

**No breaking changes at runtime.** `locale`/`messages` are optional and default
to `en`; existing apps render byte-identically. (One theoretical exception: a
host that sets `<html dir="rtl">` and embeds stagebook at default `en` — text
inside components previously inherited the host's rtl flow and is now pinned
ltr per the deterministic-direction design. No known consumer does this; all
current shells are LTR.) The treatment `locale` field and
prompt frontmatter `locale` are optional/back-compatible. Additive type surface
(`StagebookMessages`, `defaultMessages`, helpers).

Consumer caveats (corrected after the consumer-integration review — the
"wire it like `playerCount` in one line" framing was wrong):

- **The viewer** wires `locale` through the `createViewerContext` factory
  (options type + returned object + call site + `useMemo` dep), not a one-line
  change. It _does_ hold the treatment object, so the value is reachable.
- **The Deliberation Lab adapter** does **not** currently read a treatment
  object at all — its `playerCount` is `players.length` (the live Empirica
  participant count), _not_ `treatment.playerCount`. Wiring locale is net-new:
  read `game.get("treatment")?.locale` in `Provider.jsx`, thread it through
  `buildStagebookContextValue`, add it to the memo deps. **And it is gated on a
  Deliberation Lab server-side change** to pass the treatment's `locale` through
  to the assigned-treatment object the client reads — an unverified prerequisite
  and the highest-leverage external dependency in this epic.
- **Frontmatter `locale`** must be added to the shared `baseMetadataFields` (not
  per-type), because each metadata schema is `.strict()`.
- **Playwright fallout is small** — a re-check found near-zero literal-`aria-label`
  selectors in deliberation-lab and none in stagebook's own CT. Where they
  exist, assert against `defaultMessages.en.*` to decouple from copy. (Note the
  viewer's own "Waiting for other participants…" overlay is host-owned, not a
  stagebook catalog string.)

## Deferred (explicitly out of v1)

Validator/schema error i18n (~125 researcher-facing strings); `Intl.DateTimeFormat`
/ `NumberFormat`; `formatTime` changes; locale-aware collation in `compare:`;
language-detection on prompt bodies (the residual "tagged correctly but body
untranslated" gap is closed by human review + the gallery, not by unreliable
NLP); a `locale: neutral` escape hatch; a dedicated `locales: [en, he]` expander
(single-source already works via a `contentType: treatment` template + optional
`broadcast:` — an expander would be pure sugar; revisit only if authoring proves
it needed).

## Work breakdown (stacked PRs under one epic)

1. **This ADR + epic issue** — accept the decisions, open the epic, link subs.
2. **Catalog scaffold** — `src/messages/` (`en` only), `StagebookMessages`,
   `resolveCatalog` (memoized at the provider, with the malformed-override
   guard), `locale`/`messages`/`isRTL` on context, `useMessages`. TDD on merge +
   unknown-locale fallback. No component changes.
3. **Gallery harness** — viewer `locale` wiring (via `createViewerContext` +
   memo dep) + dropdown, visible before the refactor.
4. **Refactor strings → catalog** — every component reads `useMessages()`.
   **Explicitly include non-JSX surfaces**: `ElementErrorBoundary`, `role=alert`
   early-returns (`MediaPlayer` "Invalid media URL"), and the `MediaPlayer`
   error-code map. Apply the **count-neutral rewrites** (Timeline footer,
   Submission wait, char counter). `en` byte-identical; tests assert
   `defaultMessages.en.*`.
5. **Treatment `locale` field** — `localeEnum.or(fieldPlaceholderSchema)` +
   `.default("en")`, enum post-hydration; **reject `..` in `fileSchema` + gate
   the locale before file read (security)**; CLI `validate` coverage.
6. **Prompt frontmatter `locale` + content rule** — optional field in shared
   `baseMetadataFields` (default `en`) + post-hydration "prompt locale ==
   treatment locale" check.
7. **RTL layer** — logical-property migration, mirroring **including the Slider
   native-input desync fix**, `isRTL` plumbing, Slider padding fix; CT under
   `dir="rtl"`.
8. **Hebrew catalog + gallery** — `he.ts` (first-draft translation, colleague
   verifies), `he` registered RTL, Hebrew gallery file; **bidi-control-char
   validator warning** for participant-facing string fields.
9. **Agent checklist** — `docs/localization-review-checklist.md` (may later
   graduate into a `.claude/skills/` verify-skill).
10. **Consumer wiring** — viewer (`createViewerContext` + memo dep) and the
    deliberation-lab adapter (net-new `game.get("treatment").locale` read, memo
    dep) set `locale` from the treatment, **gated on the DL server-side
    treatment-field passthrough**; right-size any literal-aria-label selectors.

[#438]: https://github.com/deliberation-lab/stagebook/issues/438
[#479]: https://github.com/deliberation-lab/stagebook/issues/479
