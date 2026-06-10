# Platform Requirements

This document describes everything a platform must provide to run Stagebook experiments. Stagebook handles the experiment description language and participant-facing rendering. The platform handles everything else: state management, orchestration, group formation, content delivery, and service integrations.

Not every platform needs every capability. A VS Code preview tool only needs content delivery and mock state. A solo survey tool doesn't need group formation or video calls. The sections below are marked as **required**, **required for multiplayer**, or **optional** accordingly.

---

## 1. State Management (required)

Stagebook components read and write experiment state through the `get()` and `save()` methods on the StagebookProvider. The platform must implement a state store that supports these operations.

### State Scopes

The platform needs two scopes of state:

**Player state** — key-value pairs private to each participant. Used for individual prompt responses, survey results, submit button timing, tracked link events, and any other per-participant data.

**Shared state** — key-value pairs visible to all participants in the group. Used for shared prompts (where one participant's edits are visible to all) and discussion metrics.

### Key Patterns

Stagebook components write state under predictable keys:

| Key pattern           | Written by     | Value shape                                    |
| --------------------- | -------------- | ---------------------------------------------- |
| `prompt_<name>`       | Prompt element | `{ value, stageTimeElapsed, ...metadata }`     |
| `submitButton_<name>` | Submit button  | `{ time: elapsedSeconds }`                     |
| `survey_<name>`       | Survey element | Survey-specific response object                |
| `trackedLink_<name>`  | Tracked link   | `{ events: [...], totalTimeAwaySeconds, ... }` |

### Read Patterns

`get(key, scope)` must:

1. Look up the key in the appropriate state scope
2. Return an **array** of raw stored values (exactly what was passed to `save()`)

Stagebook handles DSL reference parsing and nested path extraction internally — the platform does not need to import `getReferenceKeyAndPath()` or understand the reference syntax. The platform's `get()` is a flat key-value lookup.

The `scope` parameter determines whose state to read:

| Scope                    | Behavior                                       |
| ------------------------ | ---------------------------------------------- |
| `"player"` or omitted    | Current participant's player state             |
| `"shared"`               | Shared/game state                              |
| `"0"`, `"1"`, `"2"`, ... | Specific participant by slot index (as string) |
| `"all"`                  | Array with one value per participant           |

After #238, stagebook only sends those four scopes. `"all"` is still reachable through `display.position: "all"` and `trackedLink` / `qualtrics` `urlParams[].position: "all"` — these uses of position weren't narrowed by #238 (only condition leaves were). Stagebook normalizes `display.position: "any"` to `"all"` before calling `get()` (the storage shape is the same — host returns one value per participant; whether "any value satisfies" is decided at the consumer). The pre-#238 aggregator value `"percentAgreement"` was removed entirely and is unreachable from a validated treatment.

### Reactivity

State changes must trigger React re-renders. When participant A writes a value, participant B's components that read that value should update. The mechanism varies by platform:

- **WebSocket-based**: Server broadcasts mutations to all connected clients (Empirica model)
- **Polling**: Client periodically fetches latest state
- **Firebase/Supabase**: Real-time database subscriptions
- **Local-only**: React state (for preview/testing tools)

### Persistence

State must survive page refreshes. If a participant disconnects and reconnects, their previous responses should still be present. For multiplayer experiments, other participants' state must also be available after reconnection.

### Platform-Populated State

Some reference namespaces require the platform to collect and store data that Stagebook components don't produce. If your treatment files use conditions or displays referencing these namespaces, the platform must populate them in player state during onboarding:

**`attributes.*`** — everything the participant arrives with, stored under a single key `attributes` as one flat nested object (#473). The platform populates it during consent/onboarding and keeps it current (values may change mid-study, e.g. screen width on resize). Internally, Stagebook's `resolve("self.attributes.country")` calls `get("attributes")` and traverses `.country`.

This single bag replaces the former `connectionInfo`, `browserInfo`, and `participantInfo` keys. References to those legacy sources are now rejected by validation — migrate them to `attributes.*`.

Identity fields (special):

- **`attributes.stableParticipantId`** — anonymized, stable across sessions, the release-safe id used to link the participant's exported data. **Required for studies that use it.** Stagebook never blocks on it and does not check it eagerly at mount (most studies never touch it). It's checked lazily at the one place stagebook consumes it — the Qualtrics `stableParticipantId` URL-param injection (the survey's participant-linkage field; replaces the legacy `deliberationId` param) — where a missing id would silently orphan the survey response; there it surfaces the violation loudly (`console.error` + the optional `onContractViolation` callback) and renders anyway. Enforce presence upstream: a host CI integration test (assert `hasStableParticipantId(get("attributes","player")[0])`), a batch-start preflight, and a readiness gate that doesn't mount Stagebook until identity is available. (Do **not** put the recruitment-platform id here — keeping recruitment PII out of the referenceable surface is the privacy guarantee.)
- `attributes.sampleId` — the per-assignment data-row id. Optional; it does not exist until the game phase (assigned at game-stage start), so it's absent during intro/groupComposition, and validation flags pre-game reads.

Onboarding / connection / browser fields (all optional):

- `attributes.name` — nickname entered during onboarding
- `attributes.country` — ISO country code (e.g., from IP geolocation)
- `attributes.timezone` — IP-based timezone
- `attributes.isKnownVpn` — whether the IP is on a known VPN list
- `attributes.screenWidth`, `attributes.screenHeight` — screen resolution
- `attributes.language` — browser language (e.g., `en-US`)
- `attributes.userAgent` — raw user-agent string

Example stored object: `{ stableParticipantId: "d3f1…", name: "alice", country: "US", screenWidth: 1280 }`. The bag is open — the platform may add further fields a treatment references; the exported `attributesSchema` (zod) is the authoritative shape.

If a field is not populated, references to it resolve to `undefined` and conditions return "can't determine yet" (not a hard failure) — this is true for every `attributes` field, including `stableParticipantId` when a study doesn't use it. The only loud signal is at the Qualtrics use site described above.

**Privacy boundary — `entryUrl.params`.** Keeping recruitment PII out of the referenceable surface is the reason `attributes` deliberately omits the recruitment-platform id. That guarantee covers `attributes` only — `entryUrl.params.<key>` still exposes whatever the host put in the participant's landing URL (e.g. a Prolific PID), and a treatment can route any such value into an outgoing Qualtrics/`trackedLink` `urlParams`. So a host that wants the guarantee to hold end-to-end must not place participant PII in the entry URL (and reviewers should watch for treatments that forward `entryUrl.params.*` PII into external links). Stagebook can't enforce this — it's a host responsibility.

### Browser Compatibility

Stagebook components are tested against modern browsers. The platform should verify browser compatibility during onboarding, before loading the experiment. Minimum supported versions:

- Chrome >= 89
- Edge >= 89
- Firefox >= 89
- Safari >= 15
- Opera >= 75

Mobile devices are not supported for interactive experiments with video/audio. The platform should detect and block mobile browsers during onboarding.

### Callback Stability (recommended)

The methods the platform provides on `StagebookContext` — `get`, `save`, `getTextContent`, `getAssetURL`, `getElapsedTime`, `submit`, and the optional `render*` slots — are safest when their identities are stable across renders.

Stagebook internally protects against unstable callback identities (it stores these references in refs so effects and event listeners aren't torn down and re-registered each render). But stable callbacks still help in a few ways:

- Prompt components that read state via `get()` re-run resolution whenever the context identity changes. A stable context object (same `get` identity across renders) lets React skip work.
- Platform-side React devtools and profiling are easier to read when the context value isn't churning.
- If a future Stagebook component is written without the defensive ref pattern, stable callbacks are what keeps it correct.

The simplest way to get stable references is to wrap each method in `useCallback` (or define it outside the render, or on a class) and memoize the final context object with `useMemo`:

```tsx
const save = useCallback(
  (key, value, scope) => {
    /* ... */
  },
  [
    /* store deps */
  ],
);
const get = useCallback(
  (key, scope) => {
    /* ... */
  },
  [
    /* store deps */
  ],
);
const getTextContent = useCallback((path) => fetch(resolve(path)), []);

const ctx = useMemo<StagebookContext>(
  () => ({
    get,
    save,
    getTextContent,
    getAssetURL,
    getElapsedTime,
    submit,
    progressLabel,
    playerId,
    position,
    playerCount,
    isSubmitted,
  }),
  [get, save, getTextContent /* ... */],
);

return <StagebookProvider value={ctx}>{children}</StagebookProvider>;
```

This is a recommendation, not a hard requirement — Stagebook will behave correctly either way.

---

## 2. Stage Orchestration (required)

The platform manages the progression through intro steps, game stages, and exit steps.

### Intro Steps (asynchronous, solo)

Each intro step displays its elements and waits for the participant to click a submit button (or complete a Qualtrics survey, or finish a video). There is no timer — participants proceed at their own pace.

The platform must:

- Track which intro step the participant is currently on
- Provide a `submit()` function that advances to the next step
- Track the start time of each step (for `getElapsedTime()` — use `Date.now()`)
- Set `progressLabel` to a unique identifier (e.g., `"intro_0_consent"`)

### `progressLabel` Uniqueness (required)

`progressLabel` must be **unique across every step of the experiment** (intro steps, every game stage, exit steps). Two distinct responsibilities rely on it:

1. **Saved-record metadata.** Stagebook stamps `step: progressLabel` onto every value written via `save()`, so downstream analysis can attribute a response to the step where it was produced.
2. **Auto-generated storage keys.** When a `prompt` element has no explicit `name`, Stagebook derives a storage key of the form `prompt_<progressLabel>_<file-metadata-name>`. Two steps sharing the same `progressLabel` will therefore derive the same storage key for a given prompt file — the second participant response silently overwrites the first with no error surfaced to the participant.

Recommended schemes:

- `"intro_<index>_<slug>"` for intro steps
- `"game_<stageIndex>_<slug>"` for game stages
- `"exit_<index>_<slug>"` for exit steps

Collisions are difficult to detect after the fact because the saved-record metadata also gets overwritten, so treat `progressLabel` uniqueness as a hard invariant in the platform.

### Game Stages (synchronous, group)

All participants in a group move through game stages together. Each stage has a `duration` in seconds.

The platform must:

- **Start a server-authoritative timer** when the stage begins
- **Auto-advance** when the timer expires, regardless of submission status
- **Track submissions**: when a participant calls `submit()`, record their readiness
- **Advance early** if all participants have submitted before the timer expires
- **Provide synchronized elapsed time** via `getElapsedTime()` — all participants should see approximately the same elapsed time (within ~1 second)
- After a participant submits, set `isSubmitted = true` so Stagebook shows a waiting message

**Timer synchronization** is critical for multiplayer. The server must be the authority on when stages start and end. Client-side display of elapsed time can use a local clock corrected for server offset:

```
serverOffset = serverTime - clientTime  (computed once at connection)
correctedElapsed = (Date.now() + serverOffset) - stageStartTime
```

### Exit Steps (asynchronous, solo)

Same as intro steps, but occur after the game. Participants proceed at their own pace. The platform may have access to multiplayer state (for showing what other participants wrote).

### Phase Transitions

The platform controls the transition between phases:

1. Participant completes all intro steps → enters lobby/waiting room
2. Group is formed → game begins (stage 0)
3. Game completes all stages → exit sequence begins
4. Participant completes exit steps → study complete

### Handling Disconnection

When a participant disconnects during a game stage:

- The timer continues (stages don't pause)
- On reconnection, the participant resumes at the current stage with the correct elapsed time
- If a video element was playing, it should resume at the correct position

### Stage-level Conditions (#183)

Treatment files may declare `conditions` on a stage, intro step, or exit step. When any condition evaluates to false, stagebook asks the host to advance the stage via two optional context fields:

- **`advanceStage?(): void`** — called when stagebook decides the stage should end (either at mount for skip-at-load, or mid-stage for early termination).
- **`stageId?: string`** — opaque per-stage identifier. Stagebook uses it to reset its internal advance latch cleanly when the stage changes, so hosts that reuse the provider across stages don't need to key-remount.

Both are optional. If `advanceStage` is missing, stagebook falls back to `submit()` and logs a one-time dev-mode warning.

#### Single-participant hosts

`advanceStage` is a thin wrapper over whatever you do for submit:

```ts
advanceStage: () => submit(),
```

`stageId` can be omitted — stagebook uses the conditions array identity as a fallback key.

#### Multi-participant hosts

Two responsibilities that only the host can handle:

1. **Submit for every player, not just self.** A dropout whose client never fires the advance call would otherwise hang the stage until the duration timer expires. Recommended:

   ```ts
   advanceStage: () => {
     const target = currentStageId;
     players.forEach((p) => {
       if (p.stage?.id === target && !p.stage.get("submit")) {
         p.stage.set("submit", true);
       }
     });
   };
   ```

2. **Ensure condition data is hydrated consistently across clients before the provider mounts.** Stagebook evaluates conditions from `context.get()` results; if client A sees the data and client B doesn't, they'll make different advance decisions. Hosts with staged-attribute stores (e.g., Tajriba) should gate the `<StagebookProvider>` mount on full hydration and show a host-level loading UI during transitions.

#### What stagebook handles vs. what the host handles

|                                                   | Stagebook | Host |
| ------------------------------------------------- | --------- | ---- |
| Evaluating conditions                             | ✅        |      |
| Latching so `advanceStage` fires once per stage   | ✅        |      |
| Submitting for every player                       |           | ✅   |
| Cross-client stage-ID coordination during advance |           | ✅   |
| Force-submit for disconnected players             |           | ✅   |
| Hydration sentinel / atomic store snapshot        |           | ✅   |

---

## 3. Group Formation (required for multiplayer)

The platform must assign participants to groups (treatments) and positions within those groups.

### Inputs

From the treatment file:

- `treatments[].playerCount` — how many participants per group
- `treatments[].groupComposition[].conditions` — eligibility criteria for each position (optional)

From the batch configuration (platform-specific):

- Which treatments to run
- Payoff weights (for optimizing assignment across treatments)

### The Assignment Problem

Given a pool of waiting participants who have completed intro steps, the platform must:

1. **Check eligibility**: For each treatment and position, determine which participants satisfy the conditions. Conditions reference data collected during intro (survey results, URL parameters, etc.).

2. **Form valid groups**: A valid group has exactly `playerCount` participants, one per position, each satisfying that position's conditions.

3. **Optimize**: If there are multiple valid assignments, prefer the one that maximizes some objective (e.g., balanced treatment assignment, payoff optimization).

4. **Handle failures**: If no valid group can be formed (insufficient eligible participants), participants wait. If a timeout is reached, they exit with an appropriate code.

### Lobby/Waiting

Between intro completion and game start, participants wait in a lobby. The platform should:

- Show a waiting indicator
- Periodically run the assignment algorithm as new participants complete intro
- Debounce the algorithm (don't run on every arrival — wait a few seconds for the cohort to stabilize)

### Position Assignment

Once a group is formed, each participant is assigned a position (0, 1, 2, ...). This position is:

- Stored in player state (`position`)
- Available via `StagebookContext.position`
- Used by `showToPositions`, `hideFromPositions`, and `groupComposition` throughout the game
- Immutable for the duration of the treatment

---

## 4. Content Delivery (required)

Stagebook components load prompt markdown files, images, and audio by path. **All paths in treatment files are relative to the treatment file's location.** The platform must resolve these paths and implement `getAssetURL(path)` and `getTextContent(path)` on the StagebookProvider.

For example, given this file structure:

```
my-study/
  study.stagebook.yaml
  consent.prompt.md
  prompts/
    question.prompt.md
  images/
    diagram.png
```

The treatment file references `file: consent.prompt.md`, `file: prompts/question.prompt.md`, `file: images/diagram.png`. The platform resolves these relative to `my-study/`.

### `getAssetURL(path: string): string`

Returns a URL that the browser can use to display an image, play audio, or embed a video. The platform resolves the path relative to the treatment file location:

- **CDN**: Resolve relative to treatment file dir, prepend CDN base URL
- **Local development**: Resolve relative to treatment file, return local server URL
- **VS Code extension**: Resolve to webview URI
- **Bundled**: Return an import path or data URI

**Synchronous contract.** Stagebook calls `getAssetURL` inline during render (e.g., to set `<img src=...>` or an audio source). The platform must return a renderable URL without `await`. If your storage layer is async-only (signed URLs, blob URL creation, async workspace URI lookup), pre-resolve a path-to-URL map before mounting `<StagebookProvider>`, or memoize the resolution so subsequent calls are sync. Doing async work inside the callback produces visible flicker, broken images on first render, or React render-loop warnings.

### `getTextContent(path: string): Promise<string>`

Returns the text content of a file (typically prompt markdown). The platform handles:

- **Resolution**: Resolve path relative to treatment file location
- **Fetching**: HTTP request, filesystem read, or bundled import
- **Caching**: Prompt files don't change during a study — cache aggressively
- **Retries**: Network requests may fail transiently
- **Error handling**: Return a rejected promise with a descriptive error

---

## 5. Pre-Game Infrastructure (recommended)

These features are not required by Stagebook's rendering layer but are necessary for running real experiments.

### Platform Consent

Before any experiment interaction, participants must provide informed consent. The platform should:

- Display an IRB-approved consent form appropriate to the participant's jurisdiction
- Record consent with a timestamp
- Allow the researcher to specify custom consent addenda
- Exit participants who decline

### Equipment Checks

For studies involving video or audio:

- Request camera/microphone permissions
- Verify video quality (sufficient resolution, frame rate)
- Verify audio input (microphone produces signal) and output (speakers/headphones work)
- Optionally detect headphone use
- Exit participants who fail required checks with an appropriate message

### Browser Compatibility

Check that the participant's browser meets minimum requirements. Stagebook's `BrowserConditionalRender` component can block unsupported browsers, but the platform may want to check earlier (before loading the full experiment).

### Participant Identity

Collect or verify a participant identifier:

- Self-reported nickname (for display during discussions)
- Platform-assigned ID (from URL parameters, e.g., `PROLIFIC_PID`)
- Custom ID instructions (platform-specific onboarding)

---

## 6. Service Integrations (optional)

Stagebook uses render slots for elements tightly coupled to external services. The platform provides the actual implementation via the StagebookProvider.

### Video Calls

Required for `discussion` elements with `chatType: "video"` or `"audio"`.

The platform must:

- Create a call room when a discussion stage starts
- Connect all participants in the group (or subsets, for breakout rooms)
- Handle custom layouts (grid-based feed placement per position)
- Support muting controls (audio/video toggles)
- Track speaking time (for talk meter)
- Handle disconnection/reconnection (participant rejoins the same room)
- Optionally record the call

**Services used in deliberation-empirica**: Daily.co

Provide via: `renderDiscussion(config)` on StagebookProvider.

### Text Chat

Required for `discussion` elements with `chatType: "text"`.

The platform must:

- Provide a real-time message feed visible to all group participants
- Support emoji reactions (configurable set)
- Display sender nicknames or positions
- Persist messages for the stage duration

Provide via: `renderDiscussion(config)` on StagebookProvider (same slot as video — dispatch on `config.chatType`).

### Shared Notepad

Required for `shared: true` open-response prompts. (The standalone `sharedNotepad` element type was removed in #250 — shared prompts are the single path now.)

The platform must:

- Provide a collaborative text editor
- Sync edits in real-time across all participants
- Support default text initialization
- Persist content for the stage duration

**Services used in deliberation-empirica**: Etherpad

Provide via: `renderSharedNotepad(config)` on StagebookProvider.

---

## 7. Data Export (recommended)

Stagebook does not define a data export format, but experiments need to produce analyzable data. The platform should export:

### Per-Participant Science Data

All state written by Stagebook components during the experiment:

- Prompt responses (with timestamps and metadata)
- Survey results
- Submit button timing
- Tracked link events
- Discussion metrics

Plus platform-collected data:

- Consent records
- Equipment check results
- Connection history (online/offline events)
- Browser and network metadata

### Per-Group Data

- Treatment assigned (the full object, for reproducibility)
- Position assignments
- Stage timing (actual start/end times)
- Chat transcripts
- Video recordings (if applicable)

### Per-Batch Rollup

- Total participants at each stage (arrived, completed intro, entered game, completed)
- Treatment assignment distribution
- Timing statistics (median intro duration, game duration, etc.)
- Demographic breakdown (country, language, browser)

### Export Format

JSONL (newline-delimited JSON) is recommended for streaming compatibility. Each participant produces one JSON object containing all their data. Include timestamps as ISO 8601 strings.

---

## 8. Pre-Registration (optional)

For pre-registered studies, the platform should:

- Snapshot the treatment configuration at game start (before any participant interaction)
- Include a hash of the treatment for integrity verification
- Push to a pre-registration repository before the experiment begins
- Separate pre-registration data from science data (different repos or directories)

---

## Platform Complexity by Use Case

| Feature             | Solo survey tool | VS Code preview | Full multiplayer platform  |
| ------------------- | ---------------- | --------------- | -------------------------- |
| State management    | React state      | Mock state      | Distributed reactive store |
| Stage orchestration | Step sequencing  | Step sequencing | Timer + sync + submission  |
| Group formation     | N/A              | N/A             | Constraint satisfaction    |
| Content delivery    | Local files      | Workspace files | CDN                        |
| Consent             | Optional         | N/A             | Required                   |
| Equipment checks    | N/A              | N/A             | Required for video         |
| Video calls         | N/A              | N/A             | Required                   |
| Text chat           | N/A              | N/A             | Required                   |
| Data export         | Simple JSON      | N/A             | JSONL + GitHub push        |
| Pre-registration    | N/A              | N/A             | Recommended                |

A minimal Stagebook integration (solo, no video, local content) requires only: React state for `get`/`save`, step sequencing for `submit`, `Date.now()` for `getElapsedTime`, and local file reading for `getTextContent`. Everything else is additive.
