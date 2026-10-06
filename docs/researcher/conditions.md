# Conditions and References

Conditions control when elements are displayed, when stages remain active, and how participants are assigned to groups. A condition can compare a reference with a literal value or combine expressions for agreement, counts, and calculations.

> **Every reference starts with a position selector.** Use `self` (the current participant), `shared` (group-shared state), `everyone` (one value per participant seat), or a nonnegative integer seat (`0`, `1`, …). Structured references require their own `position` field too. Unprefixed references like `prompt.topicVote` are invalid; use `self.prompt.topicVote` for the current participant. The former `all.` prefix is now `everyone.`; see [upgrading group conditions](#upgrading-group-conditions).

## Basic Syntax

```yaml
conditions:
  - reference: self.prompt.topicVote
    comparator: equals
    value: "Yes"
```

A list under `conditions:` uses AND logic — every condition must be true. Omit `conditions` for an unconditional element; an empty list or a whole `conditions: null` is invalid. Numbers, strings, and lists do not count as true merely because they contain data.

```yaml
# A direct Boolean expression is also a condition.
conditions:
  allEqual:
    - reference: 0.prompt.topicVote
    - reference: 1.prompt.topicVote
```

Multiple conditions:

```yaml
conditions:
  - reference: self.prompt.multipleChoice
    comparator: equals
    value: response1
  - reference: self.prompt.openResponse
    comparator: hasLengthAtLeast
    value: 15
```

## Boolean operators: `all`, `any`, `none`

When you need OR or NOR logic, wrap conditions in an operator-keyed object. The flat-array form above is sugar for `all:` — these two are equivalent:

```yaml
# Implicit all (sugar)
conditions:
  - reference: self.prompt.a
    comparator: equals
    value: yes
  - reference: self.prompt.b
    comparator: exists
```

```yaml
# Explicit all
conditions:
  all:
    - { reference: self.prompt.a, comparator: equals, value: yes }
    - { reference: self.prompt.b, comparator: exists }
```

Use `any:` for OR, `none:` for NOR (none of these are true):

```yaml
# Show element if either participant's previous answer was "yes"
conditions:
  any:
    - { reference: 0.prompt.changedMind, comparator: equals, value: yes }
    - { reference: 1.prompt.changedMind, comparator: equals, value: yes }
```

```yaml
# Render fallback message when nobody hit the threshold
conditions:
  none:
    - { reference: 0.prompt.familiarity, comparator: isAtLeast, value: 50 }
    - { reference: 1.prompt.familiarity, comparator: isAtLeast, value: 50 }
```

Operators nest. Mix freely:

```yaml
# (P1 disagrees OR P2 disagrees) AND timer hasn't overflowed
conditions:
  all:
    - any:
        - { reference: 0.prompt.consensus, comparator: equals, value: disagree }
        - { reference: 1.prompt.consensus, comparator: equals, value: disagree }
    - { reference: self.prompt.discussion_overflow, comparator: doesNotExist }
```

### Missing answers and true/false conditions

An expression produces a value or **Missing**. Missing means there is no usable value: nothing is recorded, a prompt answer is blank (`""`, whitespace only, or `[]`), a numeric entry has no saved number, a reference or literal is `null`, or a calculation cannot produce a finite number. A wrong runtime type also becomes Missing and is reported. There is no third “unknown” or waiting state.

Zero and `false` are present. Literal empty strings and lists are present too; it is specifically a **prompt answer** that treats a blank string or empty list as Missing. This does not rewrite the saved answer or its `isValid` flag. A missing member of a list keeps its position.

A missing answer matches nothing, including another missing answer. Positive comparisons needing it return false; their negations return true. `exists` means present and `doesNotExist` means Missing. Use those comparators without a `value`; `null` is invalid anywhere in a comparator's literal `value`, including a candidate list.

| Operator | True when                  | False when                    |
| -------- | -------------------------- | ----------------------------- |
| `all`    | Every input is true        | Any input is false or Missing |
| `any`    | At least one input is true | No input is true              |
| `none`   | No input is true           | Any input is true             |

Only Booleans belong in these operators. A Missing Boolean counts as not true; other present values do not gain JavaScript-style truthiness. A condition whose final result is Missing hides an element, skips or advances a stage, or makes a participant ineligible, just as false does.

### Waiting is explicit

`none` around “rated above 50” is true before anyone answers. If a message should wait until both participants answer, say so:

```yaml
conditions:
  all:
    - reference: 0.prompt.familiarity
      comparator: exists
    - reference: 1.prompt.familiarity
      comparator: exists
    - none:
        - { reference: 0.prompt.familiarity, comparator: isAbove, value: 50 }
        - { reference: 1.prompt.familiarity, comparator: isAbove, value: 50 }
```

A positive condition can state the same wait more directly for a whole group:

```yaml
conditions:
  all:
    reference: everyone.prompt.familiarity
    comparator: isAtMost
    value: 50
```

Every seat must have a number and that number must be at most 50. See [group quantifiers](#group-quantifiers) for the `everyone.` form.

### Negation versus the opposite comparator

`doesNotEqual`, `doesNotInclude`, `doesNotMatch`, and `isNotOneOf` are exactly the negations of their positive comparators. They are true before an answer arrives. This fallback therefore appears immediately, and disappears if the participant answers “Yes”:

```yaml
conditions:
  - reference: self.prompt.continue
    comparator: doesNotEqual
    value: "Yes"
```

Numeric opposites behave differently. `isBelow: 5` and `isAtLeast: 5` both need a number, so both are false for a missing answer. `none` around `isBelow: 5` is true for a missing answer. Write the positive `isAtLeast` test when “has answered and scored at least 5” is the intended condition.

### Text comparisons and raw lengths

Equality and membership trim surrounding whitespace and lowercase text using the default Unicode mapping. This applies to `equals`, `isOneOf`, `includes`, `allEqual`, `allUnique`, `countUnique`, and the negative comparator forms. `" Red car "` and `"red car"` therefore match. Internal whitespace is not collapsed, and there is no additional Unicode normalization or participant-locale rule.

`matches` and `doesNotMatch` use the raw string and their explicit regex flags. `length` and `hasLengthAtLeast` / `hasLengthAtMost` count raw **UTF-16 code units** for strings (`🙂` has length 2), or positions for lists. A blank prompt answer is Missing before these operations run, so a whitespace-only response does not satisfy a length requirement. Stored and displayed text is unchanged.

Regex patterns may contain at most 1,024 UTF-16 code units. An input longer than 4,096 UTF-16 code units does not match; it is never truncated, and `doesNotMatch` is consequently true. These limits do not prevent a complex pattern from taking a long time. See [regex execution](../engineer/regex-execution.md) before using patterns with nested repetition or other substantial backtracking.

**Visibility-field interaction.** When an element also has `displayTime`, `hideTime`, `showToPositions`, or `hideFromPositions` set, all of those fields combine with `conditions` using implicit AND — the element is visible only when every visibility field that's set evaluates to "show." See [Element visibility](elements.md#visibility) for the full picture.

## Reference Strings

References point to data collected earlier in the experiment. The dotted form is always `<position>.<source>.<...>`, where the position selector (`self`, `shared`, `everyone`, or a numeric seat — see the note at the top) is required as the first segment and the rest depends on the source:

- **Named sources** (`prompt`, `submitButton`, `qualtrics`, `mediaPlayer`, `timeline`, `trackedLink`, `discussion`): `<position>.<source>.<name>(.<path>...)` — `name` is required, `path` is optional.
- **External sources** (`entryUrl`, `attributes`): `<position>.<source>.<path>...` — no `name`, `path` is required. `entryUrl` references must currently use the `params` subpath (see [URL Parameters](#url-parameters) below).

```yaml
- reference: self.prompt.familiarity # named: position.source.name
- reference: self.qualtrics.exit.sessionId # named: position.source.name.path...
- reference: self.entryUrl.params.condition # external: position.source.path...
```

References can also be written in **structured form**, especially when reading a saved field other than the prompt's default `value`:

```yaml
- reference:
    position: self
    source: prompt
    name: familiarity
    path: [value] # explicit; same as the dotted `self.prompt.familiarity`

- reference:
    position: self
    source: prompt
    name: familiarity
    path: [debugMessages] # newly possible — addresses other saved fields

- reference:
    position: self
    source: entryUrl
    path: [params, condition]
```

Both forms parse to the same internal shape; either is accepted at every reference site (conditions, `display.reference`, `trackedLink`/`qualtrics` `urlParams[].reference`).

### Prompt Responses

`self.prompt.<name>.isValid` reads the advisory validity flag on the most recent
committed response. Use `equals` with `value: true` to wait for a passing answer.
For an optional answer, use `any` combining `doesNotExist` and `equals: true`;
an untouched prompt has no flag. See [response validity](prompts.md#response-validity-and-conditions)
for both complete idioms, timing and trust limits, hidden-prompt gates, and the
group-validity guidance. To require every seat to be valid, put an
`everyone.prompt.<name>.isValid` comparator leaf directly under `all:`. Shared numeric prompts support
`shared.prompt.<name>.isValid` for the group's answer. Shared nonnumeric prompts
still have no flag, so references to their shared validity are rejected.

```
<position>.prompt.<name>
```

Returns the value saved by a prompt element. The `<name>` matches what you set in the treatment YAML.

A `numericResponse` returns a number when its `entry` parses, even outside the
authored bounds. Use numeric YAML values in comparisons:

```yaml
- type: submitButton
  conditions:
    all:
      - reference: self.prompt.age.isValid
        comparator: equals
        value: true
      - reference: self.prompt.age
        comparator: isAtLeast
        value: 18
```

For a shared numeric group answer, replace `self` with `shared`. The same optional
`any` idiom above applies when an untouched answer is allowed. Blank, unfinished,
malformed, and over-limit numeric entries have no `value`; `doesNotExist` on the
value alone does not distinguish an optional blank from malformed text. Read
`isValid` when that distinction matters. Validity can trail the live entry by a
commit window, and a late edit can pass a gate before its commit arrives; use
[recomputation for analysis](prompts.md#response-validity-and-conditions).

### Prompts that save numbers

The prompt's declared response mode determines its type, even before anyone answers:

| Response mode                                                            | Saved answer type |
| ------------------------------------------------------------------------ | ----------------- |
| `numericResponse`, `slider`, numeric-mode single-choice `multipleChoice` | Number            |
| `openResponse`, text-mode single-choice `multipleChoice`, `dropdown`     | String            |
| Multi-select `multipleChoice`, `listSorter`                              | List of strings   |
| `noResponse`                                                             | No answer value   |

Use `numericResponse` for typed numerical entry. For numeric multiple choice, write explicit numeric option prefixes such as `- 4: Agree`; a bare `- 4` is the text label `"4"`. See [Prompt files](prompts.md) for each response mode.

Compare numbers with unquoted YAML numbers (`value: 4`), and text with quoted values when it looks numeric (`value: "4"`). A number and a string cannot be compared or added by implicit conversion. An open response containing `"100.00"` is text and differs from `"100"`; numeric responses entered as those two spellings both save the number 100.

URL query parameters are always strings too. For example, use `value: "2"` with `self.entryUrl.params.condition`, not `value: 2`. Type checks use the prompt's response mode, not the current participant's answer; a missing or malformed numeric entry does not turn a numeric prompt into a text prompt.

### Survey Instruments

Survey instruments are prompt modules (see [Survey instruments](elements.md#survey-instruments)), so each item is an ordinary prompt reference: `<position>.prompt.<prefix>_<item>`. The former `survey` reference source was removed with the `type: survey` element in [#669](https://github.com/talkbench/stagebook/issues/669) and is rejected at validation time.

### Submit Button Timing

```
<position>.submitButton.<name>.time
```

Returns elapsed seconds when the button was clicked.

### Tracked Link Events

```
<position>.trackedLink.<name>.events
<position>.trackedLink.<name>.totalTimeAwaySeconds
```

A [`trackedLink`](elements.md#tracked-link) records an `events` array plus cumulative `totalTimeAwaySeconds`. Each entry in `events` has a `type` (`click`, `blur`, or `focus`), a `timestamp`, the `stage` it occurred in, and `stageTimeSeconds` (seconds into that stage); `focus` events also carry the `timeAwaySeconds` for that excursion.

`blur`/`focus` events fire on any tab switch while the element is on screen, so `events.length` on its own is **not** proof the link was opened. To require that a participant actually visited the link, gate on `totalTimeAwaySeconds` — it only accumulates after the link is clicked and the participant returns to the study tab:

```yaml
conditions:
  - reference: self.trackedLink.signup_link.totalTimeAwaySeconds
    comparator: isAbove
    value: 0
```

### Media Player Playback

```
<position>.mediaPlayer.<name>.firstPlay
<position>.mediaPlayer.<name>.firstEnd
```

A [`mediaPlayer`](elements.md#saved-data) saves its event log, and with it two playback milestones. `firstPlay` is the first `play` event: playback started. `firstEnd` is the first `ended` or `stopAt` event: playback reached the end of the clip, the moment `submitOnComplete` advances on. Each is absent until it happens and never changes after, so gate on it with `exists`. Pausing, replaying or seeking afterwards doesn't take it away. One exception: when the player remounts — a page reload, or a condition hiding the player and showing it again — it doesn't read its saved record back, so its next event replaces the record, milestones included ([#728](https://github.com/talkbench/stagebook/issues/728)).

To show **Next** once the participant has started the video:

```yaml
- type: mediaPlayer
  name: example_nod
  file: https://example.com/clips/nod.mp4
  controls:
    playPause: true
    seek: true
- type: submitButton
  name: next
  conditions:
    - reference: self.mediaPlayer.example_nod.firstPlay
      comparator: exists
```

To wait until playback reaches the end instead, use `self.mediaPlayer.example_nod.firstEnd`. Reaching the end is not watching all of it: a participant who seeks close to the end and plays from there reaches it too. In Firefox and Safari, seeking to the file's very end while paused also counts, because the browser reports the end ([#729](https://github.com/talkbench/stagebook/issues/729)); a `stopAt` is only reached by playback.

Don't gate on the record itself (`self.mediaPlayer.example_nod`) or on its `events`: seeks and speed changes save the record before anything plays. Neither milestone shows that someone watched attentively; use `watchedRanges` in analysis for how much they played.

### URL Parameters

```
<position>.entryUrl.params.<paramName>
```

Query parameters from the participant's landing URL (e.g., `?role=confederate`). The `params` subpath is required — the `entryUrl.*` namespace is reserved so future additions like `entryUrl.path`, `entryUrl.host`, `entryUrl.href` can land non-breakingly.

Renamed from the legacy `urlParams.<key>` source in #246 to disambiguate from the unrelated `urlParams:` element field on `trackedLink` / `qualtrics`, which sets _outgoing_ query parameters (i.e. params appended to the element's own URL). The element field is unchanged.

### Attributes

Everything the participant arrives with — identity, onboarding, connection,
and browser metadata — in one flat host-supplied bag (#473). Replaces the
former `connectionInfo` / `browserInfo` / `participantInfo` sources, which are
no longer valid.

```
<position>.attributes.stableParticipantId  # anonymized id; links exported data (always available)
<position>.attributes.sampleId             # per-assignment data-row id (game phase onward only)
<position>.attributes.name                 # nickname entered during onboarding
<position>.attributes.country              # ISO country code
<position>.attributes.timezone             # IP-based timezone
<position>.attributes.isKnownVpn           # known-VPN flag
<position>.attributes.screenWidth          # screen resolution
<position>.attributes.screenHeight
<position>.attributes.language             # browser language
<position>.attributes.userAgent
```

The recruitment-platform id is intentionally not exposed here (privacy). Note
`sampleId` is assigned at game-stage start, so reads from intro /
groupComposition are rejected by validation.

### Timeline Selections

```
<position>.timeline.<name>                  # the full selections array
<position>.timeline.<name>.length           # number of selections
<position>.timeline.<name>.0.start          # start time of the first range selection (seconds)
<position>.timeline.<name>.0.end            # end time of the first range selection (seconds)
<position>.timeline.<name>.0.time           # time of the first point selection (seconds)
<position>.timeline.<name>.0.track          # track index of the first selection (if track-scoped)
```

Array indices (0, 1, 2, ...) access individual selections in chronological order. Use this to validate that selections fall within expected time ranges:

```yaml
# Only show the submit button when the first selected range starts
# between 15 and 19 seconds (validating annotation accuracy)
- type: submitButton
  conditions:
    - reference: self.timeline.storySegment.0.start
      comparator: isAtLeast
      value: 15
    - reference: self.timeline.storySegment.0.start
      comparator: isAtMost
      value: 19
```

You can also check that a minimum number of selections have been made:

```yaml
- type: submitButton
  conditions:
    - reference: self.timeline.storySegment.length
      comparator: isAtLeast
      value: 3
```

### Discussion Metrics

```
<position>.discussion.<name>.discussionFailed
<position>.discussion.<name>.cumulativeSpeakingTime
```

`<name>` is the `name:` of the discussion block on the stage. After #240 the storage namespace is `discussion_<name>`, so a per-discussion lookup needs the name segment between `discussion` and the metric path. Available metrics depend on the host platform's discussion implementation.

## Position selectors

A position belongs **inside each reference**, either as the dotted prefix or the structured `reference.position`. It is required; `player` and an omitted default are not authoring forms. `groupComposition[].position` is a separate field that names the role being filled.

| Value            | Meaning                                                             |
| ---------------- | ------------------------------------------------------------------- |
| `self`           | Current participant                                                 |
| `shared`         | Shared records, such as a shared prompt                             |
| `0`, `1`, `2`, … | A specific participant seat                                         |
| `everyone`       | One value per seat in numeric seat order, retaining missing answers |

### Group quantifiers

An `everyone.` **reference expression** supplies list data. For example, `allEqual: {reference: everyone.prompt.label}` asks whether every seat gave the same label. It is false if any answer is missing. `sumExisting: {reference: everyone.prompt.points}` totals the numbers currently available.

An `everyone.` **comparator leaf** applies its comparator to each seat separately, returning one Boolean per seat. Consume it directly with `all`, `any`, `none`, or `countTrue`:

```yaml
conditions:
  all: # Every seat answered.
    reference: everyone.prompt.topic_vote
    comparator: exists
```

```yaml
conditions:
  nonDecreasing: # At least four participants said Yes.
    - 4
    - countTrue:
        reference: everyone.prompt.topic_vote
        comparator: equals
        value: "Yes"
```

`any` means at least one seat passes; `none` means no seat passes. These quantifiers are explicit: a bare `everyone.` leaf cannot be a condition. Nor can it be an item inside an operand list. Wrap it first:

```yaml
conditions:
  any:
    - any: # Quantify the per-seat results before combining with another test.
        reference: everyone.prompt.help
        comparator: equals
        value: "Yes"
    - reference: shared.submitButton.finish
      comparator: exists
```

Per-seat `includes` tests membership in each participant's answer, including a multi-select answer; per-seat `hasLengthAtLeast` measures each answer. Neither measures the group list itself. Group collections of list-valued answers are not general nested-list expressions; these per-seat comparator leaves are the supported way to test them.

### Upgrading group conditions

The former `all.` prefix checked only recorded answers, so replacing it needs a comparator-specific choice:

- `all.x` with `exists` meant someone answered: use `any` around an `everyone.x` `exists` leaf.
- `doesNotExist` and the four negative comparators retain their meaning under `all` around the equivalent `everyone.` leaf.
- Other positive comparisons use `all`, which now requires **every seat** to answer and pass. Add that wait deliberately.

### Examples

Show a submit button only when both players in a 2-player study have answered:

```yaml
- type: submitButton
  conditions:
    all:
      - reference: 0.prompt.topic_vote
        comparator: exists
      - reference: 1.prompt.topic_vote
        comparator: exists
```

Show content if either player chose "yes":

```yaml
- type: prompt
  file: game/either_yes.prompt.md
  conditions:
    any:
      - reference: 0.prompt.topic_vote
        comparator: equals
        value: yes
      - reference: 1.prompt.topic_vote
        comparator: equals
        value: yes
```

Display another participant's response:

```yaml
- type: display
  reference: 1.prompt.topicA_prompt
  showToPositions: [0]
```

## Comparators

### Existence

| Comparator     | Description               | Value    |
| -------------- | ------------------------- | -------- |
| `exists`       | A usable value is present | _(none)_ |
| `doesNotExist` | The value is Missing      | _(none)_ |

### Equality

| Comparator     | Description                     | Value Type                        |
| -------------- | ------------------------------- | --------------------------------- |
| `equals`       | Typed equality; text normalized | Scalar or compatible literal list |
| `doesNotEqual` | Negation of equality            | Scalar or compatible literal list |

### Numeric

| Comparator  | Description           | Value Type |
| ----------- | --------------------- | ---------- |
| `isAbove`   | Strictly greater than | number     |
| `isBelow`   | Strictly less than    | number     |
| `isAtLeast` | Greater than or equal | number     |
| `isAtMost`  | Less than or equal    | number     |

### String and List Length

| Comparator         | Description                                  | Value Type          |
| ------------------ | -------------------------------------------- | ------------------- |
| `hasLengthAtLeast` | Raw string length or list positions >= value | nonnegative integer |
| `hasLengthAtMost`  | Raw string length or list positions <= value | nonnegative integer |

### Content and Regex

| Comparator       | Description                                                           | Value Type        |
| ---------------- | --------------------------------------------------------------------- | ----------------- |
| `includes`       | Contains normalized substring; for a list, contains the scalar member | compatible scalar |
| `doesNotInclude` | Negation of `includes`, including true for a missing answer           | compatible scalar |
| `matches`        | Matches a JavaScript regular expression on raw text                   | string (regex)    |
| `doesNotMatch`   | Does not match regex                                                  | string (regex)    |

### Set Membership

| Comparator   | Description               | Value Type                       |
| ------------ | ------------------------- | -------------------------------- |
| `isOneOf`    | Value is in the array     | nonempty list of one scalar type |
| `isNotOneOf` | Value is not in the array | nonempty list of one scalar type |

## Expressions and calculations

Expressions can be scalar literals, `{literal: ...}`, references, comparator leaves, or an object with exactly one operator key. Strings stay literals even if they contain dots. Use `{reference: self.prompt.score}` to read a value, not the string `self.prompt.score`. Known types must match; there is no automatic conversion from strings or Booleans to numbers.

A bare list after an operator is a list of **operand expressions**. To supply list data, use `literal: [red, blue]` or a reference that returns a list. Operators accepting a runtime list take that expression directly:

```yaml
average:
  reference: everyone.prompt.rating
```

Do not write `average: [{reference: everyone.prompt.rating}]`: that places a list where one numeric operand is expected. There is no implicit flattening. Empty authored operand lists are invalid. Runtime lists keep missing positions; `length` counts those positions, while the count operators describe what is present.

The [syntax reference](syntax-reference.md#expression-operators) lists all 28 operators and their input shapes. `allEqual` compares at least two values of one type; list-to-list comparisons also require the same length, order, and corresponding values. A missing value never agrees with another missing value. `allUnique` requires at least two present, pairwise different scalar values.

### Strict and partial calculations

`sum`, `average`, `product`, `min`, `max`, `subtract`, `divide`, and `length` need every required input. A missing input makes the result Missing, even in `product: [0, null]`. An empty runtime list has no strict numeric reduction result. Division by a data-derived zero or any nonfinite result is Missing; a literal zero divisor is invalid authoring.

Use `sumExisting`, `averageExisting`, `minExisting`, or `maxExisting` when a calculation should omit missing numeric inputs. Their `atLeast` option is the minimum number of present input positions, defaulting to 1:

```yaml
averageExisting:
  inputs:
    - reference: self.prompt.itemA
    - reference: self.prompt.itemB
    - reference: self.prompt.itemC
  atLeast: 2
```

With answers 6, Missing, and 2, this is 4. With only one answer it is Missing. Repeated operands count as separate positions. This policy applies only to that calculation: it cannot remove a missing factor from a nested strict `product`. There is no `productExisting` or `missing: skip` mode.

`firstExisting` chooses the first present result, in written order. Add a literal fallback only when the default is part of the study's intended scoring:

```yaml
firstExisting:
  - sumExisting: { reference: everyone.prompt.points }
  - 0
```

Zero, false, and literal empty strings or lists are present, so they can be selected. A blank prompt answer is Missing. All present results must have compatible types, including list element types.

### Counts never wait

`countExisting` counts present scalar values, `countTrue` counts true results, and `countUnique` counts distinct present scalar values using normalized text equality. Missing values do not count. All three return 0 when nothing counts, including an empty runtime list. There is no `countTrueExisting` or `countUniqueExisting` variant.

A `countUnique` of 1 does not establish that everyone answered or agreed. Use `allEqual` for agreement, or add an explicit presence check before showing a count that should wait for everyone.

### State every band in a case

A `case` checks rules in written order and selects the first true `when`. Missing conditions are not true. Only the selected `value` is evaluated; if it is Missing, the case does not fall through to another rule. No selected rule and no default also means Missing.

Write every substantive band as a rule. A default of `low` would include people who never answered:

```yaml
case:
  rules:
    - when:
        reference: self.prompt.score
        comparator: isAtLeast
        value: 80
      value: high
    - when:
        reference: self.prompt.score
        comparator: isAtLeast
        value: 50
      value: medium
    - when:
        reference: self.prompt.score
        comparator: isBelow
        value: 50
      value: low
    - default: true
      value: null # No answer, so no band.
```

There may be one default rule, and it must be last. All present branch results must have compatible types; `null` contributes no present type. Every branch and reference still follows the authoring checks, even if a prior rule always selects first. A string-valued case is an expression, not by itself a Boolean `conditions:` gate.

## Using Conditions for Group Assignment

Conditions in `groupComposition` control which participants fill which positions:

```yaml
treatments:
  - name: cross_partisan
    playerCount: 2
    compatibleIntroSequences: [onboarding] # the sequence that asks the partyAffiliation prompt (a 0–100 slider)
    groupComposition:
      - position: 0
        title: "Democrat"
        conditions:
          - reference: self.prompt.partyAffiliation
            comparator: isBelow
            value: 50
      - position: 1
        title: "Republican"
        conditions:
          - reference: self.prompt.partyAffiliation
            comparator: isAbove
            value: 50
```

Each entry's optional `title` is a short human-readable label for the role (max 25 characters); `position` and `conditions` do the assignment.

You can also use URL parameters for pre-assigned roles:

```yaml
groupComposition:
  - position: 0
    title: Confederate
    conditions:
      - reference: self.entryUrl.params.role
        comparator: equals
        value: confederate
  - position: 1
    title: Participant
    conditions:
      - reference: self.entryUrl.params.role
        comparator: equals
        value: participant
```

**Note:** Group assignment conditions can only use the participant's own responses — reference strings must use the `self` position selector.

## Consent gating

Gated consent (#481) uses ordinary element conditions — a submit button in a consent step conditioned on an acknowledgement prompt in the **same step** is the sanctioned pattern. Element conditions re-evaluate live against in-memory responses, so the "I consent" button appears the moment the acknowledgement is selected:

```yaml
consent:
  - name: consent-en
    steps:
      - name: consent-info
        elements:
          - type: prompt
            file: consent/en/acknowledge.prompt.md
            name: acknowledge
          - type: submitButton
            buttonText: I consent
            conditions:
              - reference: self.prompt.acknowledge
                comparator: exists
```

This `exists` gate requires a nonblank answer. For `select: multiple` checkboxes, an unchecked `[]` answer is Missing and does not pass `exists`; selecting any option does. To require a specific acknowledgement, use `comparator: includes` with its option text. If several acknowledgements are required, add an `includes` condition for each one. Membership ignores surrounding spaces and case, so use a uniquely worded option for each acknowledgement.

Recommended, not required: make the consent text itself the body of that acknowledgement prompt, so the option can only be selected alongside the rendered text and the agreed-to text is saved with the response — see [the gated-submit pattern](treatment-files.md#the-gated-submit-pattern) and the [validated annotated walkthrough](../../examples/annotated-walkthrough/README.md#consent-acknowledgement).

References travel the other way only inside consent: a later consent step may read an earlier one in the same arm, but a reference **into** consent from anywhere else — intro, game, exit, or `groupComposition` — is an error. Consent responses are audit-only (see [Consent](treatment-files.md#consent)); if downstream logic needs an answer, collect it in an intro step instead.

## Stage-level conditions

Any stage, intro step, or exit step can carry its own Boolean `conditions` expression or condition list. Think of it as: _this stage should be active while these conditions hold._ When any condition is false, stagebook asks the host to advance — either skipping the stage at load (if the data comes from an earlier stage) or ending it early (if it comes from the current stage).

The expression rules and reference syntax are the same as for element conditions. There is no implicit wait: false or a final Missing result asks the host to advance.

### Skip a stage based on prior data

Round 2 only runs if the group voted to continue after round 1:

```yaml
gameStages:
  - name: round1_vote
    duration: 60
    elements:
      - type: prompt
        name: continueVote
        file: continue_vote.prompt.md # a single-choice prompt with options "yes" / "no"
      - type: submitButton

  - name: round2
    duration: 300
    conditions:
      all:
        - reference: 0.prompt.continueVote
          comparator: equals
          value: "yes"
        - reference: 1.prompt.continueVote
          comparator: equals
          value: "yes"
    elements:
      - type: prompt
        file: round2.prompt.md
      - type: submitButton
```

### End a stage early (early termination)

Condition authored so it's `true` while no one has submitted, flips to `false` as soon as anyone does:

```yaml
gameStages:
  - name: speed_round
    duration: 120
    conditions:
      - reference: shared.submitButton.speedSubmit
        comparator: doesNotExist
    elements:
      - type: submitButton
        name: speedSubmit
```

### Position rules

Game-stage conditions must evaluate **identically on every client** or the stage desyncs. Use `shared`, explicit numeric seats, or `everyone`, which give all clients the same references. `self` is invalid at game-stage level because it reads a different participant on each client.

| Context          | Allowed reference positions                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| Game-stage gate  | `shared`, numeric seat, `everyone`                                           |
| Intro step       | `self`, `shared`; numeric seats and `everyone` are invalid before assignment |
| Exit step        | `self`, `shared`, numeric seat, `everyone`                                   |
| Group assignment | `self` only                                                                  |

The selector is required in every context. Shared reads do not permit authoring shared prompts in intro or exit steps; those prompt-placement constraints still apply.

### Host requirements

Stage-level conditions rely on two fields on `StagebookContext`:

- `advanceStage()` — called by stagebook when conditions fail. Hosts implement the advancement policy. Single-participant hosts wrap `submit()`; multi-participant hosts submit for every player (so dropouts can't hang the stage).
- `stageId` — opaque per-stage identifier. Lets stagebook reset its internal latch cleanly between stages without a key-remount by the host.

See [platform-requirements.md](../engineer/platform-requirements.md) for the full host-integration checklist.

## Preflight reference validation

Apply the following authoring rules to references in conditions, `display.reference`, `trackedLink` / `qualtrics` `urlParams`, discussion conditions, and `groupComposition` conditions. Every expression branch matters for reference and type checking, including branches that runtime short-circuiting may not evaluate.

### No forward references — everywhere

A reference must point at data produced by an earlier or the current stage in the flow:

```
introSteps → gameStages → exitSequence
```

Referencing a stage that hasn't run yet is rejected. External references (`entryUrl.params.*`, `attributes.*`) are always valid — they come from the platform, not a stage. The one exception is `attributes.sampleId`, which is assigned at game-stage start: reading it during intro / groupComposition is rejected like a forward reference.

References that resolve from intro-step data are checked against the treatment's declared `compatibleIntroSequences:` (see [Pairing Treatments with Intro Sequences](treatment-files.md#pairing-treatments-with-intro-sequences)): the key must be provided by **every** sequence the treatment lists, not just one of them — a batch can run the treatment after any listed sequence, so the reference must hold under all of them. A reference whose key exists only in a sequence the treatment doesn't list gets a hint suggesting you add that sequence.

`groupComposition` is stricter: it runs before the game starts, so its conditions can only reference intro-phase or external data. Referencing game or exit data from `groupComposition` is rejected.

### No always-skip-at-load — stage-level conditions only

Evaluate the **whole condition tree** with current-stage references set to Missing when designing an early-termination gate. It must permit the stage to enter before its own answers arrive. A gate that is necessarily false at that point skips the stage at load; checking each comparator in isolation would miss the effects of `all`, `any`, and `none`.

OK:

```yaml
conditions:
  - reference: shared.submitButton.speedSubmit
    comparator: doesNotExist # true while Missing → stage renders
```

Rejected at preflight:

```yaml
conditions:
  - reference: shared.submitButton.speedSubmit
    comparator: exists # false while Missing → always skips
```

This rule applies to stage gates. False-at-load is a normal element condition: for example, a submit button can start hidden and appear after a prompt is answered. The element is re-evaluated when data changes; the expression itself has no waiting state.

### No unsatisfiable conditions — dead gates

A condition that reads a prompt's answer (`self.prompt.<name>.value`) is rejected when **no value the prompt can ever produce** satisfies the comparator — a _dead gate_. The classic cause is editing an option's wording without updating the condition (or vice versa): the reference still resolves and the YAML is well-formed, but at runtime the gate never resolves — the submit button never enables, or the conditional element never shows.

Rejected at preflight (the prompt's options contain that substring in none of them):

```yaml
# goal.prompt.md options: "…", "To explore possible ways forward you both could live with"
conditions:
  - reference: self.prompt.goal.value
    comparator: includes
    value: "joint solution" # substring of NO option → dead gate
```

Known answer domains include `multipleChoice` / `dropdown` options (a numeric-mode choice stores its number, not its label), the `slider` range `[min, max]`, and `openResponse` length capped by `maxLength`. Check every condition block, including chained gates where one answer reveals another prompt whose answer then reveals a submit button.

`numericResponse` bounds are advisory and do not define a bounded stored domain.
For example, `isAbove: 99` is possible even when the prompt declares `max: 99`,
for both player and shared answers: the value is saved and marked invalid.
Combine value conditions with `isValid` when you need an in-range answer.

Reachability means at least one possible answer can satisfy the **whole expression**, not that every leaf can. An impossible leaf under `any` need not make the gate impossible, and `none` reverses the result. Free-text answers, unknown reference types, and other unbounded domains need conservative checks: lack of a proof is not proof that a gate is dead. Reachability also does not establish correctness—a condition that accepts the wrong answer may still be satisfiable.

### Types and treatment-specific checks

Known incompatible types are authoring errors in either direction: a number cannot equal a string, a list cannot be used as one number, and a `case` cannot return known incompatible branch types. These rules apply separately to each treatment and its compatible intro sequences. Reusing a prompt name in another treatment does not change the type of this treatment's reference.

A reference with an unknown type is still usable, with an authoring warning explaining why: the source has no declared schema, its prompt file could not be read, or its possible producers disagree. Unknown does not erase a conflict between types that are known elsewhere in the expression. A wrong type actually encountered at runtime is reported without participant values and becomes Missing, after which the ordinary expression rules apply.

For prompt records, answer types come from response modes, as described in [Prompts that save numbers](#prompts-that-save-numbers). Other prompt fields may remain unknown even when their values are usable. Host fields with declared schemas have known types; additional host fields without schemas remain unknown. Pilot the study's real data paths as well as checking its authoring structure.
