# StagebookProvider: Architecture

Stagebook display components need to do four things: read experiment state, write participant responses, track time within a step, and load content (prompt markdown, images, audio) from wherever the platform stores it. The StagebookProvider abstracts all of these behind a single context that any platform can implement.

## The interface

```typescript
interface StagebookContext {
  // Look up raw stored values by storage key.
  // scope: "player" (default), "shared", "all" (one value per
  // participant), or a numeric string for a specific slot index.
  // Stagebook normalizes display.position: "any" to "all" before
  // calling get() — both have the same storage shape. The pre-#238
  // aggregator value "percentAgreement" was removed entirely and is
  // unreachable.
  get(key: string, scope?: string): unknown[];

  // Write state under a DSL-derived key
  save(key: string, value: unknown, scope?: "player" | "shared"): void;

  // Seconds since current step started
  getElapsedTime(): number;

  // Advance to next step
  submit(): void;

  // Content resolution — platform handles fetching, caching, retries
  getAssetURL(path: string): string;
  getTextContent(path: string): Promise<string>;

  // Idle state — signal when participant is expected to be away
  setAllowIdle?: (allow: boolean) => void;

  // Identity and progress
  progressLabel: string;
  playerId: string;
  position: number | undefined;
  playerCount: number | undefined;
  isSubmitted: boolean;

  // Platform-provided renderers for service-coupled elements
  renderDiscussion?: (config: DiscussionType) => React.ReactNode;
  renderSharedNotepad?: (config: { padName: string }) => React.ReactNode;
  /** @deprecated pending removal once a module-reuse pattern lands */
  renderSurvey?: (config: {
    surveyName: string;
    onComplete: (results: unknown) => void;
  }) => React.ReactNode;
}
```

## Three-layer component architecture

Stagebook components are organized in three layers:

1. **Pure components** (form/) — `Button`, `Separator`, `RadioGroup`, `CheckboxGroup`, `TextArea`, `Slider`, `ListSorter`, `Markdown`, `Loading`. These take props and render UI. No StagebookProvider needed. Usable anywhere in the app (consent screens, debrief, etc.).

2. **Element components** (elements/) — `Prompt`, `Display`, `SubmitButton`, `AudioElement`, `ImageElement`, `KitchenTimer`, `TrackedLink`, `TrainingVideo`, `Qualtrics`. These are pure prop-based components that render specific experiment elements. They receive data and callbacks as props, not from context.

3. **Stage renderer** — The `Stage` component reads from StagebookProvider, wraps each element in conditional rendering (time, position, conditions), handles layout (single column or two-column with discussion), and bridges context to element components via the `Element` router.

The platform provides the StagebookProvider context. Stagebook handles everything inside it.

## How reading works

Every element that reads experiment state does so through a **reference** — a DSL concept like `self.prompt.myQuestion`, `self.survey.bigFive.result.score`, or `self.entryUrl.params.condition`. The first segment is a position selector (`self`, `shared`, `all`, or a numeric slot index — required by #298). Internally, the `StagebookProvider` converts each reference (string-shorthand or structured form) into a flat storage key and navigated path (e.g., `self.prompt.myQuestion` → key `prompt_myQuestion`, path `["value"]`, position `"self"`), calls the platform's `get()` with the appropriate position, then extracts the requested path from each result. The result is always an array — typically a single-element array, but the contract returns an array so platforms can handle multi-value lookups uniformly. Components don't need to know the details — they call `resolve()` (via `useResolve`) and get extracted values back.

The platform's `get()` is a simple key-value lookup — it doesn't need to understand the DSL reference syntax or the internal record structure. It returns exactly what was passed to `save()`.

## How writing works

Every element that saves a participant response computes a storage key from the element type and name, and saves a record containing the response value plus metadata:

```jsx
save(
  `prompt_${name}`,
  { value: answer, stageTimeElapsed: getElapsedTime() },
  "player",
);
```

The `scope` parameter ("player" or "shared") handles the case where a prompt is shared across participants (saved to group state) vs individual (saved to player state). The platform decides what these scopes mean in its storage model.

## How timing works across phases

Components call `getElapsedTime()` and get seconds. They call `submit()` and the step advances. The platform's implementation varies by phase:

| Phase               | `getElapsedTime()`                  | `submit()`                     |
| ------------------- | ----------------------------------- | ------------------------------ |
| Intro (solo, async) | `Date.now()` relative to step start | Advance to next step           |
| Game (group, sync)  | Server-synchronized timer           | Signal readiness, wait for all |
| Exit (solo, async)  | `Date.now()` relative to step start | Advance to next step           |

Components don't need to know which phase they're in.

## How content resolution works

Components need images, audio, and prompt markdown files. The platform implements:

- **`getAssetURL(path)`** — returns a renderable `src` (CDN URL, local file path, webview URI, etc.)
- **`getTextContent(path)`** — returns file content as a string (platform handles fetching, caching, retries)

Stagebook provides `useTextContent(path)` — a hook that wraps `getTextContent` with React loading/error state.

## Render slots for service-coupled elements

Some elements depend on external services. Stagebook validates config, manages layout, and handles conditional rendering — but the platform supplies the actual component:

| Slot                  | When used                          | What the platform provides                           |
| --------------------- | ---------------------------------- | ---------------------------------------------------- |
| `renderDiscussion`    | Stage has `discussion` block       | Video call or text chat component                    |
| `renderSurvey`        | `type: "survey"` element (deprecated — pending removal once a module-reuse pattern lands) | Survey UI component that calls `onComplete(results)` |
| `renderSharedNotepad` | `shared: true` open-response prompt | Collaborative text editor                            |

All slots are optional. If not provided, the element renders nothing.

## Idle management

Some elements temporarily expect the participant to be away (watching a video, following an external link). Stagebook components call `setAllowIdle?.(true/false)` to signal this. The platform's idle detection system uses this signal to suppress inactivity warnings during expected away periods.

## CSS theming

Stagebook ships a default stylesheet (`stagebook/styles`) with CSS custom properties for all themeable values. Platforms override these on `:root`:

```css
:root {
  --stagebook-primary: #7c3aed; /* change blue to purple */
  --stagebook-danger: #b91c1c; /* darker red */
}
```

Component layout (padding, flex, positioning) uses inline styles and is not overridable — this ensures consistent experiment rendering. Only visual theming (colors, borders) is customizable.

### Opt-in host typography (`stagebook/host-typography`)

Stagebook components render correctly on any host without extra CSS, but the _host's_ own bare-tag pages (settings, permissions, attention checks, etc.) inherit whatever reset the host has (Tailwind preflight, no-preflight, normalize.css, nothing). That's how two apps using stagebook end up with noticeably different `<h1>` / `<img>` / `<a>` rendering on pages that don't use stagebook components.

`stagebook/host-typography` is an opt-in stylesheet that provides a small preflight-like baseline on **bare tags only**: a universal box-model reset of `box-sizing: border-box` and `border: 0 solid`, `img/video { max-width: 100% }`, a heading type scale, zero `margin-block` on `p/ul/ol/h*`, and `a` styled from `--stagebook-link`. No class selectors — nothing that targets stagebook's own components.

Import it alongside `stagebook/styles`:

```ts
import "stagebook/styles";
import "stagebook/host-typography";
```

Trade-offs: not compatible with Tailwind preflight (pick one), and the reset applies to third-party widgets the host renders too. Hosts that need to preserve third-party rendering should either not import this globally or scope it to their own UI tree via their own wrapper class.
