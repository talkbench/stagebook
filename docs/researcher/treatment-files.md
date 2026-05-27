# Writing Treatment Files

A treatment file is a YAML document (`.stagebook.yaml`) that defines the complete flow of an interactive experiment. It specifies when and to whom different elements are displayed, under what conditions, and in what sequence — but not the content itself. Content such as prompts, instructions, and surveys are written separately in Markdown files and referenced within the treatment file.

## File Structure

A Stagebook file may have any subset of these top-level sections:

```yaml
imports: # optional — relative paths to other Stagebook files whose templates: should be merged in
templates: # optional — reusable blocks of structure
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
