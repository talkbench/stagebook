# Stagebook Validate — GitHub Action

Validate Stagebook treatment (`.stagebook.yaml`) and prompt (`.prompt.md`)
files in CI. It's a thin wrapper around the bundled CLI
(`npx --package=stagebook stagebook validate`), so it works in **study repos
that have no JS toolchain** — no `package.json`, no `node_modules`. The action
sets up Node, runs the published validator, and fails the job on any error.

## Usage

```yaml
name: Validate treatments
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: talkbench/stagebook/validate-action@v1
        with:
          # One entry per line. A block scalar avoids YAML's leading-`*`
          # alias pitfall; the action passes globs to the CLI intact.
          files: |
            stagebook/**/*.stagebook.yaml
            prompts/**/*.prompt.md
          version: "0.21.0" # pin for reproducible validation
```

The CLI dispatches by suffix (`.stagebook.yaml` → treatment validator,
`.prompt.md` → prompt validator), and by default expands templates and
resolves `imports:` before checking the schema — so errors that only appear
after template substitution are caught. Diagnostics are printed as
`path:line:col: severity: message`, and (in the default `text` format) also
surfaced as inline annotations on the PR via a problem matcher.

## Passing globs

Do **not** wrap glob entries in extra quotes. The action disables shell
globbing internally (`set -f`) and hands globs to the CLI, which expands them
recursively with its own globber. Wrapping an entry in quotes (e.g.
`"'**/*.yaml'"`) would pass literal quote characters through and match nothing.

The reason to use a block scalar (`files: |`) or a quoted YAML string is
_YAML_, not the shell: a bare scalar beginning with `*` is parsed as a YAML
alias. One entry per line sidesteps that and reads cleanly.

Entries are split on whitespace, so an individual path or glob **cannot
contain spaces** — `my study/**/*.stagebook.yaml` is read as two entries.
Keep Stagebook files in space-free paths (they normally are).

## Inline annotations and `working-directory`

The problem matcher resolves diagnostic file paths against the repository
root. The CLI prints them relative to its working directory, so inline PR
annotations land on the right files only when `working-directory` is the repo
root (the default). If you set `working-directory` to a subdirectory,
validation still passes/fails the job correctly, but the inline annotations
may not attach — prefer repo-root-relative globs over `working-directory`.

## Inputs

| Input               | Default    | Description                                                                                       |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| `files`             | (required) | Files/globs to validate, whitespace- or newline-separated.                                        |
| `version`           | `latest`   | stagebook npm version: exact (`0.21.0`), a range, or `latest`. Pin for reproducibility.           |
| `format`            | `text`     | `text` (with inline annotations) or `json` (machine-readable to stdout).                          |
| `node-version`      | `24`       | Node.js version to set up.                                                                        |
| `working-directory` | `.`        | Directory to run validation in.                                                                   |
| `allow-empty`       | `false`    | When `true`, a glob matching no files is not an error (`--allow-empty`).                          |
| `no-expand`         | `false`    | When `true`, check raw syntax only — skip template expansion + import resolution (`--no-expand`). |

## Exit / job status

The job passes or fails on the CLI's exit code:

- `0` — no errors (warnings are allowed)
- `1` — at least one validation error
- `2` — a file couldn't be read, YAML was unparseable, a glob matched zero
  files (override with `allow-empty: true`), or the inputs were invalid

## Versioning

Pin the action to a released major tag — `validate-action@v1` — so a study
repo's CI is stable. Independently, pin the `version:` input to an exact
stagebook release for byte-for-byte reproducible validation; leaving it at
`latest` always uses the newest published rules.
