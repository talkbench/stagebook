# Accessibility: target standard, integrity boundary, and scope (July 2026)

Status: **accepted** (2026-07-10) — this ADR records the decisions settled for
the accessibility initiative ([#20]). The audit and gap-list deliverables are
**still outstanding** (see [Remaining work](#remaining-work)); this document
fixes the _frame_ those deliverables plug into — the standard we commit to, the
boundary between accessibility and data-integrity, and what is in vs. out of
scope. Subtasks get filed against [#20] once the audit runs.

[#20]: https://github.com/talkbench/stagebook/issues/20
[#532]: https://github.com/talkbench/stagebook/issues/532

## Motivation

Stagebook components run real experiments with real participants. Accessibility
gaps exclude participants and _contaminate the research_ — self-selection on
ability is a confound, not just an ethics problem. The current state is
"whatever we happened to ship": no target standard, no audit, no testing. This
ADR replaces that with an intentional commitment.

The initiative surfaced a tension worth recording, because the naive response to
it is harmful: **accessibility affordances (semantic roles, labels, keyboard
operability, a queryable DOM) are also what make a UI easy for an automated
agent to drive.** The temptation is to treat inaccessibility as bot-resistance.
We reject that — see the integrity boundary below.

## Decision 1 — Target standard: WCAG 2.2 AA

We commit Stagebook's **own** components and chrome to **WCAG 2.2 level AA**.

**Why WCAG:** it is the W3C's international standard and the thing every national
law (US Section 508 / ADA, EU EN 301 549 / European Accessibility Act, Ontario
AODA, Japan JIS, …) references. Conforming once satisfies the widest set of
jurisdictions at once — the internationalization-friendly choice at the
standards level.

**Why AA:** level A leaves large gaps; level AAA includes criteria that cannot
apply to all content (7:1 contrast, sign-language for all video). AA is the
universal legal and practical target — what "accessible" means in every law.

**Why 2.2 (not 2.1):** 2.2 (2023) is a strict _superset_ of 2.1 — conforming to
2.2 AA automatically satisfies 2.1 AA. Most laws cite 2.1 AA today but are
migrating to 2.2, so this is free future-proofing. Three new 2.2 AA criteria
land directly on our components:

- **2.5.8 Target Size (Minimum)** — button / radio / slider hit-targets ≥ 24px.
- **2.5.7 Dragging Movements** — anything drag-operated needs a non-drag
  alternative. Direct hits: **ListSorter** (drag-to-reorder) and **Slider**;
  both need keyboard/click equivalents.
- **2.4.11 Focus Not Obscured (Minimum)** — a keyboard-focused element must not
  be fully hidden by sticky/fixed content. Check the sticky **ScrollIndicator**
  and the **Timeline** help popover.

**i18n synergy (a reason this is the right frame, not a side note):** good
accessibility _is_ good internationalization — same discipline. 3.1.1 / 3.1.2
(Language of Page / of Parts) require declaring language, which is what makes
translated content pronounce correctly; 1.4.10 Reflow / 1.4.4 Resize Text
protect layouts against text expansion under translation (German/Finnish run
long, CJK differs); 1.4.5 Images of Text keeps text translatable.

## Decision 2 — Data-integrity is never enforced via interface hostility

**Accessibility is not a bot-resistance mechanism, and we will not use interface
hostility or perception-gap challenges as a deterrent.** Reasoning:

1. It excludes real participants and biases data on ability — the exact confound
   this initiative exists to remove.
2. It is ineffective against the adversary we actually fear (a scaled automated
   bot): a capable computer-use agent drives rendered pixels and does not need
   our accessibility tree, while inaccessibility is a hard wall for disabled
   humans. You pay a permanent, real cost to impose a temporary, shrinking one.
3. WCAG 2.2 itself backs this: **SC 1.1.1** requires any CAPTCHA to provide
   alternative modalities (not a single-sensory gate), and **SC 3.3.8 Accessible
   Authentication** discourages cognitive-puzzle gates without an alternative.
   The standard tells us not to fight bots at the interface.

Data-integrity enforcement therefore lives in a **separate layer** — provenance,
behavioral telemetry, and pre-assignment screening — owned by **[#532]**
(bot detection & pre-assignment screen-out), not here. The two initiatives share
Stagebook's existing behavioral instrumentation (keystroke stats, paste
detection, timing) but are otherwise independent by design. A CAPTCHA, if ever
added, must keep an accessible alternative and is expected to be only a cheap
filter for low-effort automation.

## Decision 3 — Conformance is scoped across three surfaces

Stagebook is an **authoring tool**: it ships components _and_ renders
researcher-authored studies that embed third-party media. Honest conformance
distinguishes what we control:

1. **Stagebook's own components, viewer chrome, and the VS Code preview
   webview** — **we conform to WCAG 2.2 AA.** Fully in our control.
2. **Researcher-authored content** (prompts, images, stimuli) — we cannot
   _guarantee_ it, but as an authoring tool we **help** the author produce it
   (the spirit of ATAG, the Authoring Tool Accessibility Guidelines). Concrete,
   high-leverage hook: the **validator already lints treatment/prompt files** —
   it can flag missing `alt` text on `Image`, missing transcript/caption on
   `AudioElement` / `TrainingVideo`, and similar. This extends accessibility to
   authored content without pretending we can force it.
3. **Third-party real-time media** (participant-to-participant video calls) —
   **explicitly out of scope.** Live captioning of a peer call (SC 1.2.4
   Captions (Live)) is impractical for synchronous multi-party media we don't
   own. Documented exception, not a gap.

The published conformance statement is therefore _scoped_ — and worded with care,
because a formal WCAG conformance claim attaches to **pages/processes, not
isolated components**: "Stagebook's components **meet the applicable WCAG 2.2 AA
success criteria**; a formal conformance claim attaches to the host's rendered
study pages; here is how we help authors make their content accessible; here is
what is explicitly out of scope and why."

## Remaining work

This ADR fixes the frame. The [#20] plan deliverables that are **not yet done**
and become subtasks once the audit runs:

- [ ] **Audit** — run axe-core against the library components and the viewer;
      manual keyboard-only walkthrough of every interactive element across the
      three surfaces. (No axe tooling exists in the repo today.)
- [ ] **Gap list** — grouped by surface/component, prioritized by severity ×
      frequency (participant- vs researcher-facing) × fix cost.
- [ ] **Testing strategy** — per-component axe smoke tests (CT / vitest),
      keyboard-navigation e2e through a full study in the viewer, CI integration
      and flake budget.
- [ ] **Authorable alt + validator a11y lint** — the Image `alt` work is a
      _coordinated_ schema field → router → component prop → lint, **not
      lint-only** (otherwise authors have no valid syntax to satisfy the
      warning); tracked in #536. Audio/Video transcript is analogous. Wire the
      lints into **both** validate paths (`cli/validate.ts` and
      `validateTreatmentDiff.ts`).
- [ ] **Per-new-component a11y checklist** — a short "how to ship an accessible
      component" list to prevent regression.
- [ ] **Subtask breakdown** — each gap (or cluster) becomes its own issue with
      acceptance criteria, linked to [#20].

## Consequences

- [#20] can proceed independently of the bot-integrity problem; the two no
  longer block or contaminate each other's design.
- The natural next action is the audit (deliverable 1) — it seeds the gap list,
  which seeds the subtasks. Until then [#20] stays an exploration.
- New components inherit a target (2.2 AA) and a checklist obligation once the
  checklist exists.
