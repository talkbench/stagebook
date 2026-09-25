# Prompt validation is advisory; conditions enforce it

Status: proposed in [#668](https://github.com/talkbench/stagebook/issues/668).

Prompt frontmatter declares response constraints, and Stagebook reports
whether each committed response satisfies them. It never blocks submission.
Prompt saves the result as `isValid` beside `value`, and a study designer who
wants enforcement writes an ordinary condition on that flag instead of
restating the constraints. Before this, `minLength: 50` drove the counter,
and a study that gated on it also had to write `hasLengthAtLeast: 50` on its
submit button. The two copies could drift.

## Constraints

`required` (default `false`) is available on `multipleChoice`, `dropdown`,
`slider`, and `openResponse`.

- `listSorter` doesn't accept it. The starting order is a legitimate answer,
  but nothing saves until a drag, so "required" would mean "must drag".
- `noResponse` has no response to require.
- The strict per-type schemas reject the key on both.
- A `dropdown` with `required: true` must also declare a `placeholder`.
  Without one, Prompt saves the first option as soon as the dropdown mounts,
  and the requirement would be met before the participant did anything.

`openResponse` keeps `minLength` and `maxLength` with their existing UTF-16
code-unit count, typing cap, and overflow pulse
([#333](https://github.com/talkbench/stagebook/issues/333)). `minLength: 0`
means no minimum, as it does today. #299 proposes counting its `length` in
code points and tracks aligning the two units; this decision keeps the
counter's unit.

Validation covers player-scoped prompts only. A `shared: true` prompt element
of any type whose file declares any of these constraints is an authoring
error, and a reference to `shared.prompt.<name>.isValid` is an error too.
There are two reasons:

- The host renders shared open responses, and never sees the constraints. They
  would otherwise be ignored silently, as `minLength` and `maxLength` are
  today.
- Any group member can change a shared answer, so its validity describes
  nobody's response in particular.

No study has needed this yet. The prompt-file rule spans the treatment and
the prompt file, so it follows the `localeConsistency` pattern and is wired
into both the CLI and `validateTreatmentDiff`.

## One validity function

A single pure function, exported from `stagebook` with no React dependency,
decides validity:

- A response is **blank** when it is `undefined`, an empty array, or a string
  that `String.prototype.trim()` reduces to `""`. That covers Unicode
  whitespace such as a no-break space, identically in every engine. `0` and
  `false` aren't blank.
- A blank response is valid unless the prompt is `required`. Length
  constraints don't apply to a blank optional answer.
- A non-blank `openResponse` is valid when its untrimmed length is within
  `[minLength, maxLength]`, inclusive, counted exactly as the counter counts.
- A non-blank response of any other type is valid.

The TextArea counter and Prompt's saved flag both call this function, so the
participant's feedback and the designer's gate apply the same rules. They run
at different moments. The counter reads the live text, while `isValid` is
computed at each commit
([response commits](2026-09-response-commits.md)). The flag can therefore
trail the counter by up to one commit window.

## The saved flag and the condition idioms

Prompt writes `isValid` into every player-scoped record it saves, on every
save path. That includes the dropdown's first-option save on mount. `value`
keeps its meaning: a too-short text answer is still saved as text. Typed
values, where an invalid entry might omit `value`, are left to numeric entry
([#687](https://github.com/talkbench/stagebook/issues/687)).

A prompt the participant hasn't interacted with has no record, and so no
`isValid`. Leaving a text field counts as an interaction: it saves the text,
even when that is `""`. Designers choose the idiom by intent:

```yaml
- type: submitButton
  conditions:
    all:
      # Answered, and it passes.
      - reference: self.prompt.essay.isValid
        comparator: equals
        value: true
      # Optional, but anything entered must pass.
      - any:
          - reference: self.prompt.comments.isValid
            comparator: doesNotExist
          - reference: self.prompt.comments.isValid
            comparator: equals
            value: true
```

`equals: true` waits for an answer. The optional idiom spells out absence
with `doesNotExist` instead of writing `doesNotEqual: false`. Today a negative
comparator is satisfied by an absent value
([#348](https://github.com/talkbench/stagebook/issues/348)), but
[#299](https://github.com/talkbench/stagebook/issues/299) makes it Missing, so
the shorter form would stop passing on an untouched prompt. The spelled-out
form means the same thing under both rules.

`all` and `any` combine several prompts, so rules spanning prompts stay in
conditions, and a prompt file never names the prompts around it. A gate using
`equals: true` on a prompt that a condition can hide never passes, as an
`exists` gate doesn't today. The researcher docs warn about this.
`0.prompt.<name>.isValid` and `all.prompt.<name>.isValid` read other
participants' flags. They carry the same trust as reading their `value`,
which cross-client conditions already do.

`required` on its own is a display affordance. A prompt can show the
required marker on a stage whose submit button doesn't check it; enforcement
is the designer's decision, and the validator doesn't warn about it.

## Participant feedback

Validation state is normal response behavior, not a failure
([error callout](2026-09-error-callout.md)). It never uses `ErrorCallout`,
`role="alert"`, danger styling, or, in this version, `aria-invalid`. An
untouched field must never look wrong.

A required prompt shows the word "Required", from the message catalog in
`en` and `he`, on its own line between the prompt body and the control.

- **A word, not an asterisk.** An asterisk needs a legend that a
  self-contained prompt file can't rely on.
- **Muted.** It uses the counter's muted color, not danger styling.
- **Static.** It doesn't change when the participant answers, because it
  describes the question, not the answer. Removing it would shift the layout
  under the participant, and bring it back if they cleared their answer. It
  would also diverge from `aria-required`, which doesn't change, and give
  different participants different feedback.
- **Only when required.** A prompt without `required: true` shows no marker.
  Marking optional prompts instead isn't supported, because a prompt file
  doesn't know which other prompts share its stage.
- **Accessible.** Controls whose role supports it get `aria-required="true"`:
  the textarea, the `radiogroup`, and the native `<select>`. The slider
  (`input[type=range]`) and the checkbox `group` don't support that
  attribute, so the marker is associated with them through
  `aria-describedby`.

Length guidance remains the counter, visible before interaction. Its numbers
carry the state, so color is redundant, and it isn't a live region. Its states
don't change, with one exception. Whitespace-only text no longer turns it
green, because that text is blank. A counter with only a maximum still never
turns green. A blank optional prompt keeps the muted counter even though its
`isValid` is true: the counter shows progress toward the length, not whether
the prompt passes.

## Rejected

**Checking at the moment of submission.** Showing errors and moving focus
when the participant clicks submit, or asking "you skipped Q3, continue
anyway?", needs a stage-level registry of mounted prompts. The response-commits
decision deliberately has none. It would also have to decide which submission
paths to intercept:

- the submit button
- the stage timer
- stage conditions
- `mediaPlayer.submitOnComplete`
- Qualtrics completion
- stages the host ends itself

Only the button could reasonably wait, and a submit button with its own
`enabled:` conditions may cover that later. Either could be built on
`isValid`.

**Automatic blocking.** Letting declared constraints block submission would
change the behavior of existing studies that set `minLength` for guidance
only. It would also remove the designer's choice, which matters for research:
forced responses change dropout and answer quality, and many review boards
require that participants can decline a question.

**`pattern:` and custom rules.** Conditions already check a pattern with
`matches` on the prompt's `value`, so a frontmatter copy would duplicate it.
The only gain would be participant feedback, which would need author-written
messages, and no study has needed one yet.

## Consequences

**`isValid` is advisory client state.** The participant's browser writes it,
like `value`. A condition on it steers that participant's flow; it doesn't
guarantee anything about stored data. A participant can alter the flag, and a
gate decided on an earlier commit doesn't recheck at the click. Payment,
eligibility, exclusion, and analysis should recompute validity from `value`
and the prompt file with the exported function.

**Record shape.** Every player-scoped prompt record gains an `isValid` field.
There's no new storage key, scope, or host API. Hosts that allowlist record
fields must add it.

**Docs.** The researcher docs replace "`minLength` must be enforced
separately via conditions" with the two idioms above.

**Later extensions.** Numeric entry
([#687](https://github.com/talkbench/stagebook/issues/687)) extends the
validity function with parsing, range, and integer checks. It also decides
what `value` holds for an invalid entry. A later minimum or maximum selection
count on multi-select would extend the same function.
