## Treatment authoring

After editing any `.stagebook.yaml` or `.prompt.md` file, validate it before reporting the task as done:

```bash
npx --package=stagebook stagebook validate <file>
```

Resolve all errors. The CLI dispatches by suffix (`.stagebook.yaml` → treatment validator, `.prompt.md` → prompt validator), expands templates and resolves `imports:` by default, and exits non-zero on errors.

For machine-readable output:

```bash
npx --package=stagebook stagebook validate --format=json <file>
```

JSON shape (one entry per file with any diagnostics):

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
  "unreadable": [],
  "summary": { "errors": 1, "warnings": 0, "files": 1 }
}
```

Positions in JSON are 0-based (LSP convention); the text output formats them 1-based for editor jump-to-location. Exit codes: `0` clean, `1` errors, `2` couldn't read / unparseable / glob matched zero files. Use `--no-expand` to skip template expansion when you want to check raw syntax only, and `-` (with `--type=treatment|prompt`) to read from stdin.

## Workflow

### TDD (Red/Green/Refactor)

1. **Red:** Write a failing test that expresses desired behavior
2. **Green:** Write the minimum code to make it pass
3. **Refactor:** Clean up while keeping tests green

Never skip the red step. Tests document intent.

### Git Process

- **Fast-forward only** merges (no merge commits, no squash)
- **Pre-commit hook:** lint-staged runs Prettier + ESLint on staged files
- **Pre-push hook:** full lint + all tests across workspaces
- **CI:** format check, lint, backend tests, frontend tests, Playwright e2e

### Issues and PRs

- Design decisions are discussed in GitHub issues before implementation
- Every PR references its issue
- PRs must pass CI before merge
- Key decisions are recorded in `docs/decisions/` as ADRs (link back to the issue for full context)
- Check `docs/decisions/` for architectural context before proposing changes to core systems
- When a PR closes multiple issues, repeat the keyword for each one — `Fixes #331, fixes #359, fixes #360`. The comma-list form `Fixes #331, #359, #360` only auto-closes the first issue; the rest stay open silently.

## Conventions

### Code Style

- Prettier: double quotes, semicolons, trailing commas, 80 char width
- ESLint 9 flat config, zero warnings policy
- TypeScript with type-checked ESLint rules
- TypeScript in backend and shared; TypeScript in frontend when appropriate

### Architecture Principles

- Keep code clear enough for a human to audit every line
- Minimize complexity; refactor when new features complicate existing architecture

### Component Design

Stagebook components are **measurement instruments**, not general-purpose UI. The goal is that the same Stagebook version produces identical participant experiences across platforms and deployments.

- **Reproducibility over composability.** Baked-in behavior (keystroke stats, paste detection, debounce timing, unanchored slider) is intentional — it's what makes experiments standardized. Don't separate it out.
- **No external UI library dependencies.** Don't import Radix, shadcn, etc. Use them as references to audit our implementations for accessibility and edge cases, but keep full ownership so upstream changes can't alter experiment behavior.
- **Slider initializes without a visible thumb** to avoid anchoring participants' responses.
- **Two tiers of components:**
  - **Standalone** (Markdown, Button, Separator, form components) — no StagebookProvider needed, usable anywhere
  - **Context-dependent** (Element, Prompt, Display, conditionals) — require StagebookProvider, error clearly without one

### Testing

- **Unit/integration tests:** vitest — co-located as `*.test.ts` alongside source files
- **Component tests:** Playwright component testing (`*.test.tsx`) for React components
- **Fixtures:** in `fixtures/` directories adjacent to tests that need them

### Source

- Extracted from `deliberation-lab/deliberation-empirica`
- Client versions of duplicated code are canonical (they're supersets)
- JS files are converted to TypeScript during extraction

## Project Structure

This is an **npm workspaces monorepo** with two packages:

```
stagebook/                          # workspace root
├── packages/
│   └── stagebook/                  # npm library: stagebook
│       ├── src/
│       │   ├── schemas/
│       │   │   ├── treatment.ts          # treatmentFileSchema, element/stage/condition/discussion/template schemas + types
│       │   │   ├── promptFile.ts         # metadataTypeSchema, metadataRefineSchema, metadataLogicalSchema, validateSliderLabels
│       │   │   └── index.ts              # re-exports all schemas and types
│       │   ├── templates/
│       │   │   └── fillTemplates.ts      # substituteFields, expandTemplate, fillTemplates, recursivelyFillTemplates
│       │   ├── utils/
│       │   │   ├── compare.ts            # compare() — unified from server+client, Comparator type
│       │   │   ├── reference.ts          # getReferenceKeyAndPath(), getNestedValueByPath()
│       │   │   └── parsePromptFile.ts    # parsePromptFile() → { metadata, body, responseItems }
│       │   ├── components/
│       │   │   ├── StagebookProvider.tsx  # context definition + useStagebookContext, useResolve, useSave, useElapsedTime hooks
│       │   │   ├── Element.tsx           # element type router
│       │   │   ├── elements/             # Prompt, Display, Separator, SubmitButton, AudioElement, TrainingVideo, KitchenTimer, TrackedLink, Image
│       │   │   ├── conditions/           # TimeConditionalRender, PositionConditionalRender, ConditionsConditionalRender
│       │   │   └── form/                 # RadioGroup, CheckboxGroup, TextArea, Slider, ListSorter, Markdown, Button
│       │   └── index.ts                  # top-level re-exports (schemas, utils, templates)
│       ├── playwright/                   # Playwright CT test infrastructure
│       ├── package.json                  # stagebook
│       ├── tsconfig.json
│       ├── tsup.config.ts                # dual CJS/ESM + dts generation
│       ├── vitest.config.ts
│       ├── playwright-ct.config.ts
│       └── eslint.config.js              # ESLint 9 flat config
├── apps/
│   └── viewer/                     # Vite SPA: interactive study previewer
│       ├── src/
│       ├── package.json            # stagebook-viewer (private)
│       ├── tsconfig.json
│       └── vite.config.ts
├── docs/                           # repo-level documentation
├── package.json                    # workspace root (private, not published)
├── .prettierrc                     # shared formatting config
├── .husky/                         # git hooks
├── .github/workflows/              # CI workflows
├── CLAUDE.md
└── README.md
```

### Workspaces

- **Root scripts** delegate to all workspaces: `npm run build`, `npm test`, `npm run lint`
- **Library-specific commands**: `npm run build -w stagebook`
- **Viewer-specific commands**: `npm run dev -w stagebook-viewer`
- The viewer imports the library via workspace link (resolves to source, not published npm)

### Package Exports

- `stagebook` — schemas, utils, templates (no React dependency)
- `stagebook/components` — React components, StagebookProvider (peer-depends on React)
- `stagebook/validate` — `validateTreatmentSource`, `validatePromptSource`, `loadAndMergeImports`, `expandAndValidateWithImports`, `Diagnostic` type, and position-mapping helpers. Used by the VS Code extension, the viewer, and the CLI; consumed externally by manager / deliberation-lab / annotator
- `stagebook` bin — the `stagebook` CLI (subcommands: `validate`). Reached via `npx --package=stagebook stagebook <cmd>` in study repos that don't otherwise have a JS toolchain

Each directory has an `index.ts` barrel; `src/index.ts` re-exports the full public API for the main entrypoint.
