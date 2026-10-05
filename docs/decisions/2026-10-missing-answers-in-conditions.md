# Conditions decide on the answers they have, and waiting is explicit

Status: accepted in [#690](https://github.com/talkbench/stagebook/issues/690)
(decisions 3, 7 and 8), for the expression grammar in
[#299](https://github.com/talkbench/stagebook/issues/299). Builds on
[prompt validation](2026-09-prompt-validation.md) (#668) and
[numeric responses](2026-09-numeric-response.md) (#687). Worked cases:
[companion file](2026-10-missing-answers-in-conditions-cases.md).

Conditions, #299 expressions, and #674 derived values constantly refer to
answers that aren't there: a question nobody has reached, a participant who
timed out, a text box someone typed in and then cleared. How the grammar
treats a missing answer decides what participants see, so it has to be one
rule that researchers can predict, not a property each operator decides for
itself.

This ADR records that rule and why. The companion file checks it against 26
cases taken from real studies, the researcher docs, and earlier issues. Each
case lists the moments that matter (nobody answered, some answered, everyone
answered, answered then cleared) and the result at each, next to what
Stagebook 0.32 does today. The decision replaces the missingness rules in
#299's revision-2 dictionary. #690 tracks the implementation.

## What counts as missing

An answer is missing when:

- **nothing is stored**: the question hasn't been answered, or the
  participant never reached it;
- **a prompt's answer is blank**, as #668 defines it: `""`, whitespace only,
  or `[]`. Conditions read it as missing. The stored record is unchanged, and
  its `isValid` still shows that the participant interacted;
- **a `numericResponse` saved no `value`**, because the entry was blank,
  unfinished, or not a number;
- **it is a literal `null`**, for example a `case` result written as
  `value: null`;
- **a value has the wrong type**, which also reports a contract violation
  (#690, decision 1);
- **a calculation can't produce a finite number**, for example division by
  a zero that came from data.

There is no separate "never answered". Conditions are re-evaluated whenever
data arrives, so "not answered yet" is the only state a condition needs, and
its result is correct for the current answers.

## A missing answer matches nothing

A missing answer doesn't equal, exceed, include, or match anything,
including another missing answer. So every comparison with one is false, and
its negation is true. This holds for the leaf shorthand and for operators
alike. It is how NaN behaves in every programming language: `NaN < 5` and
`NaN >= 5` are both false, and `NaN !== NaN`.

Three things follow:

- **"Does this group agree?" needs no guard.** `allEqual` over
  `["red car", "red car", M]` is false, because the missing label can't
  match. Nobody answering is also false (case C1).
- **The negative comparators keep #348's behavior.** `doesNotEqual`,
  `doesNotInclude`, `doesNotMatch`, and `isNotOneOf` are true for an
  unanswered question, because it can't equal the compared value (A5, C4).
  Each is now exactly `none` around its positive twin, with no special rule
  of its own.
- **Negation differs from the opposite comparator for a missing answer.**
  `none: [isBelow 5]` is true when there's no answer, and `isAtLeast 5` is
  false. The numeric pairs (`isAbove` / `isAtMost`, `isBelow` / `isAtLeast`)
  are both positive claims, and both need an answer. That matches plain
  English: "didn't score below 5" is true of someone who didn't answer;
  "scored at least 5" isn't.

`allUnique` requires every value to be present, because "everyone gave a
different label" shouldn't hold when someone gave none. A `null` in a leaf's
`value`, including inside an `isOneOf` list, is a validation error. To test
for presence or absence, use the `exists` and `doesNotExist` leaves. They're
the presence primitives; there's no `allExist` operator behind them.

## No "unknown" in true/false logic

Wherever a true/false is needed (a `conditions:` root, `all`, `any`,
`none`, `countTrue`, or a `case` rule's `when`), a missing value counts as
not true. A condition is always true or false. The three-valued logic from
#235 goes away.

Three-valued logic waits for answers by default, and that fails in three
ways:

- **Closed questions.** Under #299's revision-2 dictionary (never shipped), a
  feedback stage that follows the question would wait for an answer that
  never comes. One participant timing out would hide both "labels match" and
  "labels don't match", for good (C1).
- **Early termination.** Stagebook 0.32's three-valued `none` already breaks
  early termination written with `none:`: the stage advances as soon as it
  loads (B2).
- **Running totals.** Under revision 2, a single unanswered round would make
  a score missing for the rest of the game (C9).

## Waiting is written out

To hold something back until people have answered, say so with `exists`
or `doesNotExist`, or state the condition positively. For
example, "nobody rated above 50" is true before anyone has rated. To wait,
write "every seat has a rating, and each is 50 or less" (C6):

```yaml
conditions:
  - all:
      reference: everyone.prompt.rating.value
      comparator: isAtMost
      value: 50
```

When a result should appear is a design choice, so it belongs in the study
file, not in an operator default ([principle 7](principles.md)). Authors
already wrote such guards in legacy studies (C2).

## Calculations need their inputs; escape hatches are named

Calculations (`sum`, `average`, `product`, `min`, `max`, `subtract`,
`divide`, `length`) are missing if an input they need is missing, even when
the result looks certain: `product: [0, M]` is missing. Escape hatches are
separate, named operators, not modes:

- **Drop missing inputs:** `sumExisting`, `averageExisting`, `minExisting`,
  and `maxExisting`. An optional `atLeast` (replacing `minValid`) sets the
  minimum number of present inputs, defaulting to 1. Below it the result is
  missing (E2, E5, C7).
- **Substitute a default:** `firstExisting`, which takes the first answered
  operand in the order listed, so a trailing literal works as a default
  (E3, E5).

Counts are different: they describe what's there now, so they never wait.
`countExisting` counts the present values, `countTrue` the true ones, and
`countUnique` the distinct present ones. None of them returns missing, and
each is 0 when nothing counts (C5, E5). To count only once everyone has
answered, guard the count, as with any other wait. `countExisting` is also
how to ask whether a calculation produced a value, until #674 lets an
`exists` leaf read a derived value.

A `case` picks the first rule whose `when` is true, and its `when`
conditions follow the true/false rule above. A `case` is missing only when
the rule it picks has a missing `value`, or when no rule matches and there's
no default. Its `default` catches everything the rules don't match,
including no answer. So state every band as a rule, and let the default mean
"no answer" (E4):

```yaml
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

## Groups: `everyone.` lists and explicit quantifiers

The `all.` position is renamed `everyone.`, so it no longer reads like the
`all:` operator. `everyone.<reference>` is a list with one entry per seat,
in seat order, with a missing entry where a seat has no answer.

Operators that take a list use it directly: `allEqual`, the container of
`includes`, `sumExisting`, and so on. A leaf on `everyone.` gives one
true/false per seat, and `all`, `any`, `none`, or `countTrue` must consume
it:

```yaml
- all: # everyone answered
    reference: everyone.prompt.answer.value
    comparator: exists
- any: # someone guessed
    reference: everyone.prompt.guess.value
    comparator: exists
- nonDecreasing: # at least 4 said Yes
    - 4
    - countTrue:
        reference: everyone.prompt.agree.value
        comparator: equals
        value: "Yes"
```

A bare `everyone.` leaf where a single true/false is needed is a validation
error, with a hint to wrap it. So is an `everyone.` leaf inside an operand
list: `any: [everyoneLeaf, otherLeaf]` should be
`any: [{any: everyoneLeaf}, otherLeaf]` (F1). The quantifier is always
visible where it's used.

Legacy `position: all` and `position: any` conditions, from the previous
host, translate directly into `all:` and `any:` around an `everyone.` leaf.
Stagebook 0.32's `all.` leaves are different, because they check only the
participants who have answered; see Consequences.

## Text comparisons ignore case and surrounding spaces

Equality and membership (`equals`, `isOneOf`, `includes`, `allEqual`,
`allUnique`, `countUnique`) compare text after trimming it and lowercasing
it. That means "Red car" and "red car " are the same label, as they were in
the legacy platform's agreement check. Trimming removes the same whitespace
as #668's blank test (`String.prototype.trim`), and lowercasing uses the
default Unicode mapping, not the participant's locale.

`matches` uses the raw string; it has its own `i` flag, and an anchored
pattern remains available for exact, case-sensitive checks. `length` and
`hasLength*` count what was typed, as #668's counter does. Stored and
displayed data is never changed. Internal whitespace isn't collapsed.

Numbers that people must agree on should be typed numbers
(`numericResponse`), not text, so "100" and "100.00" agree (C2).

## Rejected

- **"Missing propagates", with three-valued `all` / `any` / `none`
  (the #299 revision-2 dictionary).** It makes results wait by default,
  which fails for closed questions, running totals, and early termination
  written with `none:`, as described above.
- **Leaves decide but operators wait** (a draft from 2026-09-28). The same
  question had two spellings with different answers (C3), and `allEqual`
  would still wait forever on closed questions.
- **A missing state that knows whether its question is closed.** Conditions
  never need it, because they update as answers arrive.
- **Negative comparators false when there's no answer** (the September
  2026 #299 review). An unanswered question can't equal the compared value.
  Authors also wrote around the old bug (#348) explicitly (C4).
- **A `missing: skip` mode on reductions.** A flag that changes what an
  operator means is easy to miss; named `…Existing` operators say it in the
  operator name.
- **`countTrueExisting`.** `countTrue` already counts only the trues.
- **`allExist`.** The `exists` leaf, an `everyone.` leaf under `all:`, and
  `countExisting` cover everything it did. Its operand-list form also had a
  trap: `allExist: [{reference: everyone…}]` was always true, because the
  group list itself is always present.
- **A strict `countUnique` with a `countUniqueExisting` twin.** The other
  counts already count only what's present. Making `countUnique` match them
  removes an operator and a special `atLeast` default, and keeps the rule
  that waiting is written out.
- **An implied `all` on `everyone.` leaves.** It hid the quantifier, and it
  left no direct way to write "someone" or to count.
- **Case-sensitive text comparison, and collapsing internal whitespace.**
  The first splits labels that researchers treat as the same. The second
  goes further than the legacy behavior, with no case for it yet.
- **An `append` operator for state that builds up across rounds.**
  Undecided; see #742.

## Consequences

- **Behavior changes from Stagebook 0.32,** which the upgrade lint must
  cover (#690, decision 4):
  - a cleared text box (`""`), whitespace-only text, and an unticked
    multi-select (`[]`) no longer count as answers. Today `exists` is true
    for all three, and an unguarded `hasLengthAtMost` passes them;
  - `none` around a positive comparison is true before anyone answers, so
    studies that relied on it waiting must state the wait;
  - early termination written with `none:` no longer advances the stage at
    load, which is a fix;
  - equality and membership comparisons (`equals`, `isOneOf`,
    `includes`, `allEqual`, `allUnique`, `countUnique`) ignore case and
    surrounding spaces. `matches` and `doesNotMatch` still use the raw
    text, unless the pattern sets its own `i` flag;
  - comparing a text prompt with a number is a validation error;
  - Stagebook 0.32's `all.x` leaves check only the participants who have
    answered, and there's no one-for-one rewrite. The upgrade lint suggests
    one per comparator and says what changes:
    - `all.x exists` ("someone has answered") becomes
      `any: {reference: everyone.x, comparator: exists}`;
    - `doesNotExist` and the negative comparators (`doesNotEqual`,
      `doesNotInclude`, `doesNotMatch`, `isNotOneOf`) keep their meaning
      under `all:`. A missing seat makes them true, just as an unanswered
      participant was ignored before, so they don't wait;
    - the remaining positive comparators become `all:`, which is stricter:
      every seat must now answer and satisfy the comparison, where before
      only those who had answered had to (C2, C3).
- **The evaluator has two states,** a value or missing, with no "unknown".
  Type mismatches become missing and are reported (#690, decision 1).
- **The #299 dictionary changes:**
  - its missingness section, its edge-case table, and its `case` example
    are replaced;
  - `allExist` is removed, and `countUnique` counts only present values;
  - the `…Existing` calculations replace `missing: skip`;
  - #348's behavior is kept;
  - #235's three-valued logic is removed.
- **Derived values (#674) can be list-valued.** A running score built from
  tests treats an unanswered round as 0 (C9).
- **The researcher docs** gain:
  - negation versus the opposite comparator;
  - explicit waiting;
  - stating every band;
  - `everyone.` quantifiers;
  - the text-comparison rule.
- **The companion file's case IDs are stable.** The evaluator's
  table-driven tests reference them, so the cases and the tests can't drift
  apart.
