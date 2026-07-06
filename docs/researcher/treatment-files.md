# Writing Treatment Files

A treatment file is a YAML document (`.stagebook.yaml`) that defines the complete flow of an interactive experiment. It specifies when and to whom different elements are displayed, under what conditions, and in what sequence — but not the content itself. Content such as prompts, instructions, and surveys are written separately in Markdown files and referenced within the treatment file.

## File Structure

A Stagebook file may have any subset of these top-level sections:

```yaml
imports: # optional — relative paths to other Stagebook files whose templates: should be merged in
templates: # optional — reusable blocks of structure
consent: # optional — named consent arms; the host shows one, selected by name
introSequences: # used as the entry point — pre-randomization onboarding steps
treatments: # used as the entry point — post-randomization experiment flows
```

A file with `treatments:` is a study **entry point** the runtime can launch. A file with only `templates:` (and optionally `imports:`) is a **module** — it can't be launched directly, but other files can `imports:` it to reuse its templates. The same file can play either role; there is no separate file type or extension.

Everything is validated after imports are resolved and templates are expanded. Unfilled `${field}` placeholders or unresolved template blocks are errors.

## Imports

Use `imports:` to pull templates defined in another Stagebook file into the current one. Paths are relative to the current file:

```yaml
imports:
  - ./surveys/tipi/tipi.stagebook.yaml
  - ./scoring/partisan-7pt/scoring.stagebook.yaml

templates:
  - name: extra_local_template
    contentType: elements
    content:
      - type: prompt
        file: extra.prompt.md

treatments:
  - name: my_study
    playerCount: 1
    introSequences: [] # this file defines no intro sequences
    gameStages:
      - name: intro
        duration: 60
        elements:
          - template: tipi_questions # defined in surveys/tipi/tipi.stagebook.yaml
          - template: extra_local_template
```

What gets pulled in: only the imported file's `templates:`. Any `treatments:` or `introSequences:` it declares are ignored — those are entry-point fields, not reusable building blocks.

What about file paths inside imported templates: when an imported template references a file (`file: q1.prompt.md`), Stagebook automatically prepends the import directory so the path resolves correctly relative to the importing file. So if `surveys/tipi/tipi.stagebook.yaml` declares a template with `file: q1.prompt.md`, the merged result has `file: surveys/tipi/q1.prompt.md`.

Nested imports (an imported file that itself has `imports:`) are supported. The same file imported via two paths is loaded only once.

Template names must be unique across the main file and every imported file. The convention for sharing the same name across modules is to prefix with the module's namespace (e.g., `tipi_q1` instead of `q1`).

## Experiment Lifecycle

Each study follows a three-phase structure:

### 1. Intro Sequence (asynchronous, solo)

Completed individually before group assignment. Typically includes consent, setup checks, and researcher-defined surveys or prompts. You can define multiple intro sequences, but each batch uses exactly one — and each treatment declares which sequences it may follow (see [Pairing Treatments with Intro Sequences](#pairing-treatments-with-intro-sequences)).

### 2. Game Stages (synchronous, group)

The live portion where participants move through stages simultaneously. Each treatment defines a unique pathway. You can host video or text conversations, insert prompts between discussions, show different content to different positions, and include timers and submit buttons.

### 3. Exit Sequence (asynchronous, solo)

Post-game follow-up at each participant's pace: surveys, quality checks, debriefing. Defined per-treatment, so different conditions can have different exit flows.

Two optional bookends sit outside the three phases: study-level [`consent:`](#consent) runs before everything, and per-treatment [`debrief:`](#debrief) runs after everything (after the host's own wrap-up steps). Both are additive — a file without them gets the host platform's existing consent and debrief behavior.

## Complete Example

```yaml
introSequences:
  - name: default
    introSteps:
      - name: Consent
        elements:
          - type: prompt
            file: intro/consent.prompt.md
          - type: submitButton

      - name: Pre-Survey
        elements:
          - type: survey
            surveyName: TIPI
            name: preTIPI
          - type: submitButton

treatments:
  - name: two_player_discussion
    notes: Simple two-player video discussion
    playerCount: 2
    introSequences: [default]

    gameStages:
      - name: Discussion
        duration: 300
        discussion:
          chatType: video
          showNickname: true
          showTitle: false
        elements:
          - type: prompt
            file: game/discussion_prompt.prompt.md
          - type: submitButton
            buttonText: Leave Discussion

      - name: Post-Discussion Survey
        duration: 120
        elements:
          - type: prompt
            file: game/post_discussion.prompt.md
          - type: submitButton

    exitSequence:
      - name: Debrief
        elements:
          - type: prompt
            file: exit/debrief.prompt.md
          - type: submitButton
            buttonText: Finish
```

## Pairing Treatments with Intro Sequences

Every treatment must declare which intro sequences it may follow, via a required `introSequences:` field:

```yaml
treatments:
  - name: two_player_discussion
    playerCount: 2
    introSequences: [default]
```

Names resolve against the top-level `introSequences:` collection (after imports are merged) — arm names are per-collection namespaces, so a treatment and an intro sequence may share a name without conflict. Use `introSequences: []` for a treatment that runs without an intro sequence; the host may then only launch it intro-less. Omitting the field is an error — the pairing must be explicit.

Why declare it? Treatments consume data participants produce during intro steps (`self.prompt.<name>`, `self.survey.<name>...`). Without the declaration, a reference was accepted if _any_ intro sequence in the file provided the key — even when the batch ran a different one, where the reference silently never resolves and the participant gets stuck. With it:

- Every game/exit/`groupComposition` reference to intro-provided data must resolve in **every** listed sequence (unless an earlier stage in the treatment itself produces the key). If a reference's key exists only in a sequence you didn't list, the error hints at adding that sequence.
- A name that doesn't match any defined intro sequence is an error (the message lists the defined names); listing the same name twice is a warning.
- Storage-key collision checks between intro sequences and treatments run only for declared pairs — a key shared with a sequence the treatment never follows isn't a collision any participant can experience.
- At batch launch, the host verifies the selected intro sequence is one that every selected treatment lists (see `checkPairing` in the [engineer docs](../engineer/integration-guide.md)).

Listing multiple sequences is normal when different recruitment pathways feed the same treatments — references must then resolve in all of them:

```yaml
introSequences: [prolific_en, prolific_es] # refs must resolve in BOTH
```

`${field}` placeholders work here the same way they do in `groupComposition` — the whole field or individual items can be placeholders, filled at template-expansion time:

```yaml
introSequences: ${sequences} # whole field
introSequences: [${pathway}_onboarding] # per item
```

## Consent

Consent used to be platform-owned content, outside the treatment file. Declaring `consent:` makes it a first-class part of the study — version-controlled with everything else, localizable, varied per jurisdiction, and interactive (comprehension-gated consent). The field is **additive**: a file without `consent:` gets the host platform's existing consent behavior.

`consent:` is a top-level array of named **arms**, a sibling of `introSequences:` and `treatments:`:

```yaml
consent:
  - name: consent-en
    locale: en
    steps:
      - name: consent-info
        elements:
          - type: prompt
            file: consent/en/study_information.prompt.md
          - type: prompt
            file: consent/en/acknowledge.prompt.md
            name: acknowledge
          - type: submitButton
            buttonText: I consent
            conditions:
              - reference: self.prompt.acknowledge
                comparator: exists
```

- **The host selects one arm by name** (a `consentName`-style batch-config field). Arm names must be unique within `consent:` only — collection namespaces are separate, so a consent arm, an intro sequence, and a treatment may all be named `default`.
- **Arms declare their own locale.** Consent runs before treatment assignment, so it can't inherit a treatment's locale — same as intro sequences. Two arms may share a locale (e.g., different jurisdictions in the same language). For single-source localized consent, see [the `consentArm` template pattern](templates.md#single-source-localized-consent).
- **Consent is study-level, not per-treatment.** It's an IRB artifact, invariant across manipulations — which is why there's no pairing field like `introSequences:`. Consent's only obligation to the rest of the study is negative: don't collide. Storage keys in consent arms are collision-checked against **every** intro sequence and **every** treatment; reusing a key across two arms is fine (a participant only ever sees one arm).
- **Consent steps follow the intro-step rules**: each step needs an advancement element, no `shared` prompts, no position fields (consent runs pre-assignment, for a single participant).

### The gated-submit pattern

The example above is the sanctioned way to gate consent: an "I consent" submit button conditioned on acknowledgement checkboxes in the same step. Element conditions re-evaluate live against in-memory responses, so the button enables as soon as the boxes are checked — no extra machinery. Multi-step arms work the same way: a later consent step may reference responses from an earlier step in the same arm.

### Consent responses are audit-only

Consent responses join the same flat key namespace as everything else and ride the normal save/export machinery — but they are a **closed scope**. Referencing a consent key from anywhere outside consent (intro, game, exit, `groupComposition`, debrief) is a validation error. Within-arm references are legal (that's the gating pattern), and consent steps can't reference later-phase data (consent runs first). If a decision downstream should depend on something a participant tells you, ask it in an intro step, not in consent.

### The responses are the record

There is no separate consent-audit artifact. The consent content is version-controlled in the study repo, the batch records which version it ran, and the saved responses carry timestamps — together, (repo version + responses + timestamps) reconstructs exactly what was shown and what was agreed to.

### Author consent in its own file, pulled in via `imports:`

Consent is a **site parameter, not part of the reproducible instrument**: a replicator at another institution must swap it, because their IRB owns and verifies that language. What stagebook makes reusable is the consent _machinery_ (localization, gating, storage, validation) — the text is meant to be swapped. So package it to be swapped cleanly:

- Keep the `consent:` arms (or the templates that generate them) in their **own file**, and pull them into the study with one `imports:` line — not inline in the treatment file. `imports:` resolves at hydration, so imported consent still gets the schema slot, per-locale arms, and every collision and audit-only check; a replicator repoints one line at their institution's consent module and touches nothing else in the study.
- **Consent modules are per-institution.** Institutions maintain their own importable modules (e.g. `imports: [@your-inst/consent-gdpr]`) carrying their jurisdiction/IRB language; a study composes those plus a study-specific addendum. Module authors should use distinctive prompt names — a collision with a study key is a design-time validation error either way.
- **Checking that the consent covers what the study does**: point an LLM at the consent text plus the treatment file and ask whether they're compatible. There is deliberately no tag/capability validator for this — natural-language review handles free-text IRB prose better than a controlled vocabulary would (see the [ADR](../decisions/2026-07-consent-debrief.md#alternatives-considered)).

## Debrief

`debrief:` is an optional per-treatment step list, a sibling of `exitSequence:`. The host renders it **after** its own wrap-up steps (quality checks, completion code) — the very last thing a participant sees. Like `exitSequence`, it inherits the treatment's locale and key scope, and its steps follow the exit-step rules (advancement element required, no `shared` prompts). Absent `debrief:` means the host's existing debrief behavior.

Because debrief is per-treatment, **per-condition debriefs are just different treatment arms** — a deception arm carries a full-disclosure debrief the control arm doesn't need. For **per-participant** variation within a treatment, use step `conditions:`:

```yaml
treatments:
  - name: deception_arm
    playerCount: 2
    introSequences: []
    gameStages:
      - name: main_task
        duration: 300
        elements:
          - type: prompt
            file: game/task.prompt.md
          - type: submitButton
    exitSequence:
      - name: post_survey
        elements:
          - type: prompt
            file: exit/distress_check.prompt.md
            name: distress_check
          - type: submitButton
    debrief:
      - name: full-disclosure
        elements:
          - type: prompt
            file: debrief/full_disclosure.prompt.md
          - type: submitButton
            buttonText: Finish
      - name: extra-support
        conditions: # per-participant: only shown to those who reported distress
          - reference: self.prompt.distress_check
            comparator: equals
            value: "Yes"
        elements:
          - type: prompt
            file: debrief/support_resources.prompt.md
          - type: submitButton
```

Debrief runs last, so its references may read data from any earlier phase — game, exit, or intro (intro references are subject to the [pairing rule](#pairing-treatments-with-intro-sequences), and consent keys stay off-limits per the audit-only rule). Nothing may reference a debrief key from an earlier phase — that's a forward reference.

## Stages

Each game stage has:

| Field        | Type    | Required | Description                                                                       |
| ------------ | ------- | -------- | --------------------------------------------------------------------------------- |
| `name`       | string  | yes      | Identifier for logging (not shown to participants)                                |
| `duration`   | integer | yes      | Stage length in seconds                                                           |
| `discussion` | object  | no       | Video/text chat configuration (see [Discussions](discussions.md))                 |
| `elements`   | array   | yes      | UI elements displayed during the stage                                            |
| `notes`      | string  | no       | Researcher-facing rationale, citations, or design decisions (see [Notes](#notes)) |

Intro and exit steps have `name` and `elements` but no `duration` (they are untimed).

## Notes

Any treatment, stage, intro/exit step, element, template, or introSequence can carry a `notes` field. Notes are **researcher-facing only** — they're visible in the viewer and to authoring tools, but the platform runtime strips them before any data reaches participants.

Use YAML's block scalar syntax (`|`) for multi-line markdown:

```yaml
- name: story_ratings
  duration: 180
  notes: |
    Adapted from the narrative engagement scale (Busselle & Bilandzic, 2009).

    We use 5 items instead of the original 12 to reduce participant fatigue.
  elements:
    - type: prompt
      file: task/story_well_told.prompt.md
```

> `notes` replaces the old `desc` field. Treatment files that still use `desc` will fail validation — rename them to `notes`.

## Positions

When players join a group, each is assigned a zero-based position index (0, 1, 2, ...). Use positions to control what each participant sees:

```yaml
elements:
  - type: prompt
    file: game/democrat_instructions.prompt.md
    showToPositions: [0]
  - type: prompt
    file: game/republican_instructions.prompt.md
    showToPositions: [1]
```

Positions are consistent for the entire treatment. Use `showToPositions` and `hideFromPositions` on elements and discussions.

## Group Composition

Optionally define requirements for who fills each position:

```yaml
treatments:
  - name: cross_partisan
    playerCount: 2
    introSequences: [onboarding] # the sequence that runs the partyAffiliation survey
    groupComposition:
      - position: 0
        title: "Democrat"
        conditions:
          - reference: self.survey.partyAffiliation.result.normPosition
            comparator: isBelow
            value: 0.5
      - position: 1
        title: "Republican"
        conditions:
          - reference: self.survey.partyAffiliation.result.normPosition
            comparator: isAbove
            value: 0.5
```

(Reference strings start with a position selector — `self` for the participant being checked against this slot, plus `shared`, `all`, or a numeric index for other reads. See [conditions](conditions.md) for the full rules; #298 made the prefix mandatory.)

Positions must be unique and cover 0 through `playerCount - 1`.

## Media and asset references

Elements that point at media (`mediaPlayer.file`, `image.file`, `audio.file`, `prompt.file`, `mediaPlayer.captionsFile`) accept three reference forms. Pick based on who owns the asset.

### 1. Relative path — bundled with the treatment

```yaml
- type: mediaPlayer
  file: shared/training.mp4
```

The file lives in the treatment's own directory (or a sibling directory like `shared/`) and ships to the platform alongside the YAML. Use this for public, stable assets that are appropriate to commit to the repo.

### 2. Full URL — hosted at a fixed, public endpoint

```yaml
- type: mediaPlayer
  file: https://youtu.be/QC8iQqtG0hg
```

`http://` or `https://`. The browser fetches the URL directly; the platform doesn't rewrite it. Use this for CDN links, YouTube embeds, or any asset whose public URL won't change.

### 3. `asset://` — platform-provided

```yaml
- type: mediaPlayer
  # Video is sensitive and can't live in the repo. Each platform
  # supplies the URL at task time (S3 presigned URL, local file server,
  # CDN — implementation is host-specific).
  file: asset://group_recordings/session_001.mp4
```

`asset://path/to/file` means _the platform will resolve this_. Stagebook passes the URI through `getAssetURL()`, and each host (annotator, viewer, VS Code extension) implements its own resolution strategy. `asset://` references are explicitly excluded from `getReferencedAssets()` — they aren't repo files.

Use `asset://` for:

- **Sensitive media** — recordings, identifiable audio, or anything that shouldn't sit in version control.
- **Large binaries** — files that would bloat the repo or exceed git/LFS limits.
- **Host-specific storage** — an S3 bucket you own, a Box folder, a local dev server's asset directory.
- **Swappability** — swap the underlying file without editing the treatment.

### `${field}` placeholders — per-task variable media

Distinct from `asset://`: use a field when the asset _varies from task to task_.

```yaml
- type: mediaPlayer
  # Each participant gets a different recording (their partner's
  # previous-round video). Filled in from the task CSV / API call.
  file: ${partnerVideoUrl}
```

The task definition supplies the value at creation time. The value itself can be any of the three forms above (relative path, full URL, or `asset://`).

### Choosing between the three

| Asset is the same every task? | Asset is in the repo? | Reference form |
| ----------------------------- | --------------------- | -------------- |
| yes                           | yes                   | relative path  |
| yes                           | no — public URL       | full URL       |
| yes                           | no — host storage     | `asset://…`    |
| no (varies per task)          | —                     | `${fieldName}` |

## Naming Rules

Names (for stages, elements, treatments, etc.) must be:

- 1 to 64 characters
- Letters, numbers, spaces, `_`, `-`
- May include template placeholders like `${fieldName}`

## Validating

The same validator the VS Code extension uses is available as a CLI you can run on any treatment or prompt file. It works without an `npm install` in your study repo — `npx` fetches the package on demand:

```bash
npx --package=stagebook stagebook validate study.stagebook.yaml
```

Dispatches by suffix: `.stagebook.yaml` → treatment validator, `.prompt.md` → prompt validator. Multiple files and globs both work:

```bash
npx --package=stagebook stagebook validate \
  'stagebook/**/*.stagebook.yaml' \
  'prompts/**/*.prompt.md'
```

### Flags

| Flag                       | Effect                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `--format=json`            | Machine-readable output (see schema below)                          |
| `--type=treatment\|prompt` | Required when reading from stdin (`-`)                              |
| `--no-expand`              | Skip template expansion + import resolution; checks raw syntax only |
| `--allow-empty`            | Exit 0 when a glob matches no files (default: exit 2)               |
| `-h, --help`               | Print usage                                                         |

### Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| `0`  | No errors (warnings OK, or nothing to report)                               |
| `1`  | At least one error in at least one file                                     |
| `2`  | A file couldn't be read, YAML was unparseable, or a glob matched zero files |

### JSON output schema

```json
{
  "files": [
    {
      "path": "study.stagebook.yaml",
      "diagnostics": [
        {
          "severity": "error",
          "message": "Game-stage conditions must use a cross-client position prefix…",
          "range": {
            "startLine": 353,
            "startCol": 14,
            "endLine": 353,
            "endCol": 18
          }
        }
      ]
    }
  ],
  "unreadable": [
    { "path": "missing.stagebook.yaml", "message": "could not read: ENOENT…" }
  ],
  "summary": { "errors": 1, "warnings": 0, "files": 1 }
}
```

Positions are **0-based** in JSON (LSP convention; same shape as the `Diagnostic` type exported from `stagebook/validate`). The default text output formats positions as **1-based** for editor jump-to-location.

### Pre-commit hook in study repos

If your study repo uses pre-commit hooks, add a stagebook-validate step. For [pre-commit](https://pre-commit.com):

```yaml
- repo: local
  hooks:
    - id: stagebook-validate
      name: Validate Stagebook files
      entry: npx --package=stagebook stagebook validate
      language: system
      files: '\.(stagebook\.yaml|prompt\.md)$'
      pass_filenames: true
```

### Adding the agent-facing instruction to your study repo

If your repo has a `CLAUDE.md` (or any agent-instruction file), add this block so agents validate their own work before declaring a task done:

> ## Treatment authoring
>
> After editing any `.stagebook.yaml` or `.prompt.md` file, run:
>
> ```bash
> npx --package=stagebook stagebook validate <file>
> ```
>
> Resolve all errors. For machine-readable output use `--format=json`; the JSON schema is documented [here](https://github.com/deliberation-lab/stagebook/blob/main/docs/researcher/treatment-files.md#json-output-schema). Exit codes: `0` clean, `1` schema errors, `2` couldn't read.

Without this hook agents can edit treatment files but have no way to check their own work — the only signal that something is wrong reaches them after you open VS Code, read the Problems panel, and paste the error back.
