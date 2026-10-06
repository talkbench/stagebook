# Stagebook Syntax Reference

A concise, precise reference for the Stagebook experiment description language. For detailed explanations, see the individual guides: [Treatment Files](treatment-files.md), [Elements](elements.md), [Prompts](prompts.md), [Conditions](conditions.md), [Discussions](discussions.md), [Templates](templates.md).

## 1. Top-Level Structure

```yaml
stagebook: "0.33" # optional: quoted major.minor release the file was written for; selects upgrade warnings, never read at runtime
templates: # optional: array of template definitions
consent: # optional: array of consent arms — the host shows one, selected by name
introSequences: # required: array of intro sequence objects
treatments: # required: array of treatment objects
```

## 2. Primitives

- **Names**: 1-64 chars; `[a-zA-Z0-9 _-]` plus `${field}` placeholders.
- **Durations**: integer seconds, at least 5 — a shorter stage cannot be perceived or acted on, so the validator treats it as an authoring error (a typo or a milliseconds/seconds mix-up).
- **Positions**: zero-based nonnegative integers.
- **Visibility**: `showToPositions` / `hideFromPositions` — nonempty int arrays.
- **Time gates**: `displayTime` (nonnegative int), `hideTime` (positive int) — seconds into stage.

## 3. Templates

```yaml
templates:
  - name: <name>
    contentType: <element|stage|treatment|...>  # required
    content: <any structure>

# Usage:
- template: <name>
  fields: { key: value }       # ${key} substitution
  broadcast: { d0: [...] }     # cartesian expansion
```

Content types: `introSequence`, `introSequences`, `elements`, `element`, `stage`, `stages`, `treatment`, `treatments`, `reference`, `condition`, `conditions`, `player`, `groupComposition`, `introExitStep`, `introSteps`, `exitSteps`, `consentArm`, `consent`, `discussion`, `broadcastAxisValues`.

## 4. References

A reference identifies a value somewhere in the study state. Two forms (#240): the dotted-string sugar and the structured object form. Both are accepted at every reference site (conditions, `display.reference`, `trackedLink`/`qualtrics` `urlParams[].reference`); both parse to the same internal shape.

**Every reference begins with a position selector (#298).** The first segment is required and is one of:

- `self` — the current participant's value
- `shared` — group-shared state
- `everyone` — one value per participant seat, in numeric seat order, retaining missing answers
- A non-negative integer (`0`, `1`, `2`, …) — a specific slot index

Un-prefixed references like `prompt.topicVote` are rejected at parse time. The error message includes a migration hint suggesting `self.prompt.topicVote` for the common case.

**String shorthand (the common form):**

| Pattern                                 | Example                                |
| --------------------------------------- | -------------------------------------- |
| `<position>.prompt.<name>`              | `self.prompt.topicVote`                |
| `<position>.submitButton.<name>.<path>` | `self.submitButton.confirm.time`       |
| `<position>.qualtrics.<name>.<path>`    | `self.qualtrics.exit.sessionId`        |
| `<position>.trackedLink.<name>.<path>`  | `self.trackedLink.signup.events`       |
| `<position>.mediaPlayer.<name>.<path>`  | `self.mediaPlayer.intro.firstPlay`     |
| `<position>.timeline.<name>(.<path>)`   | `self.timeline.story.0.start`          |
| `<position>.discussion.<name>(.<path>)` | `shared.discussion.lobby.messageCount` |
| `<position>.entryUrl.params.<key>`      | `self.entryUrl.params.PROLIFIC_PID`    |
| `<position>.attributes.<field>`         | `self.attributes.stableParticipantId`  |

**Structured form** (#240 — preferred in new code):

```yaml
reference:
  position: self | shared | everyone | <nonnegative integer> # required
  source:
    prompt | submitButton | qualtrics | mediaPlayer | timeline | trackedLink |
    discussion | entryUrl | attributes
  name: <element name> # required for named sources, forbidden for external sources
  path: [<segments>...] # optional for named sources, required for external sources
```

For named sources, `prompt` references default to `path: [value]` when omitted (the participant's saved answer). Other named sources read the whole stored record by default. The structured form lets you override the implicit default — e.g. `path: [debugMessages]` to address other fields on a prompt's saved record.

For external sources, `path` is required. Additionally, `entryUrl` references must currently start the path with `params` (e.g. `path: [params, condition]` — equivalent to the dotted `self.entryUrl.params.condition`). The `entryUrl.*` namespace is reserved so future additions like `entryUrl.path` / `entryUrl.host` / `entryUrl.href` can land non-breakingly.

`attributes.*` is the host-supplied bag of participant metadata (#473), replacing the former `connectionInfo` / `browserInfo` / `participantInfo` sources — references to those are now rejected. Common fields: `stableParticipantId` (the anonymized id used to link exported data — always available), `sampleId` (the per-assignment data-row id — only from the game phase onward), `name`, `country`, `timezone`, `language`, `screenWidth`. The recruitment-platform id is intentionally not exposed here.

## 5. Conditions and Expressions

```yaml
conditions:
  - reference: <reference> # string or {position, source, name?, path?}
    comparator: <comparator>
    value: <literal value> # required except for exists/doesNotExist
```

A `conditions:` list is shorthand for `all:`. Alternatively supply a single Boolean expression. Omit the field for no gate; `conditions: []` and `conditions: null` are invalid. Numbers, strings, and lists are not truthy. A final Missing result has the same effect as false: hide an element, skip or advance a stage, or reject an assignment candidate.

**Comparators:** `exists`, `doesNotExist`, `equals`, `doesNotEqual`, `isAbove`, `isBelow`, `isAtLeast`, `isAtMost`, `hasLengthAtLeast`, `hasLengthAtMost`, `includes`, `doesNotInclude`, `matches`, `doesNotMatch`, `isOneOf`, `isNotOneOf`. The leaf's `value` is literal data, not an expression; null is forbidden, even inside a list. `exists` / `doesNotExist` forbid `value`.

**Reference positions:** `self`, `shared`, `everyone`, or a nonnegative integer seat, always inside the reference. There is no default `player` or separate condition-level `position`. Game-stage gates cannot use `self`; intro steps cannot use numeric seats or `everyone`; `groupComposition` conditions use only `self`.

### Missing and comparison rules

An expression yields a value or Missing. Missing includes absent/null data, blank prompt answers (`""`, whitespace only, `[]`), a numeric entry without a parsed value, a wrong runtime type, or a nonfinite calculation. Zero, false, literal empty strings, and literal empty lists are present. Stored data and `isValid` are unchanged.

A missing answer matches nothing, including another missing answer. Positive comparisons needing it are false; their negations are true. Missing is not true in `all`, `any`, `none`, `countTrue`, or `case.when`. Waiting must be explicit: `none` around “below 5” is true for an unanswered question, while “at least 5” is false. See [waiting and negation](conditions.md#waiting-is-explicit).

Equality and membership trim and lowercase strings: `equals`, `doesNotEqual`, `isOneOf`, `isNotOneOf`, `includes`, `doesNotInclude`, `allEqual`, `allUnique`, and `countUnique`. Internal whitespace is preserved. Regexes use raw strings; string lengths use raw UTF-16 code units (`🙂` is 2), and list lengths count positions.

Known types must agree, without number/string/Boolean conversion. Numeric-looking text remains text; see [Prompts that save numbers](conditions.md#prompts-that-save-numbers). Check types separately for each treatment and its compatible intro sequences. Unknown reference types are accepted with a reasoned warning and checked at runtime; encountered wrong types are reported and become Missing. Check every branch and reference, even when runtime evaluation can short-circuit.

### Expression forms and lists

An expression is a finite number, string, Boolean, null, `{literal: value}`, `{reference: reference}`, a comparator leaf, or an object with exactly one operator key. Dots in a string do not make it a reference. `literal` accepts a scalar or a flat scalar list; arbitrary objects and general nested lists are not supported. Null represents Missing, not the quoted string `"null"`.

An operator's bare list contains authored operand expressions, not list data. Use `literal: [red, blue]` for data. A runtime list expression supplies members directly to operators that accept it:

```yaml
average: { reference: everyone.prompt.rating } # Correct: one numeric-list expression.
# average: [{reference: everyone.prompt.rating}] is invalid: a list is not one number.
```

No implicit flattening occurs. Empty authored operand lists are invalid. Runtime lists retain missing members; insufficient runtime arity yields Missing, except counts return 0. Compatible list results are supported by `case` and `firstExisting`, and `allEqual` can compare lists by length, order, and corresponding values.

### Expression operators

The 28 operators below share the same rules wherever expressions are accepted. “Operands” means a nonempty authored list or a single expression; a single list expression supplies its members where indicated. Numeric chains and equality/distinctness need at least two inputs.

| Operator             | Input shape                                                               | Result                                                                        |
| -------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `all`                | Boolean operands or one Boolean-list expression                           | Every input is true; false or Missing defeats it                              |
| `any`                | Boolean operands or one Boolean-list expression                           | At least one input is true                                                    |
| `none`               | Boolean operands or one Boolean-list expression                           | No input is true; one input means negation                                    |
| `allEqual`           | 2+ compatible scalars, 2+ compatible lists, or one scalar-list expression | Every value agrees; Missing never agrees                                      |
| `allUnique`          | 2+ compatible scalars or one scalar-list expression                       | Every value is present and pairwise different                                 |
| `strictlyIncreasing` | 2+ numbers or one numeric-list expression                                 | Adjacent inputs satisfy `<` in written order                                  |
| `nonDecreasing`      | 2+ numbers or one numeric-list expression                                 | Adjacent inputs satisfy `<=`                                                  |
| `strictlyDecreasing` | 2+ numbers or one numeric-list expression                                 | Adjacent inputs satisfy `>`                                                   |
| `nonIncreasing`      | 2+ numbers or one numeric-list expression                                 | Adjacent inputs satisfy `>=`                                                  |
| `includes`           | `{container: expression, members: [expression, ...]}`                     | String/list contains every compatible scalar member                           |
| `matches`            | `{string: expression, patterns: [string, ...], flags?: string}`           | Every literal regex matches the raw string                                    |
| `length`             | One string/list expression                                                | UTF-16 code units or number of list positions                                 |
| `countExisting`      | Scalar operands or one scalar-list expression                             | Number of present values                                                      |
| `countTrue`          | Boolean operands or one Boolean-list expression                           | Number of true values                                                         |
| `countUnique`        | Compatible scalar operands or one scalar-list expression                  | Number of distinct present values                                             |
| `sum`                | Numeric operands or one numeric-list expression                           | Total; needs every input                                                      |
| `average`            | Numeric operands or one numeric-list expression                           | Arithmetic mean; needs every input                                            |
| `product`            | Numeric operands or one numeric-list expression                           | Product; needs every input, even with a zero factor                           |
| `min`                | Numeric operands or one numeric-list expression                           | Smallest input; needs every input                                             |
| `max`                | Numeric operands or one numeric-list expression                           | Largest input; needs every input                                              |
| `sumExisting`        | Numeric inputs, optionally `{inputs, atLeast}`                            | Total of present inputs                                                       |
| `averageExisting`    | Numeric inputs, optionally `{inputs, atLeast}`                            | Mean of present inputs, using their count                                     |
| `minExisting`        | Numeric inputs, optionally `{inputs, atLeast}`                            | Smallest present input                                                        |
| `maxExisting`        | Numeric inputs, optionally `{inputs, atLeast}`                            | Largest present input                                                         |
| `subtract`           | `{from: expression, value: expression}`                                   | Numeric `from - value`                                                        |
| `divide`             | `{numerator: expression, denominator: expression}`                        | Numeric quotient; literal zero divisor is invalid                             |
| `case`               | `{rules: [{when: expression, value: expression}, ...]}`                   | First true rule's result; optional final `{default: true, value: expression}` |
| `firstExisting`      | Nonempty list of compatible result expressions                            | First present result, preserving a selected list                              |

Strict calculations return Missing when a required input is missing, their runtime input list is empty, or their result is nonfinite. The four `…Existing` operators omit missing numeric inputs; `atLeast` is a positive integer, defaults to 1, and cannot exceed an authored input list's length. Below it the result is Missing. There is no `missing: skip`, `minValid`, or `productExisting`.

Counts never wait: they return 0 when nothing counts. A `countUnique` result of 1 does not establish that everyone answered. Use `allEqual` for agreement or guard a count explicitly. `firstExisting` provides a deliberate fallback, such as `firstExisting: [{sumExisting: {reference: everyone.prompt.points}}, 0]`.

A `case` treats a missing `when` as false, evaluates only the selected result, and does not fall through when that result is Missing. Without a selected rule or a default it is Missing. State every substantive band as a rule, including the lowest band; a default of `low` would also catch unanswered questions. See the [complete band example](conditions.md#state-every-band-in-a-case).

Regex `patterns` are a nonempty list of literal JavaScript regex strings without `/.../` delimiters. Optional flags allow only `i`, `s`, and `u`; use anchors for a whole-string check. The leaf `matches` / `doesNotMatch` spelling also accepts a literal `/pattern/flags` string. Patterns and flags are not expressions.

Each pattern is limited to 1,024 UTF-16 code units. Inputs longer than 4,096 UTF-16 code units return false for `matches` (true for `doesNotMatch`), without truncation. These caps do not guarantee a time limit; see [regex execution](../engineer/regex-execution.md).

### Group quantifiers

An `everyone.` reference returns one value per seat, with missing seats retained. A comparator on that reference instead produces one Boolean per seat; `all`, `any`, `none`, or `countTrue` must consume the leaf directly:

```yaml
conditions:
  all:
    reference: everyone.prompt.ready
    comparator: equals
    value: "Yes"
```

A bare group leaf at the condition root or inside an operand list is invalid. Wrap it before combining it with another test:

```yaml
conditions:
  any:
    - any:
        reference: everyone.prompt.help
        comparator: exists
    - reference: shared.submitButton.finish
      comparator: exists
```

Per-seat `includes` and `hasLength*` operate on each participant's answer, including list answers. They do not test the outer group list's length or membership. The old `all.` selector needs [comparator-specific migration](conditions.md#upgrading-group-conditions), because it considered only recorded answers.

## 6. Elements

All elements accept: `name?`, `notes?`, `displayTime?`, `hideTime?`, `showToPositions?`, `hideFromPositions?`, `conditions?`, `tags?`. (`file?` is per-type — only `prompt`, `audio`, `image`, `mediaPlayer` accept it; see #249.)

| Type           | Key Fields                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`       | `file` (required), `shared?`                                                                                                                                                                                                                   |
| `display`      | `reference` (required, including its position selector)                                                                                                                                                                                        |
| `submitButton` | `buttonText?` (default: "Next")                                                                                                                                                                                                                |
| `timer`        | `startTime?`, `endTime?`, `warnTimeRemaining?`                                                                                                                                                                                                 |
| `separator`    | `style?` (`thin`, `regular`, `thick`)                                                                                                                                                                                                          |
| `audio`        | `file` (required)                                                                                                                                                                                                                              |
| `image`        | `file` (required), `width?`                                                                                                                                                                                                                    |
| `mediaPlayer`  | `file` (required), `name`, `controls?`, `syncToStageTime?`, `submitOnComplete?`, `startAt?`, `stopAt?`, `stepDuration?`, `playVideo?`, `playAudio?`, `captionsFile?`, `allowScrubOutsideBounds?`                                               |
| `timeline`     | `source` (required, name of a sibling `mediaPlayer`), `name` (required), `selectionType` (required, `range` or `point`), `selectionScope?` (default `all`), `multiSelect?` (default `false`), `showWaveform?` (default `true`), `trackLabels?` |
| `qualtrics`    | `url` (required), `urlParams?`                                                                                                                                                                                                                 |
| `trackedLink`  | `name` (required), `url` (required), `displayText` (required), `helperText?`, `urlParams?`                                                                                                                                                     |

### Media hosting requirements

The `<video>` element rendered by `mediaPlayer` always sets `crossOrigin="anonymous"`. This is required for the Web Audio API to read the audio stream when a `timeline` element with `showWaveform: true` is attached — without it, the analyser is silently CORS-tainted and the waveform tracks render as flat lines.

**This means all media URLs must be served with proper CORS headers** (`Access-Control-Allow-Origin: *` or matching the experiment origin), regardless of whether you use the timeline. Same-origin media (e.g., served from the same host as the experiment) is unaffected.

If you see flat waveforms in the timeline despite audio playing, check the browser console — Stagebook logs a warning after 5 seconds of playback if the AnalyserNode is producing only silence:

```
[MediaPlayer] Waveform capture is producing all-zero data after 5s of playback...
```

## 7. Stages

```yaml
gameStages:
  - name: <name>
    duration: <seconds>
    discussion: <discussion object> # optional
    elements: [...] # required, nonempty
```

Time bounds on elements (`displayTime`, `hideTime`, `startTime`, `endTime`) must not exceed stage `duration`.

## 8. Discussions

```yaml
discussion:
  chatType: text | audio | video
  showNickname: true
  showTitle: false
  # text-only: reactionEmojisAvailable?, reactToSelf?, numReactionsPerMessage?
  # video-only: showSelfView?, showReportMissing?, showAudioMute?, showVideoMute?
  # video-only: rooms? or layout?
  showToPositions: [0, 1] # optional
  hideFromPositions: [2] # optional
  conditions: [...] # optional
```

## 9. Intro/Exit/Consent Steps

```yaml
introSequences:
  - name: <name>
    introSteps:
      - name: <name>
        elements: [...] # no duration, no position-based visibility

treatments:
  - name: <name>
    exitSequence:
      - name: <name>
        elements: [...] # no shared prompts
```

Intro steps disallow shared prompts and position-based element visibility (`showToPositions` / `hideFromPositions`); their references still require `self` or `shared` selectors, and cannot use numeric seats or `everyone`. Exit steps also disallow shared prompts.

### Consent (#481)

```yaml
consent: # top-level; sibling of introSequences/treatments
  - name: <name> # unique within consent: only — the host selects an arm by name
    locale: <locale> # optional — arms declare their OWN locale (pre-assignment)
    steps:
      - name: <name>
        elements: [...] # intro-step constraints apply
```

Consent steps take the intro-step constraints (advancement element required, no shared prompts or position-based visibility; references use `self` or `shared`). Consent keys are **audit-only**: referencing one from intro/game/exit/`groupComposition` is an error; within-arm references (the gated-submit pattern) are legal; consent steps can't reference later-phase data. Collision-checked against every intro sequence and treatment; arm × arm key reuse is legal. For checkbox acknowledgement gates, `[]` is a missing prompt answer and fails `exists`; use `includes` for each specific acknowledgement required, since `exists` alone allows any nonempty selection.

### Debrief (#481)

Debrief content is authored as the trailing steps of `exitSequence` — there is no separate `debrief:` field. The host renders the exit sequence before the completion code, so the trailing exit steps are the debrief and the code stays gated behind them. They are ordinary exit steps (exit-step constraints apply) and may reference any earlier phase except consent (audit-only).

## 10. Treatments

```yaml
treatments:
  - name: <name>
    playerCount: <integer>
    compatibleIntroSequences: [<names>] # required; [] = runs without an intro sequence
    groupComposition: # optional
      - position: 0
        title: "Role A"
        conditions: [...]
    gameStages: [...] # required, nonempty
    exitSequence: [...] # optional; trailing steps are the debrief (#481)
```

Position indices in `showToPositions`, `hideFromPositions`, `groupComposition`, and discussion `rooms` must be < `playerCount`.

`compatibleIntroSequences` (#499) names the intro sequences the treatment may follow; names resolve against the top-level `introSequences:` collection. Dangling names error; duplicates warn; every game/exit/`groupComposition` reference to intro-provided data must resolve in **every** listed sequence. `${field}` placeholders allowed, whole-field or per-item (like `groupComposition`).

## 11. Prompt Files

`stagebook?: "major.minor"` (quoted) is accepted on every prompt type, as in treatment files: it selects which upgrade warnings apply, and the runtime never reads it.

`required?: boolean` (default `false`) is accepted on `multipleChoice`,
`dropdown`, `openResponse`, and `numericResponse`. Required dropdowns must set `placeholder`.
`listSorter`, `noResponse`, and currently `slider` reject `required` (#689).
`openResponse` also accepts `minLength?: integer >= 0` and
`maxLength?: integer >= 1`, counted in UTF-16 code units.

Player-scoped saves include `isValid: boolean`. Read it with
`self.prompt.<name>.isValid` (or an explicit participant slot).
`equals: true` waits for a valid answer; the optional idiom is `any` of
`doesNotExist` and `equals: true`. See [validity and conditions](prompts.md#response-validity-and-conditions).
Validation is advisory; it does not automatically block submission.
Shared numeric prompts permit their constraints and include the group's
`isValid`, addressable as `shared.prompt.<name>.isValid`. Every other shared type
rejects `required: true`, `minLength`, and `maxLength`, but allows explicit
`required: false`; those records omit `isValid`, and shared validity references
are rejected after loading the prompt metadata.

Two or three sections separated by `---`. `noResponse` and `numericResponse`
omit the response section and its preceding delimiter:

```markdown
---
type: multipleChoice | dropdown | openResponse | numericResponse | noResponse | listSorter | slider
name: My Prompt # optional — human-readable identifier
---

## Markdown body text

- Response option 1
- Response option 2
```

`name` is optional. Can be any string — use it as a human-readable identifier. Prompt files must use the `.prompt.md` extension.

Slider requires `min`, `max`, `interval` in metadata. Slider initializes without a visible thumb (anti-anchoring).

For expression typing, `numericResponse`, sliders, and numeric-mode single-choice `multipleChoice` save numbers; numeric-looking text options and open responses remain strings. See [Prompts that save numbers](conditions.md#prompts-that-save-numbers).

`numericResponse` accepts optional `required?: boolean`, `min?: number`,
`max?: number`, `integer?: boolean`, `prefix?: string`, and `suffix?: string`.
Bounds are inclusive, finite, and ordered (`min <= max`); whole-number mode
requires whole bounds. Each bound's plain spelling must fit within 100 characters
and 15 significant digits. Affixes are single-line plain text of at most 32 UTF-16
code units. `rows`, `minLength`, `maxLength`, `interval`, and `placeholder` are
rejected for this type.

```markdown
---
type: numericResponse
min: 0
integer: true
suffix: items
---

How many items did you count?
```

Numeric records keep raw `entry`, `{ decimal, grouping }` in `numberFormat`, and
`isValid`. `value` is a number whenever parsing succeeds, even if invalid under
the constraints; otherwise it is omitted. Blank never becomes zero. See
[Numeric Response](prompts.md#numeric-response) for parsing, feedback, shared
editing, and the researcher caveat.
