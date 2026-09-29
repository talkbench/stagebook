# Numeric responses are their own prompt type

Status: proposed in [#687](https://github.com/talkbench/stagebook/issues/687).
Builds on [prompt validation](2026-09-prompt-validation.md) (#668).

A `numericResponse` prompt lets a participant type a number. The prompt
parses the entry and saves a **number** in `value`, so #299 expressions and
#674 derived values can use it directly, without coercing strings. It follows
openResponse wherever it can, so participants and researchers meet one
pattern: a full-width field, feedback in plain text below it at the end, the
same commit timing, and the same telemetry. It differs only where numbers
need it.

## The type

`numericResponse` is a new branch of the prompt-file union, not a mode on
`openResponse`. A `valueType` switch would make `rows`, `minLength` and
`maxLength` legal only for text, and `min`, `max` and `integer` legal only for
numbers. That's a field changing meaning by value (Principle 4). As its own
branch, its strict schema decides which fields apply, and downstream type
checks can read "this prompt's `value` is a number" off the type.

```yaml
---
type: numericResponse
required: true
min: 18
max: 99
integer: true
suffix: years
---
How old are you?
```

- `required`, `min`, `max`, `integer`, `prefix`, and `suffix` are all
  optional, alongside the shared `name`, `notes`, and `locale`.
- `min` and `max` are inclusive bounds that `isValid` checks. Unlike the
  slider's, they don't limit what's saved: an out-of-range answer is saved
  and marked invalid, as a too-short text answer is under `minLength`.
  Either one may appear alone. When both appear, `min` must not exceed
  `max`.
- With `integer: true`, both bounds must be whole numbers.
- The file has two sections, like `noResponse`, and a third section is an
  error. There is no placeholder: an example value would anchor answers, for
  the same reason the slider shows no thumb before selection.
- `prefix` and `suffix` are short plain text in the prompt file's own
  language (see [Unit labels](#unit-labels)).
- `shared: true` is supported, through the host's collaborative editor (see
  [Shared numeric responses](#shared-numeric-responses)).

## The field

A single-line `<input type="text">`, full width, with TextArea's box metrics.
It is not `type="number"`: the native control accepts `e`, adds spinners,
can change value on scroll, and parses differently from browser to browser.
The input is `dir="ltr"`, so `-2.5` never renders as `2.5-`. Its text aligns
to the page's reading start, which is the right in RTL.
`inputmode` is `numeric` only for whole numbers with a minimum of 0 or more.
Otherwise the field uses the default keyboard, for two reasons. The iOS
numeric and decimal keypads have no minus key. And the iOS decimal keypad
shows the decimal separator of the phone's region, not the study's locale: an
English study on a phone set to a German region would offer only `,`, which
the field refuses.

The field is named by the prompt body through `aria-labelledby`, as the
dropdown is. It keeps openResponse's measurement behavior:

- Paste is blocked and recorded as a paste attempt, as in openResponse.
  Drag-and-drop is blocked and recorded the same way. That part is new:
  TextArea doesn't block drop today
  ([#691](https://github.com/talkbench/stagebook/issues/691)).
- Keystroke telemetry goes into `debugMessages`, computed exactly as
  TextArea computes it. That includes TextArea's current gap on Android,
  where keydown reports keys as "Unidentified" and typing goes uncounted.
  [#692](https://github.com/talkbench/stagebook/issues/692) fixes that for
  both types.
- Responses commit on the same boundaries as text: a two-second quiet period,
  a five-second maximum wait, and leaving the field
  ([response commits](2026-09-response-commits.md)).

The #668 "Required" marker applies unchanged, and the input carries
`aria-required`.

## Keystrokes and feedback

The field accepts digits, `-`, and the locale's decimal separator, whatever
the constraints are. Every other character is dropped, with the counter's
amber pulse (a static glow under reduced motion). That includes letters,
spaces, `+`, and the locale's grouping separator. So in `en`, typing `1,000`
gives 1000, which is what the participant meant. A participant used to
decimal commas who types `1,5` gets 15. That's an accepted cost of refusing
the grouping separator; the alternative is flagging it.

The filter applies to inserted text, whatever inserted it: a keystroke, an
IME commit once composition ends, autofill, or dictation. It never reads
keydown keys, which Android reports as "Unidentified".

- Allowed characters in an insertion are kept, and the rest are dropped.
- An insertion with no allowed characters changes nothing, so typing a
  letter over a selection doesn't erase the selection.
- The entry is capped at 100 characters. A change that would exceed the cap
  is refused whole, with the pulse; it's never truncated. If the text is
  already over the cap, which two merged edits or an undo in a shared field
  can cause, deletions are accepted and insertions refused.
- A dropped character counts in the telemetry exactly as a refused overflow
  key does in TextArea. It doesn't start or extend a commit timer.

The rule is to block only characters that can't change a number's value
under the study locale's conventions. So the field never drops a sign or a
decimal separator. It does drop the grouping separator, whose removal leaves
the value unchanged in that locale; the `1,5` case above is someone
following a different convention. The maxLength cap can drop
keystrokes safely, because what remains is still the start of the
participant's text. Dropping a character from a number produces a different
number instead. Blocking `-` turns −3 into 3, blocking `.` in whole-number
mode turns 1.5 into 15, and capping at a maximum of 20 turns 25 into 2. Each
of those would be saved as a valid answer without anyone noticing.

The field is checked on every keystroke, and the check asks whether typing
more at the end could still make the entry valid:

- **Valid and non-blank:** the guidance turns green, with a ✓.
- **Can't become valid by typing more:** the problem shows at once. Examples:
  25 with a maximum of 20, 1.5 when only whole numbers are allowed, `3-4`,
  or `-` when the minimum is 1.
- **Could still become valid:** the guidance stays neutral until the
  participant leaves the field. Examples: 3 on the way to 35 when the minimum
  is 18, a lone `-` when negatives are allowed, or `5.`.
- **After leaving the field:** any non-blank invalid entry shows its problem,
  and it stays until the participant's own next edit.
- **Blank:** muted guidance, never green and never a problem, even though a
  blank optional entry is valid. This matches #668's counter: it shows
  progress, not permission. The Required marker already says an answer is
  needed.
- **Restored on reload:** an invalid entry shows its problem, as if the
  participant had just left the field.

Guidance and problems are plain end-aligned text below the field, styled like
the counter: muted guidance ("Whole number from 18 to 99"), green with ✓ when
valid, and `--stagebook-warning` text with ⓘ for a problem ("25 is more than
20", "Enter a single number"). This is the one new use of the warning token
as text color; it clears AA on white, and the a11y gate measures it. The
feedback is plain text, never HTML. A problem quotes the parsed number,
written the way it would be typed, and never the raw entry, so padding such as
`00025` isn't echoed back. As #668
decided, validation state is advisory. The field never uses `aria-invalid`,
`role="alert"`, or a live region. The feedback element is part of the input's
`aria-describedby`.

## Parsing and locale

After trimming surrounding whitespace, an entry is a number if it is an
optional leading `-`, then digits with at most one decimal separator, with at
least one digit after the separator if one is present. So `5.` is unfinished,
and `.5` is 0.5. An entry longer than 100 characters is not a number ("Too
long"), checked before anything else, whatever wrote it. Leading zeros are
allowed. An entry can have at most 15
significant digits, the most a JavaScript number keeps exactly. The count
runs from the first non-zero digit through the last digit typed, so trailing
zeros count and leading zeros don't. Beyond that limit,
it's a problem ("Too many digits") rather than a silently rounded number.
Exponents, grouping, hex, and non-Western digits are not numbers in this
version. Frontmatter bounds must be finite, so YAML's `.inf` and `.nan` are
authoring errors. They have the same 15-digit limit, and guidance writes
them in plain notation, never as `1e+21`. Bounds are YAML numbers, so digits
beyond what a JavaScript number keeps are lost when the file is parsed, as
they are for the slider's bounds. `1.0000000000000001` is read as 1.

The parser and the "could still become valid" check both run in linear time.
They build no regular expressions from the catalog's separators, and they
decide from digit counts instead of searching possible continuations. The
parser takes the number format as an argument, so a host can run it on
stored entries.

The decimal and grouping separators come from a `numberFormat` entry in the
message catalog, which is selected by the provider's `locale`. That is the
locale the host sets from the treatment, and the validator already checks
that it matches each prompt's declared `locale`. Parsing does not use `Intl`:
it has no parser, and its locale data varies between browser versions. The
same reasoning keeps the counter on UTF-16 code units, so every participant's
browser behaves identically. `en` and `he` both use `.` and `,`, so the
catalog entry is an extension point for now. Adding a decimal-comma locale
becomes catalog data rather than a parser change. A host supplying a catalog
for a locale Stagebook doesn't ship supplies this entry too. A host override
of `numberFormat` is merged field by field. The decimal and grouping
separators must each be a single character that isn't a digit or `-`, and
they must differ. The decimal separator can't be whitespace. The grouping
separator can be a space, a no-break space (U+00A0), or a narrow no-break
space (U+202F), as in `1 000`. Otherwise Stagebook warns and keeps the
bundled entry.

Guidance writes numbers the way the participant types them: with the locale's
decimal separator and no grouping. In RTL locales, catalog strings wrap every
interpolated signed number in LRI (U+2066) and PDI (U+2069). Without them,
`-10` renders as `10-`.

## Saved record

`value` holds the participant's answer in the prompt's type, as it does for
text, and `isValid` says whether that answer meets the constraints.

- **The entry parses as a number:** `value` is that number, whether or not it
  is in range or whole, and `-0` is saved as `0`. For example, 25 with a
  maximum of 20 saves `value: 25, isValid: false`.
- **Blank, unfinished, or not a number:** there is no `value`. There is no
  number to save, and saving the text would break the guarantee that `value`
  is a number. So a cleared entry never becomes 0, and `3-4` is Missing to
  #299.
- **`entry`** holds the raw text, so an unfinished entry comes back on
  reload and appears in the data. A host stores at most 1,000 characters of
  it. Anything over 100 is already invalid, so storing less can't change a
  recomputed verdict.
- **`numberFormat`** records the decimal and grouping separators in force when
  the entry was parsed. A host override or a host-supplied catalog isn't
  otherwise in the data, and `entry` can't be reparsed without it: `1,5` is
  1.5 under one format and not a number under another. It documents what was
  used, but it isn't authoritative; see below.
- **`isValid`** extends #668's validity function. A blank entry is valid
  unless the prompt is required. A non-blank entry is valid when it parses,
  lies within the bounds, and, with `integer: true`, is whole.

`value` is derived from the current entry at every commit, so a changed or
cleared answer never leaves a stale number behind. Calculations use an
out-of-range number unless they check `isValid`, just as they use a
too-short text answer. That's the price of keeping `value` and `isValid`
independent. #668's caveat therefore applies with extra force here. Gating
the submit button on `isValid` keeps participants to valid answers, but it
can't guarantee one, because a last-moment edit can be clicked through before
its commit reaches the gate. In stages that can end any other way, check
`isValid` in derived values. The guarantee comes from recomputing in
analysis.

Recomputing validity for analysis starts from `entry`, not `value`: a blank
optional answer and `3-4` both lack a `value`, but only the first is valid.
For an individual prompt, the participant's browser wrote every field in the
record. So a host that must trust a numeric answer recomputes `value` and
`isValid` from `entry`. It uses the exported parser, with the number format
from its own session configuration: `resolveNumberFormat` given the locale and
overrides it set for that session. It ignores the saved `value` and
`isValid`, and it doesn't trust the record's `numberFormat` either, because
the same browser wrote it. A tampered record could declare a comma decimal so
that an injected `0,15` passes a bound of 0.1 to 0.2. The saved format is
only compared against the trusted one; a mismatch marks the record as
suspect.
For the same reason, #299 checks at runtime that `value` is a number. The
type declares it, but a tampered record can say otherwise.

## Unit labels

`prefix` and `suffix` render inside the field, muted, at its logical start
and end. So in RTL a suffix sits on the left. They are plain text, rendered
as text nodes and never through Markdown. Each is a single line of source
text, at most 32 characters. A cap can't reserve space on its own, since
glyph and viewport widths vary. So the input keeps a minimum width of 6rem
(about ten digits), and the labels give way instead. They wrap within the
field, which grows taller, and they're never truncated, so the author's
text stays visible. At a 320px viewport, two 32-character labels still
leave the input its minimum width. Both are optional because unit
position depends on the unit and the locale. Units of measure usually follow
the number, while currency comes first in `en-US` (`$5`) and last in, for
example, French or German (`5 €`). Some answers need both (`$` … `per year`).
Adjacent unit labels are established survey practice for getting answers in
the intended unit. They're also why the question text isn't the only place
for the unit.

The author writes the label in the language and order of the prompt's own
locale, and Stagebook trusts that order. Each label renders in a `<bdi>`, so
it takes its direction from its own content. Without that, neutral characters
at a label's edges would take the surrounding direction, and a correctly typed
`°C` renders as `C°` in an RTL field. The labels are part of the input's
accessible description, so a screen reader announces "35, years". In a
full-width field, a suffix sits a long way from a short number; that's the
cost of keeping openResponse's footprint.

## Shared numeric responses

A `shared: true` numeric prompt is one answer for the whole group, entered
through the host's collaborative editor, as a shared open response is. It
ships with the rest of this type; there's no interim phase.

- **Rendering.** The host renders the field through a new, optional
  `renderSharedNumericResponse` slot, not a mode on `renderSharedNotepad`.
  A host without numeric support would otherwise quietly render a free-text
  notepad and save a string `value`. Without the slot, Prompt shows an
  `ErrorCallout` saying the question can't be shown here, and reports it
  through `onContractViolation`.
- **The slot's config.** Stagebook passes:
  - the prompt's `name`, which selects the shared document and the
    `shared.prompt.<name>` record, as `padName` does for notepads;
  - the constraints, the affixes, and the effective `numberFormat`;
  - the `inputmode` derived from the constraints;
  - the id of the prompt body, which names the field through
    `aria-labelledby`;
  - the commit callbacks `onLocalEdit(text)` and `onBlur(text)` (#697, shared
    with `renderSharedNotepad`).

  It also passes helpers bound to the active message catalog: the keystroke
  filter, and the feedback state and text. The host wires these into its
  editor rather than reimplementing them, so the rules have one source.

- **What stays with Stagebook.** It still renders the prompt body and the
  Required marker. The runner work is talkbench/runner#1015.
- **Keystrokes.** The filter applies to each participant's own insertions
  only. Remote changes pass through untouched, because filtering them would
  make that participant's copy drift from the shared text. Since every client
  filters its own input, the shared text holds only allowed characters. A
  tampered client can still write anything, and the parser treats that as
  invalid. An undo in the shared editor also skips the filter, but it only
  restores characters that were accepted before. Paste and drop are blocked.
  Typing telemetry for shared fields is future work covering all shared
  notepads (talkbench/runner#1014).
- **Feedback.** Each participant's feedback follows their own focus. There is
  no special case for watching someone else type, so a participant who has
  left the field may briefly see a problem while another is partway through a
  number. Another participant's edit doesn't count as "the next edit" that
  clears a problem shown after leaving the field; only your own edit does.
  The feedback sits in one end-aligned row below the field: first the
  feedback text, then the host's Shared chip at the far end. That way the chip
  doesn't move as the text changes length. Like the chip, the feedback text
  has an opaque background, so presence rings pass behind it without changing
  its contrast.
- **Saved record.** The typist writes, through Stagebook (#697). The host
  calls `onLocalEdit(text)` with the merged text, and only for this
  participant's own edits, never for remote sync. It calls `onBlur(text)` on
  blur. Stagebook runs the open-response commit timer: 2s quiet, 5s maximum
  wait, and blur when an edit is pending. It then builds the record with its
  normal builder (`value`, `entry`, `isValid`, `numberFormat`, and the usual
  metadata) and saves it through the host's `save` with scope `shared`. The
  runner half is talkbench/runner#1013.
  - **Several writers, one snapshot.** Idle participants never write. Writes
    are full snapshots of the merged text, taken after the typist's own
    quiet period, when views have almost always converged. So two people
    typing in the same window write the same text, and the duplicates are
    harmless. A rare stale snapshot from a lagging view is corrected by the
    next write or by the stage-end write.
  - **Stage end.** The host's final pull remains the last snapshot. It builds
    the record with Stagebook's exported `buildPromptRecord`, with
    constraints from the prompt file, and the number format from
    `resolveNumberFormat` for the session's locale. Those are the sources the
    server already has, and they keep mid-stage and final records identical
    in shape.
  - **Trust is the same as for individual prompts.** Every record comes from
    participants' browsers or from the text they edited, so high-trust
    analysis recomputes from `entry` with the host's own number format,
    exactly as above.
- **Validity.** Here validity describes the group's current answer, which is
  what a group's submit gate needs. So `numericResponse` is an exception to
  #668's player-scoped rule. Constraints on a shared numeric prompt are
  legal, and so are references to `shared.prompt.<name>.isValid`. Any
  member's edit changes that flag, and a condition on it steers the whole
  group, so #668's advisory caveat applies to every member at once. #694
  proposes the same exception for shared open responses.
- **Concurrent typing.** The editor merges edits character by character, so
  two participants typing at once can produce a number neither typed.
  Presence rings show when someone else is in the field, which makes this
  rare. It's an accepted limitation, documented for researchers. An ownership
  model could come later.

## Rejected

- **A `valueType` mode on `openResponse`.** The field-meaning problem above.
- **A pill for the feedback.** Stagebook's counter is plain text, and
  Stagebook exports no pill or warning style. Matching the runner's "Shared"
  chip would mean restyling the counter too, and adding success and warning
  border tokens.
- **Blocking `-` or `.` by constraint, or capping like maxLength.** Each
  changes the number silently, as shown above.
- **Checking every keystroke strictly.** Flagging whatever is invalid right
  now shows "3 is less than 18" at the first digit of 35, and "finish the
  number" after a lone `-`.
- **`value` only when valid.** Keeping out-of-range numbers out of `value`
  would protect calculations that don't check `isValid`. But it would make
  `value` mean something different here than for text, and it wouldn't
  guarantee validity either, since stages can end before the participant
  fixes an answer.
- **Flagging the grouping separator.** It would catch `1,5` typed by someone
  used to decimal commas. But in `en`, a comma in a number is overwhelmingly
  a thousands separator, and refusing it lets `1,000` through with no
  message at all.
- **Formatting as the participant types.** Inserting grouping separators
  would rewrite what the participant typed, which openResponse never does.
  It also causes problems:
  - it moves the caret, and makes deleting next to a separator unreliable;
  - it usually clears the browser's undo history;
  - it confuses screen readers and voice control.

  Grouping conventions also differ by locale: `1,000`, `1.000`, `1 000`,
  `12,34,567`.

- **Parsing with `Intl`.** It can't parse, and it varies by browser version.
- **A unit selector (kg/lb).** Letting the participant choose a unit is a
  different feature. It's out of scope.
- **A numeric mode on `renderSharedNotepad`.** A host that doesn't implement
  the mode would ignore it without any error, render free text, and save a
  string `value`. A separate slot makes a missing implementation visible.
- **Latest-save-wins for shared numbers.** Saving the whole answer on each
  commit, as shared sliders do, would never merge two entries into a new
  number. But it would lose presence, and it would add a second
  shared-editing model next to the collaborative editor that shared notepads
  already use.

## Consequences

The new type touches:

- the discriminated union and the section-count rule in `promptFile.ts`;
- the switch in `Prompt.tsx`;
- the provider contract, which gains the optional `renderSharedNumericResponse`
  slot and its config, along with the unsupported-host state;
- the shared commit path (#697): the commit timer extracted from TextArea into
  a shared hook, the `onLocalEdit` and `onBlur` callbacks on both shared
  slots, and a React-free `buildPromptRecord` for the host's stage-end write;
- the viewer, whose shared-notepad stand-in (#591) needs a single-line
  numeric counterpart for the new slot;
- the main `stagebook` entry. It must export these without a React
  dependency, because the runner's server writes shared records:
  - the parser;
  - the validity and "could still become valid" checks;
  - `resolveNumberFormat(locale, overrides)`, which normalizes, falls back
    and merges exactly as `resolveCatalog` does;
- the runner, which doesn't pass `locale` to the provider today
  (talkbench/runner#1016). The server and the client must resolve the same
  number format;
- `Element.tsx`, which today passes Prompt only `value`, and must also pass
  `entry` so an unfinished entry is restored on reload;
- `resolveCatalog`, which merges top-level keys today and must merge and
  validate `numberFormat` field by field;
- `unsatisfiableConditions`, which must not treat `min` and `max` as the
  range of `value`, as it does for the slider;
- the researcher docs, which must carry the caveat above;
- the message catalog: the `numberFormat` entry, plus guidance and problem
  strings, in `en` and `he`;
- the localization review checklist's bidi item, which gains `prefix` and
  `suffix`;
- saved records, which gain `entry` and `numberFormat`, so hosts that
  allowlist record fields must add them.

Tests:

- The parser, the validity function, and the "could still become valid"
  check are pure functions with table-driven unit tests.
- The a11y gate adds the field in its neutral, valid, problem, and pulse
  states, with and without labels, and measures the warning text.
- An RTL component test pins the order of `-2.5`, `°C`, and signed numbers
  in guidance.

When a decimal-comma locale is added, dropping its grouping separator (`.`)
must be reviewed, because a participant used to the other convention could
type `1.5` meaning 1.5. Catalogs are keyed by primary language, so regional
conventions within a language (`de-CH`, for example) can't be expressed as
catalog data yet.
