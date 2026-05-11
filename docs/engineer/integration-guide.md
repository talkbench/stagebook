# Integrating Stagebook into Your Platform

This guide explains how to add Stagebook as a dependency and implement the platform-specific backend that powers Stagebook's rendering components. Stagebook provides the experiment description language (schemas + validation) and the rendering layer (React components). Your platform provides the state management, content delivery, and service integrations.

## Installation

```bash
npm install stagebook
```

Peer dependencies (install if not already present):

```bash
npm install zod js-yaml react react-dom
```

## Package Structure

Stagebook exports from two entry points:

```typescript
// Schemas, validators, and utilities — no React dependency
import { treatmentFileSchema, compare, fillTemplates } from "stagebook";

// React components — requires React 18+
import {
  StagebookProvider,
  Element,
  Markdown,
  Button,
} from "stagebook/components";
```

## Validating Treatment Files

The most basic integration is validation. Use this in build tools, CI pipelines, or editor extensions:

```typescript
import { treatmentFileSchema, fillTemplates } from "stagebook";
import { load as loadYaml } from "js-yaml";
import { readFileSync } from "fs";

// Load and parse
const raw = loadYaml(readFileSync("study.stagebook.yaml", "utf-8"));

// Expand templates
const templates = raw.templates ?? [];
const expanded = {
  ...raw,
  introSequences: fillTemplates({ obj: raw.introSequences, templates }),
  treatments: fillTemplates({ obj: raw.treatments, templates }),
};

// Validate
const result = treatmentFileSchema.safeParse(expanded);

if (!result.success) {
  for (const issue of result.error.issues) {
    console.error(`${issue.path.join(".")}: ${issue.message}`);
  }
}
```

### Strict validation (recommended for editor / pre-deploy)

The schema's reference checker has a permissive fallthrough that silently passes a reference to a key produced *anywhere* in the file — including in another treatment or an uninvoked template. Per #321, that fallthrough is preserved on the schema for backward compatibility, but stricter consumers (editor tooling, pre-deploy checks) should layer on the following helpers that catch the bugs the fallthrough masks:

```typescript
import {
  treatmentFileSchema,
  fillTemplates,
  parseTreatmentYaml,
  resolveImportPath,
  resolveImports,
  collectPreHydrationIssues, // template-name resolution + circular invocations
  findUnreachableReferences, // cross-treatment leaks (runs on hydrated form)
  type ParsedFile,
} from "stagebook";
import { load as loadYaml } from "js-yaml";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";

const yamlPath = "study.stagebook.yaml";
const raw = loadYaml(readFileSync(yamlPath, "utf-8")) as ParsedFile;

// 1. Resolve `imports:` — load each imported file and merge its
//    `templates:` into one flat list. `importedTemplates` is the
//    post-merge list of just the *imported* template definitions.
const rootDir = dirname(yamlPath);
const loaded = new Map<string, ParsedFile>();
const queue = (raw.imports ?? []).map((p) =>
  resolveImportPath("root.stagebook.yaml", p),
);
while (queue.length > 0) {
  const importPath = queue.shift()!;
  if (loaded.has(importPath)) continue;
  const importedRaw = readFileSync(resolve(rootDir, importPath), "utf-8");
  const { parsed, imports } = parseTreatmentYaml(importedRaw);
  loaded.set(importPath, parsed as ParsedFile);
  for (const next of imports) {
    queue.push(resolveImportPath(importPath, next));
  }
}
const mergedTemplates = resolveImports({ main: raw, files: loaded });
const rootCount = (raw.templates ?? []).length;
const importedTemplates = mergedTemplates.slice(rootCount);

// 2. Pre-hydration semantic — catches "Template 'foo' is not defined"
//    and "Templates form an invocation cycle" before hydration would
//    throw a generic error.
const preHydration = collectPreHydrationIssues({
  root: raw,
  importedTemplates,
});

// 3. Hydrate.
const { result: expanded } = fillTemplates({
  obj: raw,
  templates: mergedTemplates,
  allowUnresolved: true,
});

// 4. Schema validation (existing behavior).
const schemaResult = treatmentFileSchema.safeParse(expanded);

// 5. Strict per-treatment reachable-keys check — catches references
//    that resolve to a key produced in another treatment, an uninvoked
//    template, or otherwise unreachable from the consuming treatment.
//    These are silent passes in the schema by design; the strict
//    check surfaces them.
const unreachable = findUnreachableReferences(expanded, {
  templates: mergedTemplates,
});
```

If your file doesn't use `imports:`, the resolve step is a no-op (`importedTemplates = []` and `mergedTemplates = raw.templates ?? []`). The example above runs end-to-end for either case.

The VS Code extension runs this exact pipeline plus a [diff orchestrator](https://github.com/deliberation-lab/stagebook/issues/321) that distinguishes "real bug in both source and hydrated form" from "templating artifact that disappears after expansion." If your tooling needs the same fine-grained diagnostic routing (e.g., to display templating artifacts as warnings instead of errors), use `runValidationDiff` from `stagebook`:

```typescript
import { runValidationDiff } from "stagebook";

const sourceText = readFileSync(yamlPath, "utf-8");
const diff = runValidationDiff({
  source: sourceText,
  importedTemplates, // computed above
});
// diff.matched          — real bugs in both passes
// diff.sourceOnly       — likely templating artifacts (display as warning)
// diff.hydratedOnly     — revealed by expansion (display in expanded view)
// diff.unreachableReferences — strict reachable-keys check, same as above
```

For build-time and pre-deploy checks the simpler "schema + pre-hydration + unreachable" sequence is usually enough — the diff orchestrator pays for two schema runs to enable the artifact/real-bug distinction, which only matters when you're surfacing diagnostics live to an author.

## Validating Prompt Files

```typescript
import { promptFileSchema } from "stagebook";

const markdown = readFileSync("prompts/question.prompt.md", "utf-8");
const result = promptFileSchema.safeParse(markdown);

if (result.success) {
  const { metadata, body, responseItems } = result.data;
  // metadata: parsed YAML frontmatter
  // body: markdown text
  // responseItems: response options (prefix-stripped)
} else {
  for (const issue of result.error.issues) {
    console.error(issue.message);
  }
}
```

## Treatment Hydration Pipeline

Before passing treatment data to Stagebook's rendering components, the platform must **hydrate** it — resolve any `imports:`, expand templates, validate, and resolve all placeholders. Stagebook components expect fully resolved data with no template contexts or `${field}` placeholders remaining.

```typescript
import {
  treatmentFileSchema,
  fillTemplates,
  parseTreatmentYaml,
  resolveImportPath,
  resolveImports,
} from "stagebook";

// 1. Parse the entry-point file. Stagebook bundles a safe YAML
//    parser; surface `imports:` separately so the host can load them.
const { parsed: root, imports: rootImports } =
  parseTreatmentYaml(rootYamlString);

// 2. Host-owned loading loop: read every (transitively) imported
//    file. The host owns sync vs async, error handling, and any
//    extra path canonicalization (symlinks, case folding); stagebook
//    owns syntactic path normalization via `resolveImportPath`.
const loaded = new Map();
const queue = rootImports.map((p) => resolveImportPath(rootPath, p));
while (queue.length > 0) {
  const path = queue.shift();
  if (loaded.has(path)) continue;          // dedup — prevents cycles
  const text = await loadFile(path);       // host's loader
  const { parsed, imports } = parseTreatmentYaml(text);
  loaded.set(path, parsed);
  queue.push(...imports.map((p) => resolveImportPath(path, p)));
}

// 3. Stagebook merges templates + path-rewrites file references in
//    imported templates so they resolve relative to the entry-point
//    file's directory. After this step imported templates are
//    indistinguishable from inline templates.
const mergedTemplates = resolveImports({ main: root, files: loaded });

// 4. Strip imports from root, attach merged templates, expand.
const { imports: _, ...rest } = root;
const merged = { ...rest, templates: mergedTemplates };
const hydrated = {
  ...merged,
  introSequences: fillTemplates({ obj: merged.introSequences, templates: mergedTemplates }),
  treatments: fillTemplates({ obj: merged.treatments, templates: mergedTemplates }),
};

// 5. Validate the expanded result.
const result = treatmentFileSchema.safeParse(hydrated);
if (!result.success) throw new Error(result.error.message);

// 6. Pass resolved stages to Stagebook components.
```

If your study doesn't use `imports:`, steps 2-3 are no-ops (`rootImports` is empty, `mergedTemplates` is just `root.templates`). The pipeline above accommodates both shapes.

**Hosts that prefer their own parser** (JSON, TOML, DB-backed) can skip `parseTreatmentYaml` and feed already-parsed objects to `resolveImports` directly — just extract the `imports:` array yourself before recursing.

**Important:** The `<Stage>` component and `<Element>` component expect **hydrated** data. If you pass a stage that still contains `{ template: "..." }` objects or `${field}` placeholders, rendering will fail. Always run `fillTemplates()` before passing data to components.

The hydration step also resolves broadcast expansion — a single template with `broadcast: { d0: [...], d1: [...] }` may produce multiple stages or elements via cartesian product. This happens during `fillTemplates()`, not during rendering.

## Implementing a StagebookProvider

To render Stagebook elements, your platform must implement the `StagebookContext` interface and wrap your component tree with `<StagebookProvider>`.

### The Interface

```typescript
import type { StagebookContext } from "stagebook/components";

const context: StagebookContext = {
  // Look up raw stored values by storage key.
  // Returns an array of values — exactly what was passed to save().
  // "scope" controls whose data to return: "player", "shared", "all", "any", or index.
  // Stagebook handles DSL reference parsing internally — platforms don't need to.
  get(key: string, scope?: string): unknown[] {
    // Look up `key` in your state store for the given scope.
  },

  // Write participant data under a DSL-derived key.
  save(key: string, value: unknown, scope?: "player" | "shared"): void {
    // scope "player" = individual state, "shared" = group-visible state
  },

  // Seconds elapsed since the current step started.
  getElapsedTime(): number {
    // Game stages: use your synchronized server timer
    // Intro/exit steps: use Date.now() relative to step start
  },

  // Advance to the next step.
  submit(): void {
    // Intro/exit: call your next() function
    // Game stages: signal readiness, wait for all participants
  },

  // Resolve an asset path to a renderable URL.
  // Paths in treatment files are relative to the treatment file's location.
  // The platform resolves them to actual URLs based on where assets are stored.
  getAssetURL(path: string): string {
    // CDN: resolve relative to treatment file dir, prepend CDN base URL
    // Local dev: resolve relative to treatment file, return local server URL
    // VS Code: resolve to webview URI
  },

  // Fetch text content by path (relative to treatment file).
  // Platform handles resolution, caching, retries, error handling.
  getTextContent(path: string): Promise<string> {
    // CDN: resolve and fetch from CDN
    // Local: resolve and read from filesystem
    // Test: return fixture string
  },

  // Identity and progress
  progressLabel: "game_0_discussion",  // unique step identifier
  playerId: "abc123",
  position: 0,                          // undefined in intro steps
  playerCount: 3,                       // undefined in intro steps
  isSubmitted: false,

  // Optional: platform-provided renderers for service-coupled elements
  renderDiscussion: (config) => <YourVideoComponent {...config} />,
  renderSharedNotepad: (config) => <YourNotepadComponent {...config} />,
};
```

### Wiring It Up

Stagebook provides a `Stage` component that handles all element layout, conditional rendering, and discussion placement. The platform just provides the context and the hydrated stage config:

```tsx
import { StagebookProvider, Stage } from "stagebook/components";
import type { StagebookContext } from "stagebook/components";

function GameStage({ stageConfig, onSubmit }) {
  const context = useYourPlatformContext(); // your platform's hooks

  const scoreContext: StagebookContext = {
    get: (key, scope) => yourLookup(key, scope, context),
    save: (key, val, scope) => yourSave(key, val, scope, context),
    getElapsedTime: () => context.timer.elapsed,
    submit: onSubmit,
    getAssetURL: (path) => `${context.cdnBase}/${path}`,
    getTextContent: (path) =>
      fetch(`${context.cdnBase}/${path}`).then((r) => r.text()),
    progressLabel: context.progressLabel,
    playerId: context.player.id,
    position: context.player.position,
    playerCount: context.playerCount,
    isSubmitted: context.player.isSubmitted,
    renderDiscussion: (config) => <YourVideoComponent {...config} />,
  };

  return (
    <StagebookProvider value={scoreContext}>
      <Stage stage={stageConfig} onSubmit={onSubmit} />
    </StagebookProvider>
  );
}
```

The `Stage` component handles:

- Laying out elements top-to-bottom with appropriate spacing and max-widths
- Two-column layout when a discussion is present (discussion left, elements right)
- Wrapping each element in time, position, and condition-based conditional rendering
- Showing a "waiting for others" message after submission

If you need lower-level control, you can use the `Element` component directly to render individual elements, or the pure element components (e.g., `Prompt`, `Display`) with manual prop wiring.

### The Three Phases

The same `StagebookContext` interface works across all three experiment phases. The platform adapts its implementation:

|                       | Intro (async, solo)       | Game (sync, group)    | Exit (async, solo)       |
| --------------------- | ------------------------- | --------------------- | ------------------------ |
| `position`            | `undefined`               | `0`, `1`, `2`, ...    | same as game             |
| `playerCount`         | `undefined`               | group size            | group size               |
| `get`                 | single-player values only | multi-player values   | multi-player values      |
| `save(..., "shared")` | not available             | writes to group state | writes to group state    |
| `getElapsedTime`      | client-side `Date.now()`  | server-synced timer   | client-side `Date.now()` |
| `submit`              | advance to next step      | signal readiness      | advance to next step     |

Components don't need to know which phase they're in.

## Host Platform Responsibilities

Stagebook draws a deliberate line between **measurement instruments** (its job) and **the page around them** (the host's job). Stage focuses on rendering elements consistently across platforms; everything about how `<Stage>` _sits in your page_ — the surrounding chrome, the scroll model, where assets and state actually live — belongs to the host. This section gathers those responsibilities in one place so the next consuming platform doesn't have to rediscover them.

The boundary table at the end of this section is the canonical summary; the subsections below explain the tricky cases.

### Page chrome

Stagebook does not render page-level chrome. The host is responsible for:

- **Headers, branded backgrounds, footers, navigation.** Render these around `<Stage>`, not inside.
- **In-page progress indicators** (step counters, "stage X of Y" bars). The host knows the global progression; Stage only knows the current step.
- **Layout context.** `<Stage>` doesn't assume anything about its parent's height or scroll model. The host picks: a fixed-height column with internal scroll, or a min-height page that scrolls naturally.

### Page scroll and bottom spacing

`<Stage>` accepts a `scrollMode` prop:

- **`scrollMode="internal"` (default).** Stage owns its own `overflow: auto` wrapper and renders a `<ScrollIndicator>` inside it. Convenient for hosts that want a fixed-height column with internal scroll out of the box.
- **`scrollMode="host"`.** Stage drops the internal scroll container, the bottom padding, and the indicator. Content flows naturally; the host decides what scrolls (the page, a `<main>` element, a custom shell) and is free to mount the publicly exported `useScrollAwareness` + `<ScrollIndicator>` against its own ref.

For most hosts, **`host` mode is the better default** — it lets the page flow naturally and integrates with whatever surrounding chrome you already have. Use `internal` only when you genuinely need Stage to be a fixed-height column.

In `host` mode, the host is also responsible for **bottom-of-stage breathing room**: a small spacer below the stage so participants get a visual cue they've reached the end. Without it, long stages end at a hard scroll-stop and participants have no signal there isn't more content. ~6–8rem is typical; size to your own footer / page chrome.

#### Recommended host setup (host mode)

```tsx
import { useRef } from "react";
import {
  Stage,
  StagebookProvider,
  ScrollIndicator,
  useScrollAwareness,
} from "stagebook/components";

function HostedStage({ stageConfig, context, onSubmit }) {
  // Whatever element scrolls in your layout — could be <main>, the
  // window (pass `null`/document.scrollingElement), or a custom shell.
  // Match `useScrollAwareness`'s `RefObject<HTMLElement | null>` param.
  const scrollRef = useRef<HTMLElement | null>(null);
  const { showIndicator } = useScrollAwareness(scrollRef);

  return (
    <main ref={scrollRef} style={{ overflow: "auto" }}>
      <StagebookProvider value={context}>
        <Stage stage={stageConfig} onSubmit={onSubmit} scrollMode="host" />
      </StagebookProvider>

      {/* Bottom-of-stage breathing room. ~6–8rem is typical; size to
          your own footer / page chrome. Without this, long stages end
          at a hard scroll-stop and participants have no signal they've
          reached the end. */}
      <div aria-hidden="true" style={{ height: "8rem" }} />

      {/* Sticky-bottom indicator that auto-shows when content grows
          off-screen and auto-dismisses when the user scrolls to bottom.
          Position-sticky inside the scroll container, no extra wiring. */}
      <ScrollIndicator visible={showIndicator} />
    </main>
  );
}
```

`scrollMode` defaults to `"internal"`, so existing integrations are unaffected. Migrate at your own pace: add a host-side scroll container + spacer + `<ScrollIndicator>`, then flip the prop.

### Resource resolution (`getAssetURL` and `getTextContent`)

All paths in treatment files are relative to the treatment file's location. Stagebook never resolves them itself — the host's `getAssetURL` and `getTextContent` are the only window into where resources actually live (CDN, local filesystem, VS Code workspace, bundled imports). Two important contract details:

- **`getAssetURL` is synchronous.** Stagebook calls it inline during render (e.g., to set `<img src=...>`, audio source URLs). The host must be able to return a renderable URL without `await` — pre-resolve any async work (signed URL generation, blob URL creation, workspace URI lookup) before mounting the provider, or memoize the resolution so subsequent calls are sync.
- **`getTextContent` is async.** Returns a `Promise<string>`. This is where prompt files, transcripts, and other text content are loaded; the host owns fetching, caching, retries, and error handling.

The asymmetry matters: a host that does async work inside `getAssetURL` (e.g., calling a signed-URL service mid-render) will produce visible flicker, broken images on first render, or React render-loop warnings. If your storage layer is async-only, hydrate a path-to-URL map ahead of provider mount.

See [platform-requirements.md §4 Content Delivery](./platform-requirements.md#4-content-delivery-required) for the full description of both methods.

### State persistence

Stagebook's `save` / `get` are the host's mailbox — Stagebook writes participant data to keys it derives from the treatment file, and reads them back for cross-element resolution and conditional rendering. The host decides what each store actually is:

- **What's local-only vs. server-synced.** Single-player tools may keep everything in React state; multiplayer platforms persist to a server-authoritative store and broadcast mutations to all connected clients.
- **What survives a reload.** State should survive page refreshes — if a participant disconnects and reconnects, their previous responses should still be present. For multiplayer experiments, other participants' state must also be available after reconnection.
- **What's player-scoped vs. shared.** For writes, `save(key, value, scope)` is limited to `"player"` or `"shared"`, and the host routes the write to the appropriate store. For reads, `get(key, scope)` accepts the same two plus `"all"` and a participant index as a string. See [platform-requirements.md §1 State Management](./platform-requirements.md#1-state-management-required) for the full scope semantics and storage-key patterns.

Stagebook handles DSL reference parsing internally — the host's `get(key, scope)` is a flat key-value lookup. The host doesn't need to understand reference syntax or nested-path traversal; it only needs to return whatever was last `save()`d under that key.

### What the host owns vs. what Stage owns

|                                                        | Host | Stage |
| ------------------------------------------------------ | ---- | ----- |
| The scroll container (`overflow`)                      | ✅   | —     |
| Bottom-of-stage breathing room                         | ✅   | —     |
| Page header / branded chrome / footers                 | ✅   | —     |
| In-page progress indicators (step counter, etc.)       | ✅   | —     |
| Layout context (fixed-height vs. min-height page)      | ✅   | —     |
| Asset URL resolution (`getAssetURL`, **synchronous**)  | ✅   | —     |
| Text content fetching (`getTextContent`, async)        | ✅   | —     |
| State store (`get` / `save`, scoping, persistence)     | ✅   | —     |
| Storage-key routing (player vs. shared vs. by index)   | ✅   | —     |
| Group formation and position assignment                | ✅   | —     |
| Stage timer and submission coordination                | ✅   | —     |
| Element rendering (prompts, separators, etc.)          | —    | ✅    |
| Per-element max-widths and spacing                     | —    | ✅    |
| Conditional rendering (time / position / conditions)   | —    | ✅    |
| DSL reference parsing and nested-path traversal        | —    | ✅    |
| Submission overlay ("waiting for others")              | —    | ✅    |
| Discussion two-column layout when `discussion:` is set | —    | ✅    |

For the deeper specs behind each row, see [platform-requirements.md](./platform-requirements.md).

## Using Standalone Components

Form components work without StagebookProvider. Use them anywhere in your app:

```tsx
import { Markdown, Button, Separator } from "stagebook/components";

function ConsentPage({ consentText, onAccept }) {
  return (
    <div>
      <Markdown text={consentText} resolveURL={(path) => `/assets/${path}`} />
      <Separator />
      <Button onClick={onAccept}>I Agree</Button>
    </div>
  );
}
```

Components that display images or reference external files accept an optional `resolveURL` prop for path resolution. Inside the experiment flow, the `Element` router passes `getAssetURL` from the provider automatically.

## Utilities Without React

Use schemas and utilities in Node.js, build tools, or server-side code — no React needed:

```typescript
import {
  treatmentFileSchema,
  promptFileSchema,
  compare,
  getReferenceKeyAndPath,
  fillTemplates,
} from "stagebook";

// Validate a treatment
treatmentFileSchema.safeParse(config);

// Evaluate a condition
compare(playerResponse, "isAtLeast", 0.75);

// Parse a reference string
const { referenceKey, path } = getReferenceKeyAndPath(
  "survey.TIPI.result.score",
);

// Expand templates
const expanded = fillTemplates({ obj: treatments, templates });
```

## Render Slots for Service-Coupled Elements

Some elements depend on external services or platform-specific libraries. Stagebook validates the config, manages layout and conditional rendering, and handles data storage — but your platform supplies the actual component via render props on the provider.

### Survey

> **Deprecated.** `type: survey` is pending removal once Stagebook's module-reuse pattern lands. The element still works (the host's `renderSurvey` slot is still called); the runtime emits a one-time `console.warn` per `surveyName` at parse time. New treatment files should prefer prompt-based patterns where the survey can be expressed as a sequence of prompt elements.

Surveys are rendered by the platform because they depend on a survey library (e.g., `@watts-lab/surveys`). Stagebook validates the element config, wraps the survey in conditional rendering, and handles data storage — but the platform provides the actual survey UI.

#### What the researcher writes

```yaml
elements:
  - type: survey
    surveyName: TIPI # which survey to render
    name: preTIPI # optional — overrides the storage key
  - type: submitButton
```

#### What Stagebook does

When Stagebook encounters a `type: "survey"` element, it:

1. Reads `surveyName` and `name` from the element config
2. Computes the storage key: `survey_${name ?? surveyName}` (e.g., `survey_preTIPI`)
3. Calls your `renderSurvey` function, passing `{ surveyName, onComplete }`
4. When `onComplete(results)` is called, Stagebook saves the results: `save("survey_preTIPI", results)`
5. The results are then available to other elements and conditions via the reference `survey.preTIPI.result.<key>` or `survey.preTIPI.responses.<questionId>`

#### What the platform implements

```typescript
import { getSurvey } from "@watts-lab/surveys";  // or your survey library

const context: StagebookContext = {
  // ...other fields...

  renderSurvey: ({ surveyName, onComplete }) => {
    const SurveyComponent = getSurvey(surveyName);
    return <SurveyComponent onComplete={onComplete} />;
  },
};
```

Your survey component must:

1. **Render** the survey questions and response controls
2. **Call `onComplete(results)`** when the participant finishes, passing the results object

That's it. Stagebook handles everything else: the storage key, making results available to `display` elements and `conditions`, and all the standard element wrapping (time gating, position visibility, conditional rendering).

#### The results object

The shape of `results` is determined by your survey library. Stagebook stores it opaquely — it doesn't inspect the contents. However, researchers will reference specific paths in conditions:

```yaml
conditions:
  - reference: survey.preTIPI.result.normAgreeableness
    comparator: isAtLeast
    value: 0.75
```

For this to work, the results object must have the structure that matches the reference path. If the reference is `survey.preTIPI.result.normAgreeableness`, then `results.result.normAgreeableness` must exist. This is a contract between the survey library and the treatment author — Stagebook just traverses the path.

#### Example: full data flow

1. Researcher writes `surveyName: TIPI, name: preTIPI` in treatment YAML
2. Participant completes the survey in the intro sequence
3. Survey component calls `onComplete({ result: { normAgreeableness: 0.82, ... }, responses: { ... } })`
4. Stagebook saves under key `survey_preTIPI`
5. Later, in a treatment's `groupComposition`, a condition references `survey.preTIPI.result.normAgreeableness`
6. Stagebook's `resolve("survey.preTIPI.result.normAgreeableness")` looks up `survey_preTIPI` in state, traverses `.result.normAgreeableness`, and returns `0.82`
7. The condition `isAtLeast: 0.75` evaluates to `true`, and the participant is assigned to the matching position

### Discussion

Video calls and text chat are tightly coupled to external services (Daily.co, Twilio, etc.). Stagebook handles the two-column layout, position-based visibility, and breakout room config, but the platform provides the actual communication component.

```typescript
const context: StagebookContext = {
  renderDiscussion: (config) => {
    if (config.chatType === "video") {
      return <DailyVideoCall {...config} />;
    }
    return <TextChat {...config} />;
  },
};
```

The `config` parameter is the full `discussion` object from the treatment YAML, including `chatType`, `showNickname`, `showTitle`, `rooms`, `layout`, etc. Your component receives all the configuration and implements the service integration.

### Shared Notepad

Collaborative text editors (e.g., Etherpad) are used by `shared: true` open-response prompts. (The standalone `sharedNotepad` element type was removed in #250.)

```typescript
const context: StagebookContext = {
  renderSharedNotepad: ({ padName }) => (
    <EtherpadEmbed padName={padName} />
  ),
};
```

### Progressive adoption

All render slots are optional. If a slot is not provided, the element renders nothing (no error). This lets you progressively add service integrations — start with prompts and submit buttons, add video calls later.
