# Missing answers in conditions: worked cases

Companion to [Conditions decide on the answers they have, and waiting is explicit](2026-10-missing-answers-in-conditions.md). The ADR is authoritative; this file checks its rules against cases.

Each case is a condition or score adapted from a real study, the researcher docs, or an earlier design issue. Study examples are anonymized. For each case, the expected behavior is what the researcher wants at each moment, independent of any rule set.

The case IDs are stable, because the evaluator's table-driven tests reference them. These cases illustrate the rules; they don't replace per-operator tests of the #299 dictionary.

## The rules, in brief

Summarized from the ADR. Cases cite them by number.

1. **Missing.** A value is missing when:
   - nothing is stored;
   - a prompt answer is blank by #668's definition (`""`, whitespace only, or `[]`);
   - a `numericResponse` saved no `value`;
   - it is a literal `null`;
   - it has the wrong type (reported; #690, decision 1);
   - a calculation can't produce a finite number.
2. **Comparisons.** A missing value doesn't equal, exceed, include or match anything, including another missing value. So every comparison with one is false, and its negation is true. This holds for leaves and operators alike, as NaN does in every programming language. `allUnique` requires every value to be present. `null` in a leaf's `value` is a validation error.
3. **True/false positions.** Wherever a true/false is needed (a `conditions:` root, `all` / `any` / `none`, `countTrue`, a `case` rule's `when`), a missing value counts as not true. There's no "unknown". The per-seat list from an `everyone.` leaf (rule 6) is one input to a quantifier, not one true/false.
4. **Calculations** (`sum`, `average`, `product`, `min`, `max`, `subtract`, `divide`, `length`) are missing if an input they need is missing. A `case` is missing only when the rule it picks has a missing `value`, or no rule matches and there's no default. The escape hatches are written out:
   - `sumExisting`, `averageExisting`, `minExisting` and `maxExisting` drop missing inputs. `atLeast` sets the minimum number of present inputs, defaulting to 1; below it the result is missing.
   - `firstExisting` takes the first answered operand in the order listed, so a trailing literal works as a default.

   **Counts never wait.** `countExisting` counts the present values, `countTrue` the true ones, and `countUnique` the distinct present ones. They never return missing, and each is 0 when nothing counts. The `exists` and `doesNotExist` leaves are the presence primitives; there's no `allExist`.

5. **Waiting is explicit.** To hold something back until people have answered, say so with `exists` or `doesNotExist`, or state the condition positively.
6. **Groups.** `everyone.<ref>` is a list with one entry per seat, in seat order. A leaf on `everyone.` gives one true/false per seat. `all`, `any`, `none` or `countTrue` must consume that list, for example `all: {reference: everyone.prompt.x.value, comparator: exists}` for "everyone answered". A bare `everyone.` leaf, or one inside an operand list, is a validation error, with a hint to wrap it.
7. **Text.** Equality and membership (`equals`, `isOneOf`, `includes`, `allEqual`, `allUnique`, `countUnique`) compare text after trimming it (the same whitespace as #668's blank test) and lowercasing it. `matches`, `length` and `hasLength*` use the raw string. Internal whitespace isn't collapsed. Stored data is never changed.
8. **Negation versus the opposite comparator.** The negative comparators (`doesNotEqual`, `doesNotInclude`, `doesNotMatch`, `isNotOneOf`), and `none` around a positive comparison, are true when there's no answer. The numeric pairs (`isAbove` / `isAtMost`, `isBelow` / `isAtLeast`) are both positive claims, and both need an answer. So `none: [isBelow 5]` differs from `isAtLeast 5` only for a missing answer.

## How to read a case

- **Expected** is the intended behavior. Every Expected value has been confirmed, or follows from a confirmed rule.
- **Today** is what Stagebook 0.32 does, computed by running each case through its evaluator (`evaluateConditions`, or `makeEligibilityTable` for D1).
  - Cases written in legacy syntax use their closest current spelling.
  - C1 and C2 can't be expressed in Stagebook 0.32, so they show the legacy platform instead.
  - — means Stagebook 0.32 can't express the case.
- **New** is what the rules above produce. Where a case has to be written differently under them, both spellings are shown.
- ⚠ marks a result that differs from Expected.
- **M** means no answer.

## Index

| Case | Asks                                                       | Today                                     | New                                         |
| ---- | ---------------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| A1   | Continue once answered                                     | ✓                                         | ✓                                           |
| A2   | Minimum length before continuing                           | ⚠ 300 spaces pass                         | ✓                                           |
| A3   | Practice feedback on a multi-select                        | ✓                                         | ✓                                           |
| A4   | A number compared with a text choice                       | ✓ (numeric strings are converted)         | validation error by design                  |
| A5   | Fallback unless "Yes", on the same page                    | ⚠ free-text "yes "                        | ✓                                           |
| A6   | Optional comment with a length limit                       | ✓                                         | ✓                                           |
| A7   | Timeline selection accuracy                                | ✓                                         | ✓                                           |
| A8   | Tracked link visited                                       | ✓                                         | ✓                                           |
| B1   | Skip a stage based on earlier answers                      | ✓                                         | ✓                                           |
| B2   | End a stage when something arrives                         | ⚠ the `none:` form advances at load       | ✓                                           |
| C1   | Labels match, shown in a later stage                       | — (legacy platform ⚠ when nobody answers) | ✓                                           |
| C2   | Negotiation: everyone agrees on the deal                   | — (legacy platform ✓)                     | ✓ with `numericResponse` payoffs            |
| C3   | Guessing-game turns inside one stage                       | ✓ with `all.` leaves                      | ✓                                           |
| C4   | Follow-up discussion or not (#348)                         | ✓                                         | ✓                                           |
| C5   | At least 4 of 6 said Yes                                   | —                                         | ✓                                           |
| C6   | "Group complete if nobody rated above 50" (#235)           | ✓                                         | ⚠ block 1; ✓ block 2, which states the wait |
| C7   | Group total reaches a goal                                 | —                                         | ✓ (both readings)                           |
| C8   | A new match: the same answer, not already used for a match | —                                         | ✓                                           |
| C9   | A running score: 10 points per matching round              | —                                         | ✓                                           |
| D1   | Eligibility by role                                        | ⚠ role typed with a capital               | ✓                                           |
| E1   | TIPI extraversion                                          | —                                         | ✓                                           |
| E2   | Scale score from at least 2 of 3 items                     | —                                         | ✓                                           |
| E3   | Whichever branch they answered                             | —                                         | ✓                                           |
| E4   | Recode a score into bands                                  | —                                         | ✓                                           |
| E5   | Calculations and their `…Existing` twins                   | —                                         | ✓                                           |
| F1   | Authoring errors                                           | mixed                                     | ✓                                           |

---

## A. One participant's answer

### A1 · Continue once answered

Source: a study's `continue_together` stage.

```yaml
- type: submitButton
  conditions:
    - reference: self.prompt.continue_together
      comparator: exists
```

| Moment        | Expected | Today  | New    |
| ------------- | -------- | ------ | ------ |
| Not answered  | hidden   | hidden | hidden |
| Answered "No" | shown    | shown  | shown  |

### A2 · Minimum length before continuing

Source: a study's reflection stage (legacy reference without a position).

```yaml
- type: submitButton
  conditions:
    - reference: prompt.reflection
      comparator: hasLengthAtLeast
      value: 300
```

| Moment                                 | Expected | Today   | New                                       |
| -------------------------------------- | -------- | ------- | ----------------------------------------- |
| Untouched                              | hidden   | hidden  | hidden                                    |
| 120 characters                         | hidden   | hidden  | hidden                                    |
| 300 or more characters                 | shown    | shown   | shown                                     |
| 290 characters plus 10 trailing spaces | shown    | shown   | shown (`length` counts the raw text: 300) |
| Typed 300 characters, then cleared     | hidden   | hidden  | hidden (blank)                            |
| 300 spaces                             | hidden   | ⚠ shown | hidden (blank)                            |

### A3 · Practice feedback on a multi-select

Source: a practice item in a classification task. `practiceChoice` is a `select: multiple` prompt, and the right answer is "Red" alone.

```yaml
- type: prompt
  file: practice/correct.prompt.md
  conditions:
    - reference: self.prompt.practiceChoice
      comparator: includes
      value: "Red"
    - reference: self.prompt.practiceChoice
      comparator: hasLengthAtMost
      value: 1
- type: prompt
  file: practice/incorrect.prompt.md
  conditions:
    - reference: self.prompt.practiceChoice
      comparator: hasLengthAtLeast
      value: 1
    - none:
        - all:
            - reference: self.prompt.practiceChoice
              comparator: includes
              value: "Red"
            - reference: self.prompt.practiceChoice
              comparator: hasLengthAtMost
              value: 1
```

| Moment                                  | Expected  | Today     | New             |
| --------------------------------------- | --------- | --------- | --------------- |
| Nothing ticked yet                      | neither   | neither   | neither         |
| Red only                                | correct   | correct   | correct         |
| Red and Blue                            | incorrect | incorrect | incorrect       |
| Blue only                               | incorrect | incorrect | incorrect       |
| Ticked, then unticked everything (`[]`) | neither   | neither   | neither (blank) |

This works today through the #235 operators (v0.9.0) and multi-select membership (#470, v0.18.0). The author guarded the `none:` with "has ticked something", which is the explicit-waiting rule (rule 5) in its positive form.

The last row gives the same result today for a different reason. Today `[]` is an answer: `exists` is true for it, and its length is 0. Under the new rules `[]` is blank, so `exists` is false.

### A4 · A number compared with a text choice

Source: a comprehension check. The options in `comp_count.prompt.md` are `- 1`, `- 2`, `- 4`, `- 8`, which is text mode.

```yaml
- type: prompt
  file: intro/next_step.prompt.md
  conditions:
    - reference: prompt.comp_count
      comparator: equals
      value: 4
```

| Moment     | Expected | Today                                             | New                                                                                                            |
| ---------- | -------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Picked "4" | shown    | shown (the string `"4"` is converted to a number) | **validation error**: the choice saves text. Fix with `value: "4"` or numeric-mode options (#690, decision 5). |
| Picked "2" | hidden   | hidden                                            | hidden (after the fix)                                                                                         |

### A5 · Fallback unless "Yes", on the same page

Source: `docs/researcher/conditions.md`, the #348 pattern.

```yaml
conditions:
  - reference: self.prompt.continue
    comparator: doesNotEqual
    value: "Yes"
```

| Moment                           | Expected                                        | Today   | New                             |
| -------------------------------- | ----------------------------------------------- | ------- | ------------------------------- |
| Not answered yet                 | shown: an unanswered question can't equal "Yes" | shown   | shown                           |
| "Yes"                            | hidden                                          | hidden  | hidden                          |
| "No"                             | shown                                           | shown   | shown                           |
| Typed "yes " (a free-text field) | hidden                                          | ⚠ shown | hidden (trimmed and lowercased) |

### A6 · Optional comment with a length limit

Source: the idiom from the #668 ADR, written with `.value`.

```yaml
- type: submitButton
  conditions:
    any:
      - reference: self.prompt.comments.value
        comparator: doesNotExist
      - reference: self.prompt.comments.value
        comparator: hasLengthAtMost
        value: 200
```

| Moment              | Expected | Today                     | New                            |
| ------------------- | -------- | ------------------------- | ------------------------------ |
| Untouched           | shown    | shown                     | shown                          |
| 150 characters      | shown    | shown                     | shown                          |
| 250 characters      | hidden   | hidden                    | hidden                         |
| Typed, then cleared | shown    | shown (`""` has length 0) | shown (blank counts as absent) |

The guard matters. Written as `hasLengthAtMost: 200` alone, a cleared box is shown today (length 0) and hidden under the new rules, because a blank answer has no length to compare.

### A7 · Timeline selection accuracy

Source: `docs/researcher/conditions.md`, Timeline Selections.

```yaml
- type: submitButton
  conditions:
    - reference: self.timeline.storySegment.0.start
      comparator: isAtLeast
      value: 15
    - reference: self.timeline.storySegment.0.start
      comparator: isAtMost
      value: 19
```

| Moment                         | Expected | Today  | New    |
| ------------------------------ | -------- | ------ | ------ |
| No selection                   | hidden   | hidden | hidden |
| First selection starts at 16 s | shown    | shown  | shown  |
| First selection starts at 22 s | hidden   | hidden | hidden |

The new rules also warn that the type is unknown (#690, decision 2), until timeline records have a schema.

### A8 · Tracked link visited

Source: `docs/researcher/conditions.md`, Tracked Link Events.

```yaml
conditions:
  - reference: self.trackedLink.signup_link.totalTimeAwaySeconds
    comparator: isAbove
    value: 0
```

| Moment                             | Expected | Today  | New    |
| ---------------------------------- | -------- | ------ | ------ |
| Link not clicked                   | hidden   | hidden | hidden |
| Clicked, and returned to the study | shown    | shown  | shown  |

The new rules also warn that the type is unknown, until trackedLink records have a schema.

## B. Stage gates

### B1 · Skip a stage based on earlier answers

Source: a study's optional `followup_discussion` stage (2 players).

```yaml
- name: followup_discussion
  conditions:
    - reference: 0.prompt.continue_together
      comparator: equals
      value: "Yes"
    - reference: 1.prompt.continue_together
      comparator: equals
      value: "Yes"
```

| Moment (at stage start) | Expected | Today | New   |
| ----------------------- | -------- | ----- | ----- |
| Both said Yes           | enter    | enter | enter |
| One said No             | skip     | skip  | skip  |
| One never answered      | skip     | skip  | skip  |
| Neither answered        | skip     | skip  | skip  |

### B2 · End a stage when something arrives

Source: the early-termination pattern in `docs/researcher/conditions.md`. Illustrative, not from a study.

```yaml
- name: discussion
  conditions:
    - reference: shared.prompt.decision.value
      comparator: doesNotExist
```

The same intent, written with `none:`:

```yaml
- name: discussion
  conditions:
    none:
      - reference: shared.prompt.status.value
        comparator: equals
        value: "Done"
```

| Moment                                 | Expected | Today                                                               | New               |
| -------------------------------------- | -------- | ------------------------------------------------------------------- | ----------------- |
| Stage start, nothing recorded          | stay     | `doesNotExist` form: stay. ⚠ `none:` form: **advances immediately** | stay (both forms) |
| Decision recorded / status set to Done | advance  | advance                                                             | advance           |

**Why the `none:` form fails today:**

1. The leaf returns _unknown_: `compare(undefined, "equals", …)` returns `undefined`.
2. `none` passes the unknown up.
3. `evaluateConditions` turns unknown into false.
4. `StageConditionGate` reads false as "advance".

The always-skip lint doesn't catch it, because it skips leaves under `none`. The new rules fix step 1: the leaf is false, so `none` is true.

## C. Groups

### C1 · Labels match, shown in a later stage

Source: two labeling studies (3 players and 2 players), in legacy syntax. The recall stage lasts 30 s, and feedback is the next stage.

```yaml
- name: "feedback ${recallIndex}"
  elements:
    - type: prompt
      file: labels_match.md
      conditions:
        - reference: "prompt.recall_${recallIndex}"
          position: percentAgreement
          comparator: equals
          value: 100
        - reference: "prompt.recall_${recallIndex}"
          position: all
          comparator: hasLengthAtLeast
          value: 1
    - type: prompt
      file: labels_not_match.md
      conditions:
        - reference: "prompt.recall_${recallIndex}"
          position: percentAgreement
          comparator: isBelow
          value: 100
```

With the new rules:

```yaml
- type: prompt
  file: labels_match.md
  conditions:
    allEqual:
      reference: everyone.prompt.recall_1.value
- type: prompt
  file: labels_not_match.md
  conditions:
    none:
      - allEqual:
          reference: everyone.prompt.recall_1.value
```

| Moment                                       | Expected                               | Legacy platform | New                                 |
| -------------------------------------------- | -------------------------------------- | --------------- | ----------------------------------- |
| All typed "red car"                          | match                                  | match           | match                               |
| "red car", "red car", "blue bike"            | not match                              | not match       | not match                           |
| "red car", "blue bike", nothing              | not match                              | not match       | not match                           |
| "red car", "red car", nothing                | not match: a missing label can't match | not match       | not match                           |
| "red car", "red car", typed then cleared     | not match                              | not match       | not match (blank counts as missing) |
| Nobody typed                                 | not match                              | ⚠ neither       | not match                           |
| "Red car", "red car ", "RED CAR"             | match                                  | match           | match (trimmed and lowercased)      |
| "red car", "red car", "red car" (two spaces) | not match, as on the legacy platform   | not match       | not match (internal spaces count)   |

- **Today:** Stagebook 0.32 can't express this, because it has no way to compare participants' answers with each other (`percentAgreement` was removed in #238).
- **Legacy platform** (the previous host, deliberation-empirica's `ConditionalRender.jsx`):
  - `percentAgreement` divides the largest group of matching answers by _all_ participants, so a non-answer counts as disagreement;
  - it returns false for both messages when nobody has answered;
  - it compares answers after `toLowerCase().trim()`.
- **Under three-valued logic** (#299's revision-2 dictionary, never shipped), `allEqual` over `["red car", "red car", M]` would be unknown. Neither message would show, and because the question is closed, neither ever would.
- **The new rules** need no guard: `allEqual` is true only when every label is present and they all match.

### C2 · Negotiation: everyone agrees on the deal

Source: a three-party negotiation study (3 players, same stage, legacy syntax). `dealsheet1` is Yes/No; `dealsheet3`–`5` are open responses for each party's payoff. Under the new rules the payoffs should be `numericResponse` prompts (#687, released in 0.32.0). Those save a number in `value`, and save no `value` when the entry is blank or doesn't parse.

```yaml
- type: submitButton
  buttonText: Submit Now and End Negotiation
  conditions:
    - promptName: dealsheet1
      position: all
      comparator: equals
      value: "Yes"
    - promptName: dealsheet3
      position: percentAgreement
      comparator: equals
      value: 100
    # … the same for dealsheet4 and dealsheet5
    - promptName: dealsheet3
      position: all
      comparator: exists
    # … the same for dealsheet4 and dealsheet5
- type: prompt
  file: 05_nonmatching_inputs1.md
  conditions:
    - promptName: dealsheet1
      position: all
      comparator: exists
    - promptName: dealsheet1
      position: percentAgreement
      comparator: notEqual
      value: 100
```

With the new rules:

```yaml
- type: submitButton
  conditions:
    - all:
        reference: everyone.prompt.dealsheet1.value
        comparator: equals
        value: "Yes"
    - allEqual:
        reference: everyone.prompt.dealsheet3.value
    - allEqual:
        reference: everyone.prompt.dealsheet4.value
    - allEqual:
        reference: everyone.prompt.dealsheet5.value
- type: prompt
  file: 05_nonmatching_inputs1.md
  conditions:
    - all: # wait until everyone has answered
        reference: everyone.prompt.dealsheet1.value
        comparator: exists
    - none:
        - allEqual:
            reference: everyone.prompt.dealsheet1.value
```

| Moment                                                 | Expected                      | Legacy platform           | New                                                                                                                         |
| ------------------------------------------------------ | ----------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Nobody has answered                                    | submit hidden, warning hidden | same                      | same                                                                                                                        |
| Two said Yes, the third hasn't answered; payoffs agree | submit hidden                 | hidden                    | hidden                                                                                                                      |
| All Yes, identical payoffs                             | submit shown                  | shown                     | shown                                                                                                                       |
| All Yes, one payoff differs                            | submit hidden                 | hidden                    | hidden                                                                                                                      |
| All Yes, one hasn't entered payoffs                    | submit hidden                 | hidden                    | hidden                                                                                                                      |
| Payoffs typed as "100" and "100.00"                    | the same deal                 | hidden (compared as text) | shown: both save the number 100. (As open responses they would still differ.)                                               |
| One payoff typed as "100 dollars"                      | submit hidden                 | hidden                    | hidden: it doesn't parse, so no `value` is saved and `allEqual` is false. The participant sees the field's problem message. |
| Two answered dealsheet1 differently, the third not yet | warning hidden                | hidden                    | hidden (the explicit `exists` guard)                                                                                        |
| All answered, not unanimous                            | warning shown                 | shown                     | shown                                                                                                                       |

Stagebook 0.32's closest form of the `dealsheet1` part, `all.prompt.dealsheet1.value` with `equals: "Yes"`, drops participants who haven't answered. So it's true after a single Yes, and the second row would show the button. The new form waits for every seat. Payoff agreement can't be expressed in 0.32 at all.

The submit button needs no guards under the new rules. The warning keeps its `exists` guard, because showing the warning before everyone has answered is a timing choice, which the new rules make explicit. The legacy authors wrote the same guard.

### C3 · Guessing-game turns inside one stage

Source: a guessing-game study (2 players: a describer and a guesser; one 15-minute stage; legacy syntax). Each round uses template fields `index` and `lastIndex`.

```yaml
- type: prompt
  file: answer_incorrect.md
  conditions:
    - reference: "prompt.guess_${index}"
      position: any
      comparator: exists
    - reference: "prompt.guess_${index}"
      position: all
      comparator: doesNotEqual
      value: "${correctAnswer}"
    - reference: "prompt.continue_${index}"
      position: all
      comparator: doesNotExist
```

With the new rules:

```yaml
- type: prompt
  file: answer_incorrect.md
  conditions:
    - any: # someone has guessed
        reference: "everyone.prompt.guess_${index}.value"
        comparator: exists
    - none: # nobody guessed right
        reference: "everyone.prompt.guess_${index}.value"
        comparator: equals
        value: "${correctAnswer}"
    - none: # nobody has continued
        reference: "everyone.prompt.continue_${index}.value"
        comparator: exists
```

| Moment (`answer_incorrect`) | Expected | Today  | New    |
| --------------------------- | -------- | ------ | ------ |
| No guess yet                | hidden   | hidden | hidden |
| Guesser guessed right       | hidden   | hidden | hidden |
| Guesser guessed wrong       | shown    | shown  | shown  |
| The describer has continued | hidden   | hidden | hidden |

**Today** this is written with `all.` leaves, which check every participant who has answered and drop the rest: `all.prompt.guess_${index}.value` with `exists`, the same reference with `doesNotEqual: ${correctAnswer}`, and `all.prompt.continue_${index}.value` with `doesNotExist`.

These don't translate one-for-one. Today's `all.…guess… exists` means "someone has guessed", so it becomes `any:`, not `all:`. Rewritten as `all:`, it would wait for the describer to guess too, which never happens. The legacy `position: any` / `position: all` conditions above, from the previous host, do translate directly into `any:` / `all:` around an `everyone.` leaf.

Under the new rules the two spellings of "someone guessed right" agree:

- `includes: {container: {reference: everyone…}, members: [X]}` over `[M, "wrong"]` is false;
- `any: {reference: everyone…, comparator: equals, value: X}` is false.

In an earlier draft, where leaves decided but operators waited, they differed.

### C4 · Follow-up discussion or not (#348)

Source: the same study as B1, stage `before_followup` (2 players). The question was answered in an earlier stage.

```yaml
- type: prompt
  file: followup/intro.prompt.md
  conditions:
    - all:
        - reference: 0.prompt.continue_together
          comparator: equals
          value: "Yes"
        - reference: 1.prompt.continue_together
          comparator: equals
          value: "Yes"
- type: prompt
  file: followup/none.prompt.md
  conditions:
    - any:
        - reference: 0.prompt.continue_together
          comparator: doesNotEqual
          value: "Yes"
        - reference: 1.prompt.continue_together
          comparator: doesNotEqual
          value: "Yes"
```

An earlier version also listed `doesNotExist` for each seat, as a workaround from before #348 was fixed. Those leaves are omitted here: `doesNotEqual` is already true when an answer is missing, so they add nothing.

| Moment             | Expected       | Today | New  |
| ------------------ | -------------- | ----- | ---- |
| Both Yes           | "follow-up"    | same  | same |
| One No             | "no follow-up" | same  | same |
| One never answered | "no follow-up" | same  | same |
| Neither answered   | "no follow-up" | same  | same |

### C5 · At least 4 of 6 said Yes

Source: illustrative. Not from a study yet.

```yaml
conditions:
  nonDecreasing:
    - 4
    - countTrue:
        reference: everyone.prompt.agree.value
        comparator: equals
        value: "Yes"
```

| Moment              | Expected               | Today | New                     |
| ------------------- | ---------------------- | ----- | ----------------------- |
| Nobody has answered | hidden                 | —     | hidden (the count is 0) |
| 3 Yes, 3 not yet    | hidden                 | —     | hidden                  |
| 4 Yes, 2 not yet    | shown, without waiting | —     | shown                   |
| 4 Yes, 2 No         | shown                  | —     | shown                   |
| 3 Yes, 3 No         | hidden                 | —     | hidden                  |

Under the new rules, plain `countTrue` counts the trues, because a missing value counts as not true, so `countTrueExisting` isn't needed. Counting over an `everyone.` leaf needs neither a list of seats nor #674. #674 remains for tests that combine more than one condition per person.

### C6 · "Group complete if nobody rated above 50" (#235)

Source: the motivating NOR example in #235. Same stage.

Block 1:

```yaml
# "No seat has a rating above 50."
# A seat with no rating isn't above 50, so under the new rules this is
# true before anyone has rated, and the message shows at once.
conditions:
  - none:
      reference: everyone.prompt.rating.value
      comparator: isAbove
      value: 50
```

Block 2, the same intent with the wait stated:

```yaml
# "Every seat has a rating, and each is 50 or less."
# isAtMost needs an answer, so a seat with no rating is false,
# and the message stays hidden until all three have rated.
conditions:
  - all:
      reference: everyone.prompt.rating.value
      comparator: isAtMost
      value: 50
```

| Moment                            | Expected | Today (seats listed) | New, block 1 | New, block 2 |
| --------------------------------- | -------- | -------------------- | ------------ | ------------ |
| Nobody has rated                  | hidden   | hidden               | ⚠ shown      | hidden       |
| All rated 50 or less              | shown    | shown                | shown        | shown        |
| One rated 60                      | hidden   | hidden               | hidden       | hidden       |
| Two rated 50 or less, one not yet | hidden   | hidden               | ⚠ shown      | hidden       |

Stagebook 0.32 has no `everyone.`, so the Today column lists the seats (`none: [0.prompt.rating.value isAbove 50, …]`), and 0.32's three-valued `none` gets this right. Under the new rules, "nobody rated above 50" is literally true before anyone rates (rule 8), so the author states the wait. `all: {… everyone… isAtMost 50}` does that in one line, because each seat needs an answer. **This is a behavior change for any existing study that uses `none` this way** (#690, decision 4).

### C7 · Group total reaches a goal

Source: illustrative, a public-goods-style group goal. Summing over a group list comes from the #299 dictionary (`sum: {reference: all.prompt.points.value}`). Not from a study yet.

Each of three players enters a contribution in a `numericResponse` prompt. A message announces when the group's total reaches 20. There are two readings, and the new rules spell each one differently.

Block 1:

```yaml
# "The contributions entered so far add up to at least 20."
# sumExisting skips seats with no contribution yet, so the
# message can show before everyone has contributed.
conditions:
  - nonIncreasing: # total >= 20
      - sumExisting:
          reference: everyone.prompt.contribution.value
      - 20
```

Block 2:

```yaml
# "Everyone has contributed, and the total is at least 20."
# sum needs every input: while any seat is missing, the total
# is missing, the comparison is false, and the message waits.
conditions:
  - nonIncreasing: # total >= 20
      - sum:
          reference: everyone.prompt.contribution.value
      - 20
```

| Contributions          | Today | Expected, block 1 | New, block 1                        | Expected, block 2 | New, block 2     |
| ---------------------- | ----- | ----------------- | ----------------------------------- | ----------------- | ---------------- |
| Nobody has contributed | —     | hidden            | hidden (nothing to add up: missing) | hidden            | hidden           |
| `[12, M, M]`           | —     | hidden            | hidden (12)                         | hidden            | hidden (missing) |
| `[12, M, 9]`           | —     | shown             | shown (21)                          | hidden            | hidden (missing) |
| `[12, 3, 9]`           | —     | shown             | shown (24)                          | shown             | shown (24)       |
| `[5, 3, 7]`            | —     | hidden            | hidden (15)                         | hidden            | hidden (15)      |
| `[12, cleared, 9]`     | —     | shown             | shown (21; blank counts as missing) | hidden            | hidden (missing) |

Stagebook 0.32 can't add anything up. Under the new rules, the choice between "so far" and "once everyone has contributed" is made by picking `sumExisting` or `sum`. The default `sum` is the cautious one: it waits.

### C8 · A new match: the same answer, not already used for a match

Source: illustrative, extending a labeling study in which a match earns points but labels may be reused. Not from a study yet.

Two players label an image in each round, with answers in `label_<round>`. In round 5, the "new match" message shows when both gave the same label and that label wasn't the matched label in any of rounds 1–4.

```yaml
conditions:
  # This round matched: both answered, and the answers are the same.
  - allEqual:
      reference: everyone.prompt.label_5.value
  # …and no earlier round matched on that same value. Each entry says
  # "both of round k's answers equal this round's answer".
  - none:
      - allEqual:
          - reference: 0.prompt.label_1.value
          - reference: 1.prompt.label_1.value
          - reference: 0.prompt.label_5.value
      - allEqual:
          - reference: 0.prompt.label_2.value
          - reference: 1.prompt.label_2.value
          - reference: 0.prompt.label_5.value
      - allEqual:
          - reference: 0.prompt.label_3.value
          - reference: 1.prompt.label_3.value
          - reference: 0.prompt.label_5.value
      - allEqual:
          - reference: 0.prompt.label_4.value
          - reference: 1.prompt.label_4.value
          - reference: 0.prompt.label_5.value
```

| Round 5                  | Earlier rounds                             | Expected | Today | New                                               |
| ------------------------ | ------------------------------------------ | -------- | ----- | ------------------------------------------------- |
| "lion" / "lion"          | no earlier matches                         | shown    | —     | shown                                             |
| "lion" / "lion"          | round 2 matched on "lion"                  | hidden   | —     | hidden                                            |
| "lion" / "lion"          | round 3 was "lion" / "tiger" (not a match) | shown    | —     | shown: only earlier _matches_ count               |
| "lion" / "lion"          | round 4: one player didn't answer          | shown    | —     | shown: a missing answer can't make a match        |
| "lion" / "lion"          | round 4: neither player answered           | shown    | —     | shown: two missing answers don't match each other |
| "lion" / "tiger"         | —                                          | hidden   | —     | hidden                                            |
| "lion" / (no answer yet) | —                                          | hidden   | —     | hidden                                            |
| "Lion " / "lion"         | round 2 matched on "LION"                  | hidden   | —     | hidden: case and surrounding spaces are ignored   |

**What the case shows:**

- **The three-way `allEqual` does the work.** Once the first condition says this round matched, seat 0's current answer _is_ the matched value. So "round k matched on that value" is just "both of round k's answers equal it".
- **The earlier rounds are listed one by one.** Nothing loops over rounds, and no operator builds a list from computed values, so "not one of the earlier matched values" can't be a single `isNotOneOf` or `includes`. Round k needs k − 1 rows. If the rule only looks back a fixed number of rounds, every round has the same number of rows, and the earlier round numbers can be template fields. A list that builds up across rounds would make this one row per round; that's under consideration in #742.
- **With #674**, a per-round derived value `matched_<k>` (a `case` that is seat 0's label when round k matched, and missing otherwise) turns each row into `allEqual: [{reference: self.derived.matched_2.value}, {reference: 0.prompt.label_5.value}]`. That reads better, but it isn't shorter.

### C9 · A running score: 10 points per matching round

Source: a labeling study (2 players) whose instructions say "If everyone enters the same label for the image, you will earn 10 points". The study shows a message each round; it doesn't keep a total.

A derived value (#674) adds up the points across three rounds. The study can show it, test it in a condition, or use it at export.

```yaml
- type: derived
  name: points
  expression:
    product:
      - 10
      - countTrue: # rounds where both labels match
          - allEqual:
              reference: everyone.prompt.recall_1.value
          - allEqual:
              reference: everyone.prompt.recall_2.value
          - allEqual:
              reference: everyone.prompt.recall_3.value
# read as self.derived.points.value
```

| Moment                          | Labels so far        | Expected | Today | New                                          |
| ------------------------------- | -------------------- | -------- | ----- | -------------------------------------------- |
| Before round 1 is answered      | —                    | 0        | —     | 0                                            |
| Round 1 matched                 | r1: "lion" / "lion"  | 10       | —     | 10                                           |
| Round 2 didn't match            | r2: "lion" / "tiger" | 10       | —     | 10                                           |
| Round 3: one player timed out   | r3: "bear" / (none)  | 10       | —     | 10                                           |
| Round 3 matched, different case | r3: "Bear" / "bear " | 20       | —     | 20 (case and surrounding spaces are ignored) |

- **A round that hasn't been played, or wasn't answered, adds 0.** Its labels are missing, so `allEqual` is false and `countTrue` skips it. The total is therefore always "so far". Under #299's revision-2 dictionary, a missing round would have made the total missing until every round was answered.
- **In a templated study,** where round templates pass `index` and `lastIndex`, the same score can be built one round at a time, so every round's template body is identical:

  ```yaml
  - type: derived
    name: "points_${index}"
    expression:
      sum:
        - reference: "self.derived.points_${lastIndex}.value"
        - case:
            rules:
              - when:
                  allEqual:
                    reference: "everyone.prompt.recall_${index}.value"
                value: 10
              - default: true
                value: 0
  ```

  Round 0 supplies the starting value.

- **To count only finished rounds,** for example to show the score at the start of a round, reference only earlier rounds, or show it in the feedback stage.
- **Showing it** needs a Display that can read a derived value (#674), probably with number formatting (#672). **Paying it** uses #674's `computeDerived` at export. Because labels come from participants' browsers, high-trust analysis recomputes it from the raw labels.

## D. Eligibility

### D1 · Eligibility by role

Source: the dispatch contract harness (`dispatch/contract.ts`).

```yaml
groupComposition:
  - position: 0
    conditions:
      - reference: self.prompt.role
        comparator: equals
        value: a
```

| Moment                                                | Expected     | Today          | New                   |
| ----------------------------------------------------- | ------------ | -------------- | --------------------- |
| Answered "a"                                          | eligible     | eligible       | eligible              |
| Answered "A"                                          | eligible     | ⚠ not eligible | eligible (lowercased) |
| Answered "b"                                          | not eligible | not eligible   | not eligible          |
| Never answered                                        | not eligible | not eligible   | not eligible          |
| Negative variant `doesNotEqual: a`, never answered    | eligible     | eligible       | eligible              |
| Negative variant `isNotOneOf: [a, c]`, never answered | eligible     | eligible       | eligible              |

## E. Scores and calculations (#674)

### E1 · TIPI extraversion

Source: the #299 dictionary and #674.

```yaml
average:
  - reference: self.prompt.tipi_q1.value
  - subtract:
      from: 8
      value:
        reference: self.prompt.tipi_q6.value
```

| Moment                                 | Expected                       | Today | New                                                                       |
| -------------------------------------- | ------------------------------ | ----- | ------------------------------------------------------------------------- |
| q1 = 5, q6 = 2                         | 5.5                            | —     | 5.5                                                                       |
| q6 unanswered                          | no score (M)                   | —     | M                                                                         |
| q1 stored as the text "5" (a host bug) | no score, and the bug reported | —     | M, and a `typeMismatch` contract violation is reported (#690, decision 1) |

### E2 · Scale score from at least 2 of 3 items

A standard questionnaire-scoring rule.

```yaml
averageExisting:
  inputs:
    - reference: self.prompt.q1.value
    - reference: self.prompt.q2.value
    - reference: self.prompt.q3.value
  atLeast: 2
```

| Moment  | Expected | Today | New                 |
| ------- | -------- | ----- | ------------------- |
| 6, 4, 2 | 4        | —     | 4                   |
| 6, M, 2 | 4        | —     | 4                   |
| 6, M, M | no score | —     | M (below `atLeast`) |
| M, M, M | no score | —     | M                   |

### E3 · Whichever branch they answered

Source: the #278 use cases.

```yaml
firstExisting:
  - reference: self.prompt.routeA_answer.value
  - reference: self.prompt.routeB_answer.value
```

| Moment                           | Expected                                                                   | Today | New                          |
| -------------------------------- | -------------------------------------------------------------------------- | ----- | ---------------------------- |
| Only B answered                  | B's answer                                                                 | —     | B's answer                   |
| Both answered                    | A's: `firstExisting` takes the first answered operand, in the order listed | —     | A's                          |
| A typed then cleared, B answered | B's answer                                                                 | —     | B's (blank counts as absent) |
| Neither                          | M                                                                          | —     | M                            |

### E4 · Recode a score into bands

Source: the #299 dictionary (`case`), rewritten for the new rules.

```yaml
# Every band is a rule; the default is the "no answer" case.
case:
  rules:
    - when:
        reference: self.prompt.score.value
        comparator: isAtLeast
        value: 80
      value: high
    - when:
        reference: self.prompt.score.value
        comparator: isAtLeast
        value: 50
      value: medium
    - when:
        reference: self.prompt.score.value
        comparator: isBelow
        value: 50
      value: low
    - default: true
      value: null # no answer: no band
```

| Moment     | Expected    | Today | New    |
| ---------- | ----------- | ----- | ------ |
| 90         | high        | —     | high   |
| 65         | medium      | —     | medium |
| 35         | low         | —     | low    |
| Unanswered | no band (M) | —     | M      |

A `default` catches everything the rules don't match. Under the new rules no answer never matches a positive comparison, so a default that names a band would also catch an unanswered score. The dictionary's own example (`default: true, value: low`) does exactly that, and #690 lists it for correction. Leaving the default out gives the same result, because a `case` with no matching rule is missing; spelling it out makes the intent visible. `value: null` in a `case` rule is a result, not a leaf's `value`, so it's allowed, and a `null` result is missing.

### E5 · Calculations and their `…Existing` twins

Not from a study. One row per rule, so the strict and lenient forms sit side by side.

| Expression                                       | Expected       | Today | New                                                              |
| ------------------------------------------------ | -------------- | ----- | ---------------------------------------------------------------- |
| `countUnique: [a, M, b]`                         | 2              | —     | 2 (counts never wait)                                            |
| `countUnique` over `[M, M, M]`                   | 0              | —     | 0                                                                |
| `countExisting: [a, M, b]`                       | 2              | —     | 2                                                                |
| `length` of a missing answer                     | missing, not 0 | —     | M                                                                |
| `product: [0, M]`                                | missing        | —     | M (calculations stay strict, even when the result looks certain) |
| `minExisting: [3, M, 5]`                         | 3              | —     | 3                                                                |
| `sumExisting` with `atLeast: 2` over `[4, M, M]` | missing        | —     | M                                                                |
| `divide` by a count that came out 0              | missing        | —     | M (the divisor is 0, and it came from data)                      |
| `firstExisting: [M, 0]`                          | 0              | —     | 0                                                                |

## F. Authoring errors

### F1 · Authoring errors

These are rejected when the study is validated, before anyone runs it.

| YAML                                                                                                                        | Expected                                          | Today                            | New                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `{ reference: self.prompt.role, comparator: equals, value: null }`                                                          | error: use `doesNotExist`                         | error (schema)                   | error, with that hint                                                                        |
| `{ reference: self.prompt.role, comparator: isOneOf, value: [a, null] }`                                                    | error                                             | error (schema)                   | error                                                                                        |
| `conditions: [{ reference: everyone.prompt.x.value, comparator: exists }]`                                                  | error: wrap the `everyone.` leaf                  | —                                | error, with a hint to wrap it in `all:`, `any:` or `none:`                                   |
| `any: [{ reference: everyone.prompt.x.value, comparator: exists }, { reference: self.prompt.y.value, comparator: exists }]` | error: an `everyone.` leaf inside an operand list | —                                | error; write `any: [{ any: { reference: everyone.prompt.x.value, comparator: exists } }, …]` |
| A numeric comparison against a text prompt (A4)                                                                             | error                                             | accepted (the text is converted) | error                                                                                        |

---

## What the cases say

- **The new rules match Expected in every case.** Four cases do so only when written the new way:
  - C6 states the wait;
  - E4 states every band, and lets the default mean "no answer";
  - C2's payoffs are `numericResponse`;
  - A4 is a validation error by design.
- **The structural questions in #690:**
  - **S1 (waiting or deciding) is answered:** decide on the current snapshot, and wait explicitly. "Never answered" is never a separate category: conditions update as answers arrive.
  - **S2 (leaves) is largely answered:** operators and leaves follow the same rules, so leaves are shorthand again (C3's two spellings agree).
  - **S3 (group members):** `everyone.` leaves with an explicit `all` / `any` / `none` / `countTrue`, plus list operators, cover every case here. #674 remains for compound per-participant tests.
  - **S4 (operators):** `…Existing` variants are needed only for calculations, and `missing: skip` goes away. `countTrueExisting` isn't needed (C5). `allExist` and `countUniqueExisting` are removed: the `exists` leaf and `countExisting` cover presence, and every count counts only what's there.
- **What Stagebook 0.32 can't do at all:** compare participants' answers with each other (C1, C2, C8), count answers (C5), or compute anything (C7, C9, E1–E5).
- **Behavior that changes from Stagebook 0.32** (input for the upgrade lint; #690, decision 4):
  - **Blank answers stop counting as answers:** a cleared text box (`""`), whitespace-only text, and an unticked multi-select (`[]`) (A2, A3, A6). An unguarded `hasLengthAtMost` stops passing a cleared box.
  - Early termination with `none:` stops advancing the stage at load (B2; a fix).
  - `none` around a positive comparison is true before anyone answers (C6). Studies relying on the old waiting behavior need the wait stated.
  - A number compared with a text choice becomes a validation error (A4).
  - Equality and membership comparisons ignore case and surrounding spaces (A5, D1). `matches` and `doesNotMatch` still use the raw text.
  - **0.32's `all.` leaves check only the participants who have answered; `everyone.` checks every seat (C2, C3).** There's no one-for-one rewrite. `all.x exists` ("someone has answered") becomes `any:`. `doesNotExist` and the negative comparators keep their meaning under `all:`, because a missing seat makes them true. The remaining positive comparators become `all:`, which is stricter: every seat must now answer.
- **C2 is settled by `numericResponse`** (#687, 0.32.0). Numbers that people must agree on should be typed numbers, not text.
