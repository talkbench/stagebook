# Consent & debrief as first-class components (July 2026)

Status: **accepted** — design settled in the [#481] comment thread
(2026-07-02/03); this ADR records the outcome. Phase 1 (stagebook library
+ viewer) is implemented by the PR that links here; Phase 2
(runner integration + boilerplate library) follows in the host
repo. Builds on the intro-sequence pairing model of [#499]
([2026-07-intro-sequence-pairing.md](./2026-07-intro-sequence-pairing.md)).

[#481]: https://github.com/talkbench/stagebook/issues/481
[#499]: https://github.com/talkbench/stagebook/issues/499
[#479]: https://github.com/talkbench/stagebook/issues/479

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
