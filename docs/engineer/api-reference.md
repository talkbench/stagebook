# API Reference

## Schemas

All schemas are [Zod](https://zod.dev/) objects. Use `.safeParse(data)` for validation or `.parse(data)` to throw on invalid input.

### Treatment File

| Export                  | Description                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `treatmentFileSchema`   | Top-level schema for `.stagebook.yaml` files                                             |
| `treatmentSchema`       | Single treatment (name, playerCount, compatibleIntroSequences, gameStages, exitSequence) |
| `stageSchema`           | Game stage (name, duration, elements, discussion)                                        |
| `elementSchema`         | Any element type (discriminated union on `type`)                                         |
| `promptSchema`          | Prompt element specifically                                                              |
| `discussionSchema`      | Discussion configuration                                                                 |
| `conditionSchema`       | Single condition (reference, comparator, value, position)                                |
| `conditionsSchema`      | Array of conditions                                                                      |
| `referenceSchema`       | Reference string validator (parses and validates `type.name.path`)                       |
| `introSequenceSchema`   | Intro sequence with named steps                                                          |
| `introExitStepSchema`   | Single intro or exit step                                                                |
| `consentArmSchema`      | Single consent arm (name, own locale, steps) — #481                                      |
| `consentSchema`         | Top-level `consent:` array of arms (names unique within the collection)                  |
| `templateSchema`        | Template definition (name, contentType, content)                                         |
| `templateContextSchema` | Template usage (template, fields, broadcast)                                             |

### Prompt File

| Export                                                                  | Description                                                                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `promptFileSchema`                                                      | Parses raw markdown → `{ metadata, body, responseItems, sliderPoints }` with full validation                                                          |
| `promptMetadataSchema`                                                  | Discriminated-union schema for the YAML frontmatter (one strict branch per `type:`)                                                                   |
| `metadataTypeSchema` / `metadataRefineSchema` / `metadataLogicalSchema` | Back-compat aliases for `promptMetadataSchema` (#243 — the parallel pre-refine pair was unified into one schema)                                      |
| `validateSliderLabels(metadata, items)`                                 | No-op shim retained for back-compat — slider points and labels share the same body lines after #243, so this check is structurally impossible to fail |

### Types

Every schema has a corresponding TypeScript type:

```typescript
import type {
  TreatmentFileType,
  TreatmentType,
  StageType,
  ElementType,
  DiscussionType,
  ConditionType,
  ConsentArmType,
  MetadataType,
  PromptFileType,
} from "stagebook";
```

## Utilities

### `compare(lhs, comparator, rhs?)`

Evaluate a condition comparator.

```typescript
import { compare, type Comparator } from "stagebook";

compare(5, "isAbove", 3); // true
compare(undefined, "doesNotEqual", "x"); // true (undefined != anything)
compare(undefined, "equals", "x"); // undefined (can't determine yet)
compare("hello", "matches", "\\d+"); // false
```

**Returns:** `true`, `false`, or `undefined` (when comparison can't be made yet, e.g., undefined lhs).

**Comparators:** `exists`, `doesNotExist`, `equals`, `doesNotEqual`, `isAbove`, `isBelow`, `isAtLeast`, `isAtMost`, `hasLengthAtLeast`, `hasLengthAtMost`, `includes`, `doesNotInclude`, `matches`, `doesNotMatch`, `isOneOf`, `isNotOneOf`.

### `getReferenceKeyAndPath(reference)`

Parse a DSL reference string into a storage key and nested path. The `StagebookProvider` uses this internally to convert DSL references into flat key lookups — **platforms don't need to call this for basic integration**. It remains exported for advanced tooling (e.g., state inspectors, debugging tools).

```typescript
import { getReferenceKeyAndPath } from "stagebook";

// Every reference string starts with a position selector — `self`,
// `shared`, `all`, or a non-negative integer slot index (#298).
// getReferenceKeyAndPath strips the position to return just the
// storage key and path; un-prefixed strings throw at parse time.

getReferenceKeyAndPath("self.survey.bigFive.result.score");
// { referenceKey: "survey_bigFive", path: ["result", "score"] }

getReferenceKeyAndPath("self.prompt.myQuestion");
// { referenceKey: "prompt_myQuestion", path: ["value"] }

getReferenceKeyAndPath("self.entryUrl.params.condition");
// { referenceKey: "entryUrl", path: ["params", "condition"] }
```

Supported namespaces: `survey`, `submitButton`, `qualtrics`, `prompt`, `trackedLink`, `timeline`, `discussion`, `entryUrl`, `attributes`. (`urlParams` was renamed to `entryUrl` in #246; the `connectionInfo` / `browserInfo` / `participantInfo` bags were merged into a single flat `attributes` source in #473.) `entryUrl` references must use the `params` subpath, e.g. `self.entryUrl.params.condition` — bare `entryUrl.<key>` is rejected.

### `getNestedValueByPath(obj, path?)`

Traverse a nested object by path array.

```typescript
import { getNestedValueByPath } from "stagebook";

getNestedValueByPath({ a: { b: { c: 42 } } }, ["a", "b", "c"]); // 42
getNestedValueByPath({ a: 1 }, ["x"]); // undefined
getNestedValueByPath({ a: 1 }); // { a: 1 }
```

### `fillTemplates({ obj, templates })`

Expand all template references in a structure.

```typescript
import { fillTemplates } from "stagebook";

const expanded = fillTemplates({
  obj: rawTreatments,
  templates: templateDefinitions,
});
```

Throws if any `${field}` placeholders remain unresolved.

Also exported: `expandTemplate`, `substituteFields`, `recursivelyFillTemplates` for lower-level control.

## Validation (`stagebook/validate`)

The `stagebook/validate` subpath exports the position-aware validators shared by the CLI, the VS Code extension, and the viewer: `validateTreatmentSource`, `validatePromptSource`, `loadAndMergeImports`, `expandAndValidateWithImports`, the `Diagnostic` type, and position-mapping helpers.

### `checkPairing(file, { introSequenceName }, treatmentNames)`

Launch-time guard for the treatment-level `compatibleIntroSequences:` declaration (#499). Hosts call it at batch launch — the point where batch config selects an intro sequence and a set of treatments.

```typescript
import { checkPairing, type Diagnostic } from "stagebook/validate";

const diagnostics: Diagnostic[] = checkPairing(
  expandedFile, // post fillTemplates / import merge
  { introSequenceName: "prolific_en" }, // or null for an intro-less launch
  ["negotiation_high_stakes", "control"],
);
```

**Returns:** `Diagnostic[]` — empty means the pairing is valid. Checks, in order:

1. The named intro sequence exists (when one is selected).
2. Every named treatment exists.
3. Every treatment **lists** the selected sequence in its `compatibleIntroSequences:` — or declares `[]` when launching without one. The declaration is a constraint, not just a data dependency: a treatment that references no intro data still may not run after a sequence it doesn't list.
4. Every reference in each treatment resolves under that specific sequence.

Expects **expanded** input (e.g. the output of `expandAndValidateWithImports` or the host's own hydration pipeline); an unresolved `${...}` placeholder in a selected treatment's declaration is reported as an error rather than guessed around. Diagnostics carry `range: null` — this is a runtime check with no source-position mapping, so hosts render messages only. Deliberately intro-only: consent arms have no pairing relationship, so there is no `consentName` parameter.

### `getRequiredServices(mergedFile, { loadPrompt })`

Host provisioning primitive (#508): walk an expanded treatment and report which external services it requires, so a host provisions exactly those and nothing more. One of the host-facing analysis family, alongside `getReferencedAssets` (→ asset mirror), `checkPairing` (→ intro pairing) and `getTreatmentDurations` (→ runtime bounds).

```typescript
import {
  getRequiredServices,
  mergeRequiredServices,
  type RequiredServicesReport,
} from "stagebook/validate";

const report: RequiredServicesReport = await getRequiredServices(
  expandedFile, // post fillTemplates / import merge
  { loadPrompt: (path) => readPromptFile(path) }, // same injection shape as loadAndMergeImports
);

// Whole-file default — provision for any arm the file could launch:
if (report.overall.coedit) spawnPairedCoeditPod();

// Or narrow to the selected launch (treatments × intro sequence — the
// same selection you pass to checkPairing — × consent arm) and provision
// precisely:
const needs = mergeRequiredServices(
  ...selectedTreatmentNames.map((t) => report.byTreatment[t]),
  report.byIntroSequence[selectedIntroSequenceName],
  report.byConsent[selectedConsentName],
);
if (needs.video) ensureDailyKeyForwarded();
if (needs.externalSurvey) requireQualtricsCreds();
```

**Returns:** `Promise<RequiredServicesReport>` — `{ overall, byTreatment, byIntroSequence, byConsent }`, where each value is a `RequiredServices` = `{ coedit, video, textChat, externalSurvey }` of booleans. `overall` is the whole-file union; `byTreatment` / `byIntroSequence` / `byConsent` are keyed by arm `name` (built with a null prototype, so a schema-valid but hostile arm name like `__proto__` stays an ordinary, enumerable key). Trigger → service mapping (walk of the expanded tree):

| Service          | Trigger                                                                         |
| ---------------- | ------------------------------------------------------------------------------- |
| `coedit`         | `prompt` element, `shared: true`, referenced prompt file `type: openResponse`   |
| `video`          | stage `discussion` block, `chatType: video` or `audio` (→ Daily / WebRTC)       |
| `textChat`       | stage `discussion` block, `chatType: text`                                      |
| `externalSurvey` | `type: qualtrics` element (the native `type: survey` needs no external service) |

Async because the coedit signal is **split across files**: `shared: true` lives in the treatment YAML but `type: openResponse` lives in the separate `.prompt.md`, so shared prompts' frontmatter is resolved via `loadPrompt` — the same loader-injection shape `loadAndMergeImports` uses (the host owns path resolution and I/O). `loadPrompt` is only called for prompts flagged `shared: true` (its `file:` path skipped if it still holds a `${...}` placeholder), and every referenced shared prompt is loaded at most once across all arms; loader errors propagate rather than silently under-provisioning.

Expects a **fully hydrated** tree — imports merged **and** templates expanded (`fillTemplates` run), e.g. `parseTreatmentSource(...).data` or your own hydration pipeline. A merely import-merged tree (`loadAndMergeImports().merged`) is not enough: it still carries `templates:` definitions and unsubstituted `${...}` fields. Service triggers are read only from real DSL positions (`elements:` items and a stage's `discussion:` block), so an element-shaped object sitting in an opaque config bag (e.g. a discussion layout feed's `options`) is never mistaken for an element.

**Keyed by arm.** A launch selects **(treatment set) × (one intro sequence) × (one consent arm)** — the treatment/intro axes are exactly `checkPairing`'s inputs; the top-level `consent:` collection (#481) is selected separately by `consentName`. A file that keeps pilot/control variants together can be provisioned for just the selected arms via `byTreatment` / `byIntroSequence` / `byConsent` + `mergeRequiredServices`, instead of the whole-file `overall` union (which over-provisions in the safe direction). `coedit`, `video` and `textChat` are game-stage-only, so they only ever surface under `byTreatment`; `externalSurvey` is the one need that can also come from an intro sequence or a consent arm (a Qualtrics consent/demographics step), which is why those are separate keyed axes. `overall` is a genuine whole-file walk (not merely the union of the maps), so stray or unnamed service-bearing content is still caught. `mergeRequiredServices(...services)` OR-combines any number of `RequiredServices` (skipping `undefined`, so an unknown arm key contributes nothing).

### `getTreatmentDurations(hydratedFile)`

Host bounds primitive (#585): **how long can this treatment run?** The fourth member of the host-facing analysis family. A host that provisions infrastructure has runtime bounds the design knows nothing about and must check the design against them — the runner creates a Daily room per game with a hard-coded one-hour `exp`, and nothing sums a treatment's stage durations against it, so a study longer than 60 minutes loses its room mid-session (talkbench/runner#542 §3).

```typescript
import {
  getTreatmentDurations,
  mergeTreatmentDurations,
  type TreatmentDurationsReport,
} from "stagebook/validate";

const report: TreatmentDurationsReport = getTreatmentDurations(expandedFile);

// Narrowing looks arms up BY NAME, and an unreadable arm has no name to
// look up — so check this before trusting any narrowed merge, or a missing
// key silently merges to an all-zero, all-clear bound.
if (report.unnamedArms > 0) throw new Error("treatment is not hydrated");

// Narrow to the launch's selection (treatments × intro sequence × consent
// arm — the same selection you pass to checkPairing / getRequiredServices):
const bound = mergeTreatmentDurations(
  ...selectedTreatmentNames.map((t) => report.byTreatment[t]),
  report.byIntroSequence[selectedIntroSequenceName],
  report.byConsent[selectedConsentName],
);

// runner: size the call room to the game, plus slack, with the current
// hour as a floor so nothing regresses. Check the flag first — a non-zero
// unresolvedStages means gameSeconds is an under-count (see below).
if (bound.unresolvedStages > 0) throw new Error("treatment is not hydrated");
const roomExp = now + Math.max(3600, bound.gameSeconds + SLACK_SECONDS);

// manager: participant time for payment estimation. The self-paced phases
// carry no duration in the DSL (see below), so the host applies its own
// per-step estimate to the counts. This consumes gameSeconds TOO, so it
// guards on the stage flag as well as the three step flags — guard every
// input the calculation actually reads.
if (
  bound.unresolvedStages +
    bound.unresolvedConsentSteps +
    bound.unresolvedIntroSteps +
    bound.unresolvedExitSteps >
  0
)
  throw new Error("treatment is not hydrated");
const participantSeconds =
  bound.gameSeconds +
  (bound.consentSteps + bound.introSteps + bound.exitSteps) * SECONDS_PER_STEP;
```

**Returns:** `TreatmentDurationsReport` — `{ overall, byTreatment, byIntroSequence, byConsent, unnamedArms }`. The first four hold a `TreatmentDurations`:

| Field                                                                     | Meaning                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `gameSeconds`                                                             | Sum of `gameStages[].duration` in scope — the number a per-game resource's lifetime must cover                             |
| `gameStages`                                                              | How many game stages are in scope                                                                                          |
| `unresolvedStages`                                                        | Game stages that contributed no seconds — **non-zero means `gameSeconds` is an under-count and the bound is unsafe**       |
| `consentSteps`                                                            | Self-paced steps in `consent[].steps`                                                                                      |
| `introSteps`                                                              | Self-paced steps in `introSequences[].introSteps`                                                                          |
| `exitSteps`                                                               | Self-paced steps in `treatments[].exitSequence` (debrief included — it's authored as the trailing exit steps, #481)        |
| `unresolvedConsentSteps` / `unresolvedIntroSteps` / `unresolvedExitSteps` | The same flag per phase — step positions whose contents couldn't be read. An absent (optional) `exitSequence:` is not one. |

**Upper bound, not a prediction.** A game stage ends early when every player submits, and a stage with `conditions:` may be skipped entirely — it still counts, because over-provisioning is the safe direction for a resource bound. Don't show these numbers to a participant as "how long this takes".

`gameSeconds` is always finite and JSON-safe: `durationSchema` sets no upper bound, so a schema-valid pair of enormous durations could otherwise sum to `Infinity` — which `JSON.stringify` hands a host as `null`, and `now + Infinity` is a nonsense expiry. Such a sum is clamped to `Number.MAX_SAFE_INTEGER` and flagged in `unresolvedStages` instead.

**Only game stages are timed.** `duration` exists on exactly one node in the DSL: a game stage. Intro, exit and consent steps are self-paced — `introExitStepSchema` has no duration field — so no honest number can be summed for them. Rather than report a structurally-zero "intro seconds" a caller would read as "the intro is instant", they're reported as **counts** and the per-step estimate is left to the host, the only layer that has one. (Element-level `displayTime` / `hideTime` / `timer.endTime` inside a self-paced step are ignored: an element that appears at `t=60` implies the step lasts _at least_ 60s, and mixing a lower bound into an upper bound yields neither.)

**Pure and synchronous** — unlike `getRequiredServices`, every duration is already in the treatment tree, so there is no loader to inject. Accepts `unknown`; a non-object yields a zero report.

**Un-hydrated input is flagged, never a silent zero.** Expects the same **hydrated** tree (imports merged **and** templates expanded) — but note that hydrated does _not_ mean fully resolved. `parseTreatmentSource` runs `fillTemplates({ allowUnresolved: true })` deliberately, so editor and preview surfaces can render a partially-authored file; its output is in-contract input here and may still carry `duration: "${stageLength}"`. That is why this **reports rather than throws** — refusing unresolved input would reject the recommended pipeline's own output — and why checking the flags is the caller's job rather than an optional nicety. The dangerous failure here is the quiet one: `altTemplateContext` wraps every arm collection, every step list and every stage, so a merely import-merged tree can hold a template _invocation_ at any of those levels — the whole collection (`treatments: {template: all_arms}`), one arm (`- template: std`), a list (`gameStages: {template: rounds}`), or a single position (`introSteps: [{template: checks}]`). A naive reader finds no durations, reports a clean zero, and lets a host compute `max(3600, 0 + slack)` — silently falling back to exactly the hard-coded hour this primitive exists to remove. A `broadcast:` invocation compounds it, fanning one position out into several units. So **every position that can't be read counts as one unit and raises the `unresolved*` counter for its phase**; nothing is dropped in silence. Check the flag for the number you are about to use.

`unnamedArms` is the report-level counterpart, and a narrowing host must check it. The per-arm counters can't carry this warning: narrowing looks arms up by name, an unreadable arm has no name (`templateContextSchema` is `{ template, fields?, broadcast? }` — no `name`), so `byTreatment[selected]` is `undefined`, `mergeTreatmentDurations` skips it, and the narrowed bound comes back all-zero **and** all-clear. `overall` is unaffected — it covers every entry regardless of name — and `unnamedArms` is zero for any fully hydrated file, since every arm the schema accepts carries a `name`.

Those counters are split **per phase** rather than aggregated into one `unresolvedSteps`, for the same reason every other field is: consent, intro and exit run in _series_ for one participant, so maxing a single shared counter across them would report `1` where three phases each hid a position. Keeping every field per-phase is what makes the field-wise `max` below exact rather than approximate.

**Reads fixed positions, does not search.** Each arm collection has one shape, so this reads named fields off the arm root (`treatments[]` → `gameStages` + `exitSequence`, `introSequences[]` → `introSteps`, `consent[]` → `steps`) rather than hunting those key names through the subtree. That is load-bearing rather than stylistic: `discussion.layout.feeds[].options` is an open `z.record(z.string(), z.unknown())` bag **inside a game stage**, so an author-controlled key named `steps` there would otherwise be counted as consent steps. Reading fixed positions makes that structurally impossible — as it does for a `duration` in a config bag, a `mediaPlayer`'s `stepDuration`, or a `timer`'s `endTime` — and drops the tree recursion (and its stack-depth ceiling) with it.

**Keyed by arm, and merged with `max`.** `mergeTreatmentDurations(...durations)` takes the field-wise **maximum** (skipping `undefined`; no arguments yields zeros) — max rather than sum because a launch's arms are alternatives a participant is assigned between, not phases they run in series. That stays correct across phases only because each phase is its own field: a consent arm contributes `consentSteps` and nothing else, so maxing them together never lets one phase mask another. For the same reason `overall` is the field-wise max over every arm in the file (including unnamed ones the keyed maps drop), **not** the whole-file union `getRequiredServices.overall` is — summing two arms' game stages would describe a session nobody runs and inflate the bound by a factor of the arm count.

Two caveats for hosts, both shared with `getRequiredServices`: an unknown arm name merges as `undefined` (contributing nothing), which is indistinguishable from a real arm with no game stages — assert the key exists before merging if you need to tell those apart. And the keyed maps are built with a null prototype so a schema-valid but hostile arm name like `__proto__` stays an ordinary enumerable key; copying one with `Object.assign({}, map)` re-introduces the hazard (use `{...map}` or a JSON round-trip instead).

## React Components

### StagebookProvider

```tsx
import { StagebookProvider, type StagebookContext } from "stagebook/components";

<StagebookProvider value={context}>{children}</StagebookProvider>;
```

### Hooks

| Hook                               | Returns                        | Requires Provider |
| ---------------------------------- | ------------------------------ | ----------------- |
| `useStagebookContext()`            | Full `StagebookContext` object | yes               |
| `useResolve(reference, position?)` | `unknown[]`                    | yes               |
| `useSave()`                        | `save` function                | yes               |
| `useElapsedTime()`                 | `number` (seconds)             | yes               |
| `useTextContent(path)`             | `{ data, isLoading, error }`   | yes               |

### Stage

```tsx
import { Stage, type StageConfig } from "stagebook/components";

<Stage stage={stageConfig} onSubmit={handleSubmit} scrollMode="host" />;
```

Requires StagebookProvider. Renders a complete stage: lays out elements with conditional rendering (time, position, conditions), handles two-column layout when a discussion is present, and shows a waiting message after submission. **This is the primary rendering API** — prefer `Stage` over manually rendering `Element` components.

`StageConfig` has: `name` (string), `duration?` (number), `elements` (ElementConfig[]), `discussion?` (DiscussionType).

`scrollMode?: "internal" | "host"` (default `"internal"`) — controls who owns the scroll container around Stage's elements. `internal` keeps the existing `overflow: auto` wrapper + internal `<ScrollIndicator>`; `host` drops both, lets content flow naturally, and lets you mount your own scroll container with the publicly exported `useScrollAwareness` + `<ScrollIndicator>`. See [Page Chrome and Scroll Model](./integration-guide.md#page-chrome-and-scroll-model) in the integration guide for the host-mode setup pattern.

### Scroll Awareness

```tsx
import { useScrollAwareness, ScrollIndicator } from "stagebook/components";

const scrollRef = useRef<HTMLElement>(null);
const { showIndicator, dismissIndicator } = useScrollAwareness(scrollRef);

return (
  <main ref={scrollRef} style={{ overflow: "auto" }}>
    {/* … your stage … */}
    <ScrollIndicator visible={showIndicator} />
  </main>
);
```

`useScrollAwareness(containerRef, { threshold? })` watches the container for new content appearing below the viewport. If the user is near the bottom (within `threshold` px, default 120) it auto-"peeks" the new content into view; otherwise it sets `showIndicator` to `true` and clears it when the user scrolls to the bottom.

`<ScrollIndicator visible>` is a `position: sticky; bottom: 0` chevron that pulses to draw attention. It auto-renders nothing when `visible` is false, so you can leave it mounted unconditionally.

These are the primitives Stage's `internal` mode uses internally; in `host` mode you mount them yourself against your own scroll container.

### Element Router

```tsx
import { Element, type ElementConfig } from "stagebook/components";

<Element element={elementConfig} onSubmit={handleSubmit} stageDuration={300} />;
```

Requires StagebookProvider. Dispatches to the appropriate element component based on `element.type`. Use this for lower-level control when `Stage` doesn't fit your needs.

### Form Components (standalone)

| Component       | Key Props                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`        | `onClick`, `children`, `primary?`, `disabled?`                                                                                                                     |
| `Separator`     | `style?` (`"thin"`, `"regular"`, `"thick"`)                                                                                                                        |
| `RadioGroup`    | `options`, `value`, `onChange`, `label?`                                                                                                                           |
| `CheckboxGroup` | `options`, `value`, `onChange`, `label?`                                                                                                                           |
| `Select`        | `options`, `value`, `onChange`, `label?`, `placeholder?`                                                                                                           |
| `TextArea`      | `value`, `onChange`, `rows?`, `minLength?`, `maxLength?`, `showCharacterCount?`, `onDebugMessage?`                                                                 |
| `Slider`        | `min`, `max`, `interval`, `value?`, `onChange`, `labelPts?` (parallel to `labels?`, sourced from `promptFileSchema.parse(...).sliderPoints` after #243), `labels?` |
| `ListSorter`    | `items`, `onChange`                                                                                                                                                |
| `Markdown`      | `text`, `resolveURL?`                                                                                                                                              |

### Element Components (pure props)

| Component       | Key Props                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `Prompt`        | `metadata`, `body`, `responseItems`, `name`, `save`, `getElapsedTime`, `value`, `progressLabel`             |
| `Display`       | `reference`, `values`, `position?`                                                                          |
| `SubmitButton`  | `onSubmit`, `name`, `save`, `getElapsedTime`, `buttonText?`                                                 |
| `AudioElement`  | `src`                                                                                                       |
| `ImageElement`  | `src`, `width?`                                                                                             |
| `KitchenTimer`  | `startTime`, `endTime`, `getElapsedTime`, `warnTimeRemaining?`                                              |
| `TrackedLink`   | `name`, `url`, `displayText`, `save`, `getElapsedTime`, `progressLabel`, `resolvedParams?`                  |
| `TrainingVideo` | `url`, `getElapsedTime`, `onComplete`                                                                       |
| `Qualtrics`     | `url`, `resolvedParams?`, `stableParticipantId?`, `sampleId?`, `onContractViolation?`, `save`, `onComplete` |

### Render Slots (platform-provided)

| Slot                  | Config                             | When Used                                                                                                                               |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `renderSurvey`        | `{ surveyName, onComplete }`       | `type: "survey"` element (deprecated — pending removal once a module-reuse pattern lands)                                               |
| `renderDiscussion`    | Full `DiscussionType` config       | Stage with `discussion` block                                                                                                           |
| `renderSharedNotepad` | `{ padName, defaultText?, rows? }` | `shared: true` open-response prompt. `defaultText` is placeholder-only: hint text, never seeded into the shared document or saved value |

### Conditional Components

| Component                     | Key Props                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `TimeConditionalRender`       | `displayTime?`, `hideTime?`, `getElapsedTime`, `children`        |
| `PositionConditionalRender`   | `showToPositions?`, `hideFromPositions?`, `position`, `children` |
| `ConditionsConditionalRender` | `conditions`, `resolve`, `children`, `fallback?`                 |
| `SubmissionConditionalRender` | `isSubmitted`, `playerCount`, `children`                         |

## Viewer harness (`stagebook/viewer`)

The `stagebook/viewer` subpath is the reusable preview harness — the code behind the standalone viewer app, the VS Code extension's preview, and any external host embedding a participant-perspective preview over its own study files. It wraps the `stagebook/components` rendering contract (a `StagebookProvider` fed by a mock state store) and adds the dev chrome (treatment/intro pickers, stage navigation, position selector, timeline scrubber, state inspector). Peer-depends on React. The harness itself does no I/O — `PreviewHost`/`Viewer` read content only through host-supplied callbacks; the `createUrlContentFns` helper below is an optional fetch-backed convenience, while `createStaticContentFns` keeps the whole flow I/O-free.

**Rule of thumb: components render, validate diagnoses, viewer harnesses.**

### `PreviewHost`

Batteries-included harness: give it a parsed treatment file plus two content callbacks and it owns template expansion, unresolved-`${field}` prompting, the mock state store, and the full dev chrome.

```tsx
import { PreviewHost, createStaticContentFns } from "stagebook/viewer";

const { getTextContent, getAssetURL } = createStaticContentFns({
  "prompts/q1.prompt.md": "# Your view\n\nWrite a sentence.",
});

<PreviewHost
  treatmentFile={parsedTreatment}
  getTextContent={getTextContent} // async (path) => Promise<string>; must be stable
  getAssetURL={getAssetURL} // sync (path) => string; must be stable
  selectedIntroIndex={0}
  selectedTreatmentIndex={0}
/>;
```

`getTextContent`/`getAssetURL` **must be referentially stable** (memoize them) or the harness re-fetches on every render.

### Content-fn helpers

| Helper                        | For                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createStaticContentFns(map)` | An in-memory `path → text` map (tests, fixtures, hosts holding files in memory). `getTextContent` rejects for an absent path; `getAssetURL` returns the path unchanged. |
| `createUrlContentFns(base)`   | Fetch-backed loading from a base URL (e.g. `raw.githubusercontent.com`), with per-path caching.                                                                         |

### Other exports

| Export                                                                                              | Purpose                                                                                      |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `Viewer`                                                                                            | The rendering component `PreviewHost` wraps — for hosts that resolve `${field}`s themselves. |
| `ViewerStateStore` / `createViewerStateStore()`                                                     | The simulated response store (resettable), for custom harnesses.                             |
| `createViewerContext(opts)`                                                                         | Builds the mock `StagebookContext` bridging the store to `stagebook/components`.             |
| `flattenSteps`, `extractStageReferences`, `extractTimeBreakpoints`                                  | Structural introspection over a treatment (steps, references, timeline breakpoints).         |
| `expandTreatmentFile(file, fields?)`                                                                | Expand `templates:` and report unresolved `${field}`s (no import merge, no js-yaml).         |
| `StageNav`, `StateInspector`, `TimeScrubber`, `TreatmentPicker`, `FieldForm`, `SkeletonPlaceholder` | The individual dev-chrome components, for hosts assembling bespoke chrome.                   |
