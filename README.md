# Stagebook

Executable study protocols for small group conversation studies. A stagebook defines everything that happens in an experiment - what gets shown to whom, when, and under what conditions - to enable complete documentation and perfect replication.

## What is Stagebook?

Stagebook defines a declarative language for specifying interactive group experiments: stages, elements (prompts, surveys, timers, discussion windows), conditional logic, templates, and participant positioning.

This repository provides supporting infrastructure for translating stagebook manifests into automated experiments:

- **Zod schemas** that validate treatment files and prompt files
- **A template engine** for parameterized experiment designs with broadcast expansion
- **Shared utilities** for condition evaluation and reference resolution
- **React components** that render Stagebook elements into participant-facing UI

Stagebook is platform-agnostic. Define your study protocol once, then run it on any compatible platform.

**[Try the Viewer](https://deliberation-lab.github.io/stagebook/viewer/)** — walk through any study from the participant's perspective. Paste a GitHub URL to a treatment file, or explore the built-in examples.

## Installation

From GitHub (builds automatically on install):

```bash
npm install deliberation-lab/stagebook
```

Peer dependencies: `zod >= 3.23`, `js-yaml >= 4`. React components additionally peer-depend on `react >= 18` and `react-dom >= 18`.

## Usage

### Validating a treatment file

```typescript
import { treatmentFileSchema } from "stagebook";
import { load as loadYaml } from "js-yaml";

const config = loadYaml(yamlString);
const result = treatmentFileSchema.safeParse(config);

if (!result.success) {
  console.error(result.error.issues);
}
```

### Validating a prompt file

`promptFileSchema` takes raw markdown, parses it, and validates structure, metadata, response format, and slider labels in a single pass:

```typescript
import { promptFileSchema } from "stagebook";

const result = promptFileSchema.safeParse(markdownString);

if (result.success) {
  const { metadata, body, responseItems } = result.data;
  // metadata: parsed and validated YAML frontmatter
  // body: the prompt text
  // responseItems: parsed response options (prefix-stripped)
} else {
  console.error(result.error.issues);
}
```

### Evaluating conditions

```typescript
import { compare } from "stagebook";

compare(5, "isAbove", 3); // true
compare("hello", "includes", "ell"); // true
compare(undefined, "exists"); // false
compare(undefined, "doesNotEqual", "x"); // true
```

The 16 canonical comparators: `exists`, `doesNotExist`, `equals`, `doesNotEqual`, `isAbove`, `isBelow`, `isAtLeast`, `isAtMost`, `hasLengthAtLeast`, `hasLengthAtMost`, `includes`, `doesNotInclude`, `matches`, `doesNotMatch`, `isOneOf`, `isNotOneOf`.

### Parsing reference strings

```typescript
import { getReferenceKeyAndPath } from "stagebook";

getReferenceKeyAndPath("survey.bigFive.result.score");
// { referenceKey: "survey_bigFive", path: ["result", "score"] }

getReferenceKeyAndPath("prompt.myQuestion");
// { referenceKey: "prompt_myQuestion", path: ["value"] }
```

Supported namespaces: `survey`, `submitButton`, `qualtrics`, `prompt`, `trackedLink`, `timeline`, `discussion`, `entryUrl`, `connectionInfo`, `browserInfo`, `participantInfo`. (`urlParams` was renamed to `entryUrl` in #246.) `entryUrl` references must use the `params` subpath, e.g. `getReferenceKeyAndPath("entryUrl.params.foo")`.

### Expanding templates

```typescript
import { fillTemplates } from "stagebook";

const result = fillTemplates({
  obj: treatmentConfig,
  templates: treatmentConfig.templates,
});
```

The template engine supports field substitution (`${fieldName}`), nested templates, and multi-dimensional broadcast expansion.

## API Reference

### Schemas

| Export                  | Description                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `treatmentFileSchema`   | Top-level schema for a treatment YAML file (templates, introSequences, treatments)                   |
| `treatmentSchema`       | Single treatment with playerCount, gameStages, exitSequence                                          |
| `stageSchema`           | Game stage with name, duration, elements, discussion; validates element time bounds against duration |
| `elementSchema`         | Any DSL element (prompt, display, survey, timer, etc.) with conditional rendering support            |
| `promptSchema`          | Prompt element with file reference and optional shared flag                                          |
| `discussionSchema`      | Discussion config (chat type, layout, rooms, visibility)                                             |
| `conditionSchema`       | Condition with reference, comparator, value, and position                                            |
| `referenceSchema`       | DSL reference string validator                                                                       |
| `promptFileSchema`      | Parses and validates a complete prompt markdown file                                                 |
| `metadataTypeSchema`    | Prompt metadata field types and constraints                                                          |
| `metadataRefineSchema`  | Cross-field metadata validation (e.g., slider requires min/max/interval)                             |
| `templateContextSchema` | Template reference with fields and broadcast dimensions                                              |
| `templateSchema`        | Named template definition with content type                                                          |

All schemas export corresponding TypeScript types (e.g., `TreatmentType`, `StageType`, `ElementType`).

### Utilities

| Export                              | Description                                                    |
| ----------------------------------- | -------------------------------------------------------------- |
| `compare(lhs, comparator, rhs?)`    | Evaluate a condition. Returns `boolean \| undefined`           |
| `Comparator`                        | String literal union type of the 16 canonical comparator names |
| `getReferenceKeyAndPath(reference)` | Parse a DSL reference string into storage key + nested path    |
| `getNestedValueByPath(obj, path?)`  | Traverse a nested object by path array                         |

### Templates

| Export                                          | Description                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `fillTemplates({ obj, templates })`             | Expand all template references and validate no placeholders remain |
| `expandTemplate({ templates, context })`        | Expand a single template context with fields and broadcast         |
| `substituteFields({ content, fields })`         | Replace `${key}` placeholders with values                          |

## Documentation

### For Researchers (designing experiments)

- [Treatment Files](docs/researcher/treatment-files.md) — how to structure a `.stagebook.yaml` file
- [Page Elements](docs/researcher/elements.md) — all element types and their options
- [Prompt Files](docs/researcher/prompts.md) — markdown format for prompts, sliders, surveys
- [Conditions & References](docs/researcher/conditions.md) — conditional display and data references
- [Discussions](docs/researcher/discussions.md) — text chat, video calls, breakout rooms, custom layouts
- [Templates](docs/researcher/templates.md) — reusable structures with field substitution and broadcast
- [Syntax Reference](docs/researcher/syntax-reference.md) — compact cheat sheet for the full language

### For Engineers (integrating Stagebook)

- [Integration Guide](docs/engineer/integration-guide.md) — implementing a StagebookProvider backend
- [Platform Requirements](docs/engineer/platform-requirements.md) — what the host platform must provide (state, orchestration, group formation, services)
- [API Reference](docs/engineer/api-reference.md) — all exports, types, and component props
- [Architecture](docs/engineer/architecture.md) — StagebookProvider design, three-layer component model, render slots, CSS theming

## License

MIT
