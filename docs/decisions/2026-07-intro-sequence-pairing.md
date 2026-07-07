# Treatment ↔ intro-sequence pairing (July 2026)

Status: **accepted** — design settled in [#499] (see its comment thread for
the full discussion, including the relationship to consent/debrief in
[#481]). Implemented by the PR that links here.

[#499]: https://github.com/deliberation-lab/stagebook/issues/499
[#481]: https://github.com/deliberation-lab/stagebook/issues/481
[#480]: https://github.com/deliberation-lab/stagebook/issues/480

## Motivation

The link between intro sequences and treatments was **implied, not
declared**. Treatments reference values participants submit during intro
steps (`self.prompt.<name>.value`), but nothing recorded *which* intro
sequence(s) a treatment expects. Two consequences:

1. **Design-time validation was unsound.** The reference validator merged
   intro-produced keys across *every* sequence in the file, so a reference
   validated if *any* sequence provided the key — even though the host
   might run a different one, where the reference silently never resolves
   and the participant gets stuck.
2. **No run-time guard.** The host pairs an intro sequence with treatments
   in batch config; nothing verified the pairing was one the file's
   authors considered valid.

Multiple intro sequences per treatment are a real use case (different
recruitment pathways or populations feeding the same treatments), so the
relationship is many-to-many, and references must hold against **every**
sequence a treatment may follow.

## Decision

**Each treatment declares the intro sequences it may follow — a required
`compatibleIntroSequences:` array of names (option B of [#499]).** The treatment is
the consumer of intro-provided data, so it declares its supplier set; and
treatments are the heavily-templated, more-numerous side, so the
declaration lives where templates already fan out.

```yaml
treatments:
  - name: negotiation_high_stakes
    playerCount: 2
    compatibleIntroSequences: [prolific_en, prolific_es] # refs must resolve in BOTH
    gameStages: [...]
```

Key semantics:

- **Required — breaking.** Absence is a schema error. `compatibleIntroSequences: []`
  declares "no intro sequence": the host may only launch the treatment
  without one. There is no back-compat mode; existing files add one line
  per treatment (the error message carries the `[]` escape hatch, the
  dangling-name error enumerates the defined sequences).
- **Names resolve per-collection.** Arm names are per-collection
  namespaces — a treatment, an intro sequence, and (later, [#481]) a
  consent arm may share a name. The list resolves against the top-level
  `introSequences:` collection only.
- **Positive check.** Every game/exit/groupComposition reference that
  resolves from intro data must be provided by **every** listed sequence
  (it stands down when an earlier own stage produces the key). An
  unknown reference whose key exists in a *non-listed* sequence gets a
  hint to add that sequence.
- **Collision scope follows pairing scope.** The intro × treatment
  storage-key collision check narrows from all pairs to declared pairs —
  a key shared with a never-paired sequence is not a collision any
  participant can experience. (Consent, by contrast, will be checked
  against *everything*, because it has no pairing — see [#481].)
- **Can't-prove posture ([#480]).** Unresolved `${...}` placeholders in
  the declaration skip the pairing checks for that treatment (concrete
  sibling entries are still name-checked); the post-fill resolved schema
  catches leaked placeholders. A file with no `introSequences:`
  collection skips name/positive checks (the other half may live in an
  importing file).
- **Runtime guard.** `checkPairing(file, { introSequenceName },
  treatmentNames)` (exported from `stagebook/validate`) verifies at batch
  launch: the sequence exists, each treatment exists and *lists* it (the
  declaration is a constraint, not just a data dependency), and every
  reference resolves under that specific sequence. Intro-only by design —
  consent arms have no pairing relationship, so there is no `consentName`
  parameter.

## Alternatives considered

- **Point-forward** (intro sequence lists treatments): reads in
  participant-flow direction, but the dependency arrow is backwards from
  the data dependency; every new treatment edits every feeding sequence.
- **Derived compatibility** (compute provides ⊇ requires, no syntax):
  zero authoring burden but can only express *data* compatibility, not
  intent — a treatment referencing no intro data would be "compatible"
  with every sequence even when population/consent scoping says
  otherwise. The declared list expresses intent; the derived relation is
  what validation checks against it.

## Consequences

- Major version bump; every consumer's treatment files add
  `compatibleIntroSequences:` to each treatment (see the consumer issues filed from
  [#499] for deliberation-lab, manager, annotator).
- Hosts gain a launch-time guard (`checkPairing`) at the point where
  batch config selects `introSequenceName` + `treatments`.
- The unsatisfiable-conditions rule ([#480]) and future cross-phase
  checks (consent/debrief, [#481]) extend a pairing-aware model instead
  of the union model; locale-coherence between treatments and their
  declared sequences becomes statically checkable.

## Addendum — field name (July 2026)

The treatment-level field was originally named `introSequences:`, matching
the top-level collection. Sitting next to `gameStages:` it read as though
*all* the listed sequences run as part of the participant's experience,
when the relationship is the opposite — the treatment is *compatible with*
each listed sequence, and the host launches it after exactly **one** of
them. Renamed to `compatibleIntroSequences:` before any study adopted the
syntax, to make the ANY-of-these (not ALL) meaning read off the key and to
disambiguate the treatment field from the same-named top-level collection.
