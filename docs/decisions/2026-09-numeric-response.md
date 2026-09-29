# Numeric responses are their own prompt type

Status: proposed in [#687](https://github.com/talkbench/stagebook/issues/687).
Builds on [prompt validation](2026-09-prompt-validation.md) (#668).

A `numericResponse` prompt lets a participant type a number. The prompt
parses the entry and saves a **number** in `value`, so #299 expressions and
#674 derived values can use it without coercing strings. It follows
openResponse wherever it can, so participants and researchers meet one
pattern, and differs only where numbers need it.

This ADR records what should happen and why. How it's built is left to the
implementing issues: #687, #697, and talkbench/runner#1015, whose acceptance
criteria carry the mechanics and tests.

## A separate prompt type

`numericResponse` is its own type, not a `valueType` mode on `openResponse`.
A mode would make `rows`, `minLength` and `maxLength` legal only for text,
and `min`, `max` and `integer` legal only for numbers, so a field would change
meaning by value (Principle 4). As its own type, its schema decides which
fields apply, and downstream type checks can rely on "this prompt's `value`
is a number".

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
  optional.
- **Bounds decide validity, not what's saved.** `min` and `max` are inclusive
  bounds that `isValid` checks. An out-of-range answer is still saved and
  marked invalid, as a too-short text answer is under `minLength`. This
  differs from the slider, whose bounds limit the value itself.
- **Every declared range must be answerable.** Bounds must be finite, and
  `min` must not exceed `max`. With `integer: true`, bounds must be whole.
  Each bound must be writable as a valid entry under the rules below, within
  the length limit and the 15-significant-digit limit. Because bounds are
  inclusive, the bound itself is then always an answer someone can type.
- **No placeholder.** The file has two sections, like `noResponse`, because
  an example value would anchor answers. That's the same reason the slider
  shows no thumb before selection.
- **Shared prompts are supported** (see below).

## The field matches openResponse

It's a single-line text field, full width, with openResponse's look and
measurement behavior:

- paste is blocked and recorded;
- typing telemetry is recorded;
- answers are saved on the same schedule
  ([response commits](2026-09-response-commits.md)).

Drag-and-drop is blocked and recorded too. That's new, and TextArea should
match it (#691). The #668 "Required" marker applies unchanged, and the prompt
body names the field for assistive technology.

- **Not the browser's number input.** It accepts `e`, adds spinners, can
  change value on scroll, and parses differently in each browser.
- **Keyboard.** Phones offer a numeric keypad only when it has every key the
  answer might need. On iOS the numeric keypad has no minus key, and the
  decimal keypad shows the phone region's separator, not the study's.
- **Direction.** The number always reads left to right, even in an RTL study.

## Keystrokes never change what a number means

The field refuses only characters that can't change a number's value under
the study locale's conventions. Digits, a minus sign, and the locale's
decimal separator are always accepted, whatever the constraints. Everything
else is refused with the counter's pulse, including the locale's grouping
separator. So in `en`, typing `1,000` gives 1000. The accepted cost is that
someone used to decimal commas who types `1,5` gets 15.

The maxLength cap can refuse keystrokes safely, because what remains is still
the start of the participant's text. Refusing a character in a number
produces a _different_ number: blocking `-` turns −3 into 3, blocking `.` in
whole-number mode turns 1.5 into 15, and capping at a maximum of 20 turns 25
into 2. Each would be saved as a valid answer, and nobody would notice. So
constraints are never enforced by refusing keystrokes; the feedback reports
them instead.

Entries are limited to 100 characters, and anything longer is not a number.
Parsing must be safe on any input.

## Feedback shows a problem once more typing can't fix it

The field is checked as the participant types. The check asks whether typing
more could still make the entry valid:

- **Valid and non-blank:** the guidance turns green, with a ✓.
- **Can't become valid by typing more:** the problem shows at once. Examples:
  25 with a maximum of 20, 1.5 when only whole numbers are allowed, `3-4`,
  and `-` when the minimum is 1.
- **Could still become valid:** the guidance stays neutral until the
  participant leaves the field. Examples: 3 on the way to 35 when the minimum
  is 18, a lone `-` when negatives are allowed, and `5.`.
- **After leaving the field:** a non-blank invalid entry shows its problem,
  until the participant's own next edit.
- **Blank:** muted guidance, never green and never a problem. This matches
  #668's counter, which shows progress, not permission.
- **Restored on reload:** an invalid entry shows its problem, as if the
  participant had just left the field. A restored entry keeps the number
  format it was saved with until the participant edits it.

The feedback is plain text below the field, at the end, styled like the
counter: muted guidance ("Whole number from 18 to 99"), green with ✓ when
valid, and the warning color with ⓘ for a problem ("25 is more than 20").
Problems quote the parsed number, not the raw text. As #668 decided,
validation is advisory: the field is never marked invalid for assistive
technology, and nothing is announced as an alert.

## Parsing and locale

- **What counts as a number.** An optional minus sign, then digits with at
  most one decimal separator. Exponents, grouping, hex, and non-Western
  digits are not numbers in this version.
- **No silent rounding.** An entry with more than 15 significant digits, the
  most a JavaScript number keeps exactly, is a problem, not a rounded
  number. Frontmatter bounds are YAML numbers, so they're rounded when the
  file is parsed, as the slider's bounds are. That's an accepted limitation.
- **Separators come from the locale.** The decimal and grouping separators
  come from the study locale's message catalog, selected by the locale the
  host gives the provider. The validator already ties that locale to each
  prompt's declared `locale`. So adding a decimal-comma locale is catalog
  data, not a parser change.
  - Parsing does not use the browser's `Intl`. It has no parser, and its
    locale data varies between browser versions. Every participant's browser
    must behave identically, which is also why the counter counts UTF-16
    code units.
  - A host can override the separators. An override that could make parsing
    ambiguous is rejected with a warning, and the bundled format is used.
- **Numbers in guidance are written the way they're typed,** and read
  correctly in RTL.

## Saved record

`value` holds the participant's answer in the prompt's type, as it does for
text, and `isValid` says whether that answer meets the constraints.

- **The entry parses:** `value` is that number, in range or not. For
  example, 25 with a maximum of 20 saves `value: 25, isValid: false`.
- **Blank, unfinished, or not a number:** there is no `value`. So a cleared
  entry never becomes 0, and `3-4` is Missing to #299.
- **`entry`** keeps the raw text, so an unfinished entry comes back on reload
  and appears in the data.
- **`numberFormat`** records the separators it was parsed with, since a host
  override isn't otherwise in the data.
- **Never stale.** `value` always follows the current entry, so a changed or
  cleared answer never leaves an old number behind.

Calculations use an out-of-range `value` unless they check `isValid`, just as
they use a too-short text answer; that's the price of keeping the two
independent. #668's caveat therefore applies with extra force. Gating the
submit button on `isValid` keeps participants to valid answers but can't
guarantee one. In stages that can end any other way, check `isValid` in
derived values. Only recomputing in analysis guarantees validity.

Recomputing starts from `entry`, not `value`: a blank optional answer and
`3-4` both lack a `value`, but only the first is valid. The participant's
browser wrote the whole record. So a host that must trust an answer
recomputes `value` and `isValid` from `entry` with its own configured number
format, and uses the saved `numberFormat` only as a cross-check. For the same
reason, #299 checks at runtime that `value` is a number.

## Unit labels

`prefix` and `suffix` are optional labels inside the field, at its start and
end in reading order, so in RTL a suffix sits on the left. Both exist because
unit position depends on the unit and the locale. Units of measure usually
follow the number. Currency comes first in `en-US` (`$5`) and last in French
or German (`5 €`), and some answers need both (`$` … `per year`). Labels next
to the field are established survey practice for getting answers in the
intended unit.

- **The author's text, as written.** Labels are plain text in the prompt
  file's own language, a single line of at most 32 characters. Stagebook
  keeps the author's character order, so `°C` never renders as `C°` in an
  RTL study.
- **Part of the field's description,** so a screen reader announces
  "35, years".
- **Labels never crowd out the number.** At any width they give way: they
  wrap and are never truncated, and the field always keeps room to type.
  With a full-width field, a suffix sits far from a short number; that's the
  cost of keeping openResponse's footprint.

## Shared numeric responses

A `shared: true` numeric prompt is one answer for the whole group, entered
through the host's collaborative editor, as a shared open response is. It
ships with the rest of this type, with no interim phase.

- **Its own host slot.** The host renders the field through a new, optional
  slot, not a mode on the shared-notepad slot. A host that hasn't
  implemented it shows a clear "can't be shown here" state and reports a
  contract violation. It never falls back to a free-text notepad, which
  would save a string `value`.
- **Stagebook keeps the rules.** Stagebook gives the host everything the
  rules need: the constraints, labels, number format, keystroke rule, and
  feedback, all from Stagebook's own logic. The host renders them and
  doesn't reimplement them, so there's one source of truth. Stagebook still
  renders the prompt body and the Required marker.
- **The participant who edits saves, through Stagebook** (#697). Each
  participant's own edits are saved on the open-response schedule by
  Stagebook's commit path. Idle participants don't write, and the host
  supplies only the text.
  - **Requirement: the saved record catches up.** After editing stops, the
    shared record must reflect the merged text within the normal save
    schedule. That includes edits that merge in late or out of order.
  - **Requirement: one shape.** The host's stage-end write is the final
    snapshot, built with Stagebook's logic, so mid-stage and final records
    have the same shape.
- **Trust is the same as for individual prompts.** Every record comes from
  participants' browsers or the text they edited. High-trust analysis
  recomputes from `entry` with the host's own number format.
- **Validity is the group's.** It describes the group's current answer,
  which is what a group's submit gate needs. So `numericResponse` is an
  exception to #668's player-scoped rule. Constraints on a shared numeric
  prompt are legal, and so are references to `shared.prompt.<name>.isValid`.
  Any member's edit changes that flag, and a condition on it steers the
  whole group, so #668's caveat applies to every member at once. #694
  proposes the same exception for shared open responses.
- **Keystrokes and paste.** The keystroke rule applies to each participant's
  own typing. Paste and drop are blocked. Typing telemetry for shared fields
  is future work covering all shared notepads (talkbench/runner#1014).
- **Feedback follows each participant's own focus,** with no special case
  for watching someone else type. Only a participant's own edit clears a
  problem they saw after leaving the field.
- **Layout.** The feedback and the host's Shared chip share one row below
  the field. The chip sits at the far end, so it doesn't move as the
  feedback changes length, and the feedback stays readable over the presence
  rings.
- **Concurrent typing** merges character by character, so two participants
  typing at once can produce a number neither typed. Presence rings make
  this rare. It's an accepted limitation, documented for researchers; an
  ownership model could come later.

## Rejected

- **A `valueType` mode on `openResponse`.** The field-meaning problem above.
- **A pill for the feedback.** Stagebook's counter is plain text, and
  Stagebook exports no pill or warning style. Matching the runner's "Shared"
  chip would mean restyling the counter as well.
- **Refusing keystrokes by constraint, or capping like maxLength.** Each
  changes the number silently, as shown above.
- **Checking every keystroke strictly.** It would show "3 is less than 18"
  at the first digit of 35.
- **`value` only when valid.** It would protect calculations that don't check
  `isValid`. But it would make `value` mean something different here than
  for text, and it wouldn't guarantee validity either, since stages can end
  before an answer is fixed.
- **Flagging the grouping separator.** It would catch `1,5` from someone
  used to decimal commas. But in `en`, a comma in a number is overwhelmingly
  a thousands separator, and refusing it lets `1,000` through with no
  message at all.
- **Formatting as the participant types.** It would rewrite what the
  participant typed, which openResponse never does. It also disrupts the
  caret, undo, screen readers and voice control. Grouping conventions differ
  by locale too (`1,000`, `1.000`, `1 000`, `12,34,567`).
- **Parsing with `Intl`.** It can't parse, and it varies by browser version.
- **A unit selector (kg/lb).** A different feature, out of scope.
- **A numeric mode on the shared-notepad slot.** A host that doesn't support
  the mode would silently render free text and save a string `value`.
- **Latest-save-wins for shared numbers.** It would never merge two entries
  into a new number. But it would lose presence, and it would add a second
  shared-editing model beside the collaborative editor shared notepads
  already use.
- **Server-side mid-stage writes for shared prompts.** They'd need new
  plumbing from the collaborative editor to the runner, for the same load as
  having the participant who edits save.

## Consequences

- **The prompt-file schema and Prompt** gain the new type.
- **The host contract** gains the shared numeric slot and the shared commit
  path (#697), which serves shared notepads too.
- **Stagebook exports its logic without React**, because the runner's server
  writes shared records: parsing, validity, number-format resolution, and
  record building.
- **The runner must pass the study's locale to the provider**
  (talkbench/runner#1016), so the server and the browsers agree on the
  number format.
- **Saved records gain `entry` and `numberFormat`.** Hosts that allowlist
  record fields must add them.
- **The dead-gate check** must not treat `min` and `max` as the range of
  `value`, as it does for the slider.
- **The message catalogs (`en`, `he`) and the researcher docs** gain the new
  strings, the caveat, and the concurrent-typing limitation.
- **Future locales.** Adding a decimal-comma locale means reviewing the
  grouping-separator rule, because someone used to the other convention
  could type `1.5` meaning 1.5. Catalogs are keyed by primary language, so
  regional conventions within a language (`de-CH`) can't be expressed yet.
