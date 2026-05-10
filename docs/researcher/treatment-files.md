# Writing Treatment Files

A treatment file is a YAML document (`.stagebook.yaml`) that defines the complete flow of an interactive experiment. It specifies when and to whom different elements are displayed, under what conditions, and in what sequence — but not the content itself. Content such as prompts, instructions, and surveys are written separately in Markdown files and referenced within the treatment file.

## File Structure

Every treatment file has three top-level sections:

```yaml
templates:       # optional — reusable blocks of structure
introSequences:  # required — pre-randomization onboarding steps
treatments:      # required — post-randomization experiment flows
```

Everything is validated after templates are expanded. Unfilled `${field}` placeholders or unresolved template blocks are errors.

## Experiment Lifecycle

Each study follows a three-phase structure:

### 1. Intro Sequence (asynchronous, solo)

Completed individually before group assignment. Typically includes consent, setup checks, and researcher-defined surveys or prompts. You can define multiple intro sequences, but each batch uses exactly one.

### 2. Game Stages (synchronous, group)

The live portion where participants move through stages simultaneously. Each treatment defines a unique pathway. You can host video or text conversations, insert prompts between discussions, show different content to different positions, and include timers and submit buttons.

### 3. Exit Sequence (asynchronous, solo)

Post-game follow-up at each participant's pace: surveys, quality checks, debriefing. Defined per-treatment, so different conditions can have different exit flows.

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

## Stages

Each game stage has:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Identifier for logging (not shown to participants) |
| `duration` | integer | yes | Stage length in seconds |
| `discussion` | object | no | Video/text chat configuration (see [Discussions](discussions.md)) |
| `elements` | array | yes | UI elements displayed during the stage |
| `notes` | string | no | Researcher-facing rationale, citations, or design decisions (see [Notes](#notes)) |

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
    groupComposition:
      - position: 0
        title: "Democrat"
        conditions:
          - reference: survey.partyAffiliation.result.normPosition
            comparator: isBelow
            value: 0.5
      - position: 1
        title: "Republican"
        conditions:
          - reference: survey.partyAffiliation.result.normPosition
            comparator: isAbove
            value: 0.5
```

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

`asset://path/to/file` means *the platform will resolve this*. Stagebook passes the URI through `getAssetURL()`, and each host (annotator, viewer, VS Code extension) implements its own resolution strategy. `asset://` references are explicitly excluded from `getReferencedAssets()` — they aren't repo files.

Use `asset://` for:

- **Sensitive media** — recordings, identifiable audio, or anything that shouldn't sit in version control.
- **Large binaries** — files that would bloat the repo or exceed git/LFS limits.
- **Host-specific storage** — an S3 bucket you own, a Box folder, a local dev server's asset directory.
- **Swappability** — swap the underlying file without editing the treatment.

### `${field}` placeholders — per-task variable media

Distinct from `asset://`: use a field when the asset *varies from task to task*.

```yaml
- type: mediaPlayer
  # Each participant gets a different recording (their partner's
  # previous-round video). Filled in from the task CSV / API call.
  file: ${partnerVideoUrl}
```

The task definition supplies the value at creation time. The value itself can be any of the three forms above (relative path, full URL, or `asset://`).

### Choosing between the three

| Asset is the same every task? | Asset is in the repo? | Reference form |
|---|---|---|
| yes | yes | relative path |
| yes | no — public URL | full URL |
| yes | no — host storage | `asset://…` |
| no (varies per task) | — | `${fieldName}` |

## Naming Rules

Names (for stages, elements, treatments, etc.) must be:
- 1 to 64 characters
- Letters, numbers, spaces, `_`, `-`
- May include template placeholders like `${fieldName}`
