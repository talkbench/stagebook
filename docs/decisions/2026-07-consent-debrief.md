# Consent & debrief as first-class components (July 2026)

Status: **accepted** — design settled in the [#481] comment thread
(2026-07-02/03); this ADR records the outcome. Phase 1 (stagebook
library + viewer) is implemented by the PR that links here; Phase 2
(runner integration + boilerplate library) follows in the host
repo. Builds on the intro-sequence pairing model of [#499]
([2026-07-intro-sequence-pairing.md](./2026-07-intro-sequence-pairing.md)).

> **Revised 2026-07-09 — the per-treatment `debrief:` field was retired.**
> Debrief content is now authored as the trailing steps of `exitSequence`;
> see the **Revision** section immediately below. This supersedes decision
> **#2** (debrief home) and the debrief half of the **Host placement**
> section. Everything about **consent** is unchanged.

[#481]: https://github.com/talkbench/stagebook/issues/481
[#499]: https://github.com/talkbench/stagebook/issues/499
[#479]: https://github.com/talkbench/stagebook/issues/479

## Revision (2026-07-09): debrief retired — folded into `exitSequence`

**What changed.** The per-treatment `debrief:` field is removed from the
schema (breaking). Debrief content — study purpose, dehoaxing, and any
"may we use your data?" withdrawal choice — is now authored as the
**trailing steps of `exitSequence`**. Host ordering becomes:

```
… → [exitSequence (trailing steps = debrief)] → QC survey → completion code
```

which **reverses** the original placement (debrief _after_ the completion
code). Consent is entirely unchanged.

**Why.**

1. **The field was redundant.** In every validation pass — references,
   storage-key collisions, unsatisfiable-conditions, locale consistency,
   the resolved shape — `debrief` was handled _identically_ to
   `exitSequence`, just ranked immediately after it. The only thing that
   ever distinguished it was host placement (after QC + completion code).

2. **Interactive debrief must precede the completion code.** The feature
   that justified first-classing debrief was making it _interactive_
   (comprehension-gated, or offering data withdrawal). A debrief the
   participant must actually see or act on cannot sit after the completion
   code: a web-study RCT (n=11,943; PMC3510731) found only ~25% of
   participants opened an _available_ debrief once they already had what
   they came for. So an interactive debrief has to block _before_ the code
   — exactly what trailing `exitSequence` steps do (the code is the
   platform's terminal "you're done" signal). Once debrief moved before the
   code, the parallel/after-code placement that was the field's sole reason
   to exist was gone.

3. **QC-after-debrief is a feature, not contamination.** With the debrief
   at the tail of the exit sequence and the host's QC survey after it, the
   QC survey measures the participant's _post-debrief exit state_ — the
   "peak-end" experience you actually want for retention/satisfaction
   items. Review of the deployed QC survey confirmed it is reveal-safe as
   measurement (operational/experience items — compensation, time, tech
   quality, "would you participate again" — with no manipulation check or
   suspicion probe), so debrief-before-QC does not corrupt it. A study that
   _does_ need a funnel/suspicion probe still authors it as an exit step
   _before_ the dehoaxing step.

4. **It simplifies every consumer.** One construct instead of two: the
   viewer drops a whole phase plus a mid-unit interstitial; the host drops a
   placement decision; the validators drop their debrief branches. "Debrief
   = the last steps of the exit sequence" is the whole rule.

**The gate is positional.** There is no debrief-specific gate flag: because
the completion code follows the exit sequence, the debrief is gated behind
the code by construction. The host contract is simply "don't reveal the
completion code until the exit sequence has completed."

**Ethics floor is unchanged.** Whether a concealment/deception study _needs_
a debrief remains the researcher's / IRB's call (the tool provides the
mechanism; it cannot detect concealment) — the same division of
responsibility this ADR already takes for consent _text_. A treatment with
no trailing debrief steps simply has no debrief.

**What did NOT change.** Consent stays first-classed. Its unique needs —
closed reference scope, the hard consent gate, a study-level home invariant
across manipulations, and retiring the host's hardcoded legal text — are
real and specific to consent; debrief never had any of them, which is why
only debrief folds away. The consent record below (decisions #1, #3–#13)
stands as written.

## Motivation

Consent and debrief were platform-owned markdown (hardcoded legal
statements + `batchConfig` addenda), outside the treatment file. That
made them the only participant-facing content that couldn't be localized
through the i18n model ([#479]), versioned with the study, varied
per-condition (deception-study debriefs), or made interactive
(comprehension-gated consent). Making them first-class stagebook units
fixes all four at once.

**Consent is a site parameter, not part of the reproducible
instrument.** Stagebook reproduces the study _instrument_
(treatments/stages/elements) identically across replications; consent is
the deliberate exception a replicator **must** swap, because their IRB
owns and verifies that language. What this feature makes reusable is the
consent _machinery_ — localization, gating, storage/export, validation —
**not the consent text**. Reusable machinery, swappable text: that is
the real justification for first-classing it.

## The shape in one sentence

**Consent is a study-level array of named arms selected by the host;
debrief is a per-treatment step list; both are ordinary stagebook steps
whose responses ride the normal save/export machinery — the saved
responses plus the version-controlled content ARE the consent record.**

## At-a-glance decisions

| #   | Decision            | Resolution                                                                                                                                                                                                                                             |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Consent home        | Top-level `consent:` array, sibling of `introSequences`/`treatments`. Each arm `{ name, locale?, steps }`. Host selects by **name** (`consentName` config). Study-level keeps consent invariant across manipulations — an IRB artifact.                  |
| 2   | Debrief home        | Per-treatment `debrief:` steps field. Inherits the treatment's locale and key scope, like `exitSequence`. Per-condition debrief = different treatment arms; per-participant = step `conditions:`.                                                        |
| 3   | Arm names           | Unique **within** the consent collection only. Arm names are per-collection namespaces ([#499]): a consent arm, a treatment, and an intro sequence may all be `default`.                                                                                 |
| 4   | Pairing             | **None.** Unlike intro sequences, consent has no treatment-level link: treatments never depend on consent values, so consent's only obligation is *negative* — don't conflict. Consequence: `checkPairing` stays intro-only, no `consentName` parameter. |
| 5   | Storage             | Consent responses join the **flat key namespace** and the normal data-handling machinery. Deciding argument: machinery reuse — a separate consent store would rebuild save/export plumbing that already exists.                                          |
| 6   | Collisions          | *Collision scope follows pairing scope*: consent arms are checked against **every** intro sequence and **every** treatment (no pairing to narrow by); arm × arm reuse is legal (a participant sees one arm). Debrief joins its treatment's scope.        |
| 7   | Referenceability    | Consent is a **closed scope, by policy**: consent keys are excluded from every provides-set; a reference to one from intro/game/exit/debrief is an error ("audit-only"); consent steps cannot read later-phase data (consent runs first). Within-arm references are legal — the gating pattern. |
| 8   | The consent record  | The saved responses **are** the record. No separate audit artifact: content is version-controlled in the study repo, the batch records which version it ran, and (repo version + responses + timestamps) reconstructs what was shown and agreed to.      |
| 9   | Gating              | Via existing conditions — an "I consent" submitButton gated on same-step acknowledgement checkboxes (element conditions re-evaluate live against in-memory responses). No new machinery.                                                                 |
| 10  | Step rules          | Consent steps get intro-style restrictions (advancement element required, no `shared` prompts, no position fields — pre-assignment, single participant); debrief gets exit-style (advancement + no shared).                                              |
| 11  | Locale              | Consent arms declare their **own** locale (pre-assignment, like intro sequences); debrief inherits the treatment's. The locale-consistency rule covers both (new "consent arm" container kind).                                                          |
| 12  | Templates           | New content types `consentArm` / `consent` / `debriefSteps` — a single-source `consentArm` template with `${locale}` broadcasts to one arm per locale, same pattern as the i18n gallery's treatments.                                                    |
| 13  | Boilerplate         | **Per-institution**, not one global library: institutions maintain their own importable consent modules (e.g. `imports: [@your-inst/consent-gdpr]`) carrying their jurisdiction/IRB language; studies compose those + a study-specific addendum. This is where the institution-defaulting responsibility lands once runner's hardcoded US/UK/EU statements are retired. Collisions with study keys surface as design-time validation errors; module authors use distinctive key names.                             |

## Alternatives considered

**Capability-tag coverage validation — rejected.** A machine-readable
check that a treatment only uses capabilities its consent declares
(tag every element, maintain a controlled vocabulary, validate
`requires ⊆ declares`) was considered and rejected: it imposes heavy
author burden for a check that natural-language review does better
against broad free-text IRB prose. The recommended practice is to point
an LLM at the consent text plus the treatment and ask whether they are
compatible — zero author burden, and it reads the actual language the
IRB approved. Recorded here so the tag scheme isn't re-proposed later.

## Out of scope

**Consent withdrawal** — handled in its own future issue (including
granular opt-out → screening and the retention-granularity question of
deleting experiment data while keeping proof of consent within one
record). Nothing in this design anticipates it.

## Host placement (unchanged seam)

> **Superseded for debrief (see Revision):** debrief is no longer a trailing
> phase after the completion code — it is the tail of `exitSequence`, so the
> order is now `… → [exitSequence (…debrief)] → QC → completion code`.

The host wraps its own steps around extracted stagebook steps —
`[consent] → attention/equipment checks → [introSteps] → [gameStages] →
[exitSequence] → QC → completion code → [debrief]`. Stagebook labels and
provides the content; the host decides placement and attaches behavior.
One responsibility is load-bearing: **advancing past the consent steps
is the recorded act of consent** — the host must not render any
downstream phase until the consent advancement has fired, and must
treat the gate as a mandatory, non-skippable precondition (see the
host consent-gate contract in the integration guide).
The viewer previews consent arms as their own units (first in the list)
and debrief as the trailing phase of a treatment unit, with transition
interstitials narrating the platform steps it can't simulate.

## Consequences

- Purely additive at the schema level — no migration (the breaking
  change of this release cycle is [#499]'s, which ships first).
- runner Phase 2: `consentName` selector, render consent first
  / debrief last via the existing `GenericIntroExitStep` seam, retire
  the hardcoded legal statements, keep the markdown fallback.
- Phase 3 (later): i18n-completeness warning (treatment locale with no
  matching consent arm), same shape as the locale-coherence checks
  [#499] enables for intro pairings.
