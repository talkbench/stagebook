# API Reference

## Schemas

All schemas are [Zod](https://zod.dev/) objects. Use `.safeParse(data)` for validation or `.parse(data)` to throw on invalid input.

### Treatment File

| Export                  | Description                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ |
| `treatmentFileSchema`   | Top-level schema for `.stagebook.yaml` files                                   |
| `treatmentSchema`       | Single treatment (name, playerCount, introSequences, gameStages, exitSequence) |
| `stageSchema`           | Game stage (name, duration, elements, discussion)                              |
| `elementSchema`         | Any element type (discriminated union on `type`)                               |
| `promptSchema`          | Prompt element specifically                                                    |
| `discussionSchema`      | Discussion configuration                                                       |
| `conditionSchema`       | Single condition (reference, comparator, value, position)                      |
| `conditionsSchema`      | Array of conditions                                                            |
| `referenceSchema`       | Reference string validator (parses and validates `type.name.path`)             |
| `introSequenceSchema`   | Intro sequence with named steps                                                |
| `introExitStepSchema`   | Single intro or exit step                                                      |
| `templateSchema`        | Template definition (name, contentType, content)                               |
| `templateContextSchema` | Template usage (template, fields, broadcast)                                   |

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

Launch-time guard for the treatment-level `introSequences:` declaration (#499). Hosts call it at batch launch — the point where batch config selects an intro sequence and a set of treatments.

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
3. Every treatment **lists** the selected sequence in its `introSequences:` — or declares `[]` when launching without one. The declaration is a constraint, not just a data dependency: a treatment that references no intro data still may not run after a sequence it doesn't list.
4. Every reference in each treatment resolves under that specific sequence.

Expects **expanded** input (e.g. the output of `expandAndValidateWithImports` or the host's own hydration pipeline); an unresolved `${...}` placeholder in a selected treatment's declaration is reported as an error rather than guessed around. Diagnostics carry `range: null` — this is a runtime check with no source-position mapping, so hosts render messages only. Deliberately intro-only: consent arms have no pairing relationship, so there is no `consentName` parameter.

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

| Slot                  | Config                       | When Used                                                                                 |
| --------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `renderSurvey`        | `{ surveyName, onComplete }` | `type: "survey"` element (deprecated — pending removal once a module-reuse pattern lands) |
| `renderDiscussion`    | Full `DiscussionType` config | Stage with `discussion` block                                                             |
| `renderSharedNotepad` | `{ padName }`                | `shared: true` open-response prompt                                                       |

### Conditional Components

| Component                     | Key Props                                                        |
| ----------------------------- | ---------------------------------------------------------------- |
| `TimeConditionalRender`       | `displayTime?`, `hideTime?`, `getElapsedTime`, `children`        |
| `PositionConditionalRender`   | `showToPositions?`, `hideFromPositions?`, `position`, `children` |
| `ConditionsConditionalRender` | `conditions`, `resolve`, `children`, `fallback?`                 |
| `SubmissionConditionalRender` | `isSubmitted`, `playerCount`, `children`                         |

## Viewer harness (`stagebook/viewer`)

The `stagebook/viewer` subpath is the reusable preview harness — the code behind the standalone viewer app, the VS Code extension's preview, and any external host embedding a participant-perspective preview over its own study files. It wraps the `stagebook/components` rendering contract (a `StagebookProvider` fed by a mock state store) and adds the dev chrome (treatment/intro pickers, stage navigation, position selector, timeline scrubber, state inspector). Peer-depends on React; performs no I/O — the host supplies file content through callbacks.

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

| Helper                        | For                                                        |
| ----------------------------- | --------------------------------------------------------- |
| `createStaticContentFns(map)` | An in-memory `path → text` map (tests, fixtures, hosts holding files in memory). `getTextContent` rejects for an absent path; `getAssetURL` returns the path unchanged. |
| `createUrlContentFns(base)`   | Fetch-backed loading from a base URL (e.g. `raw.githubusercontent.com`), with per-path caching. |

### Other exports

| Export                                                                    | Purpose                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Viewer`                                                                  | The rendering component `PreviewHost` wraps — for hosts that resolve `${field}`s themselves.   |
| `ViewerStateStore` / `createViewerStateStore()`                           | The simulated response store (resettable), for custom harnesses.                              |
| `createViewerContext(opts)`                                               | Builds the mock `StagebookContext` bridging the store to `stagebook/components`.               |
| `flattenSteps`, `extractStageReferences`, `extractTimeBreakpoints`        | Structural introspection over a treatment (steps, references, timeline breakpoints).           |
| `expandTreatmentFile(file, fields?)`                                       | Expand `templates:` and report unresolved `${field}`s (no import merge, no js-yaml).           |
| `StageNav`, `StateInspector`, `TimeScrubber`, `TreatmentPicker`, `FieldForm`, `SkeletonPlaceholder` | The individual dev-chrome components, for hosts assembling bespoke chrome. |
