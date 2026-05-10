# Templates

Templates let you define reusable blocks of YAML and instantiate them with different parameters. This is useful when you have multiple treatments that share the same structure but differ in a few values (e.g., discussion topics, prompt files, or timing).

## Defining Templates

Templates are defined in the `templates` section of your treatment file:

```yaml
templates:
  - name: topicStage
    contentType: stage
    content:
      name: ${topicName}_discussion
      duration: 300
      discussion:
        chatType: video
        showNickname: true
        showTitle: false
      elements:
        - type: prompt
          file: topics/${topicName}_prompt.md
        - type: submitButton
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Unique identifier |
| `contentType` | yes | What the template produces. One of: `element`, `elements`, `stage`, `stages`, `treatment`, `treatments`, `introSequence`, `introSequences`, `introExitStep`, `introSteps`, `exitSteps`, `condition`, `conditions`, `reference`, `player`, `groupComposition`, `discussion`, `broadcastAxisValues` |
| `notes` | no | Researcher-facing comments (one-liner or multi-line) |
| `content` | yes | The YAML structure to instantiate |

## Using Templates

Place a template context wherever the content type would normally appear:

```yaml
gameStages:
  - template: topicStage
    fields:
      topicName: immigration
  - template: topicStage
    fields:
      topicName: healthcare
```

This produces two stages with different topic names substituted throughout.

## Field Substitution

Placeholders use the `${fieldName}` syntax. They can appear in string values, as standalone values (replaced with objects or arrays), or embedded within larger strings:

```yaml
content:
  name: ${prefix}_study           # embedded in a string
  file: ${promptFile}             # standalone (can be any type)
  message: "Hello ${name}!"       # embedded in a string
```

Field keys can contain letters, numbers, and underscores.

## Broadcast Expansion

Use `broadcast` to generate a cartesian product of parameter combinations:

```yaml
- template: topicStage
  fields:
    prefix: trial_${d0}_${d1}
  broadcast:
    d0:
      - topicName: immigration
      - topicName: healthcare
    d1:
      - difficulty: easy
      - difficulty: hard
```

This produces 4 stages (2 topics x 2 difficulties). Each broadcast axis is named `d0`, `d1`, `d2`, etc. The axis index is available as `${d0}`, `${d1}`, etc.

### Broadcast Rules

- Each axis is an array of field maps
- The cartesian product of all axes is computed
- Each combination substitutes its fields into a copy of the template
- Index values (`d0`, `d1`, ...) are injected as string indices (0, 1, 2, ...)

## Nesting Templates

Templates can reference other templates:

```yaml
templates:
  - name: outerTemplate
    contentType: treatment
    content:
      name: ${treatmentName}
      playerCount: 2
      gameStages:
        - template: innerStage
          fields:
            topic: ${topicName}

  - name: innerStage
    contentType: stage
    content:
      name: ${topic}_stage
      duration: 300
      elements:
        - type: prompt
          file: ${topic}_prompt.md
```

Templates are expanded recursively until no template blocks remain.

## Templates in Broadcast Axes

A broadcast axis can itself be a template reference:

```yaml
templates:
  - name: topicList
    contentType: broadcastAxisValues
    content:
      - topicName: immigration
      - topicName: healthcare
      - topicName: education

treatments:
  - template: topicStage
    broadcast:
      d0:
        template: topicList
```

## The `prefix:` convention for reusable modules

Templates that get invoked more than once — including templates *imported* from another file (see [treatment-files.md](treatment-files.md#imports)) — need a way to give each invocation's elements unique names. Stagebook saves participant responses keyed by `<elementType>_<name>`, so two invocations of the same template with the same element names overwrite each other.

The convention: **module templates take a `prefix:` field, and use it inside every named element.**

```yaml
# In a module file (e.g. surveys/tipi/tipi.stagebook.yaml):
templates:
  - name: tipi_questions
    contentType: elements
    content:
      - type: prompt
        name: ${prefix}_q1
        file: q1.prompt.md
      - type: prompt
        name: ${prefix}_q2
        file: q2.prompt.md
```

The consumer passes a different `prefix:` per invocation:

```yaml
# In the consuming treatment file:
imports:
  - ./surveys/tipi/tipi.stagebook.yaml

introSequences:
  - name: intro
    introSteps:
      - name: pre
        elements:
          - template: tipi_questions
            fields:
              prefix: preTIPI    # → preTIPI_q1, preTIPI_q2
        # ... other intro elements
treatments:
  - name: my_study
    playerCount: 1
    exitSequence:
      - name: post
        elements:
          - template: tipi_questions
            fields:
              prefix: postTIPI   # → postTIPI_q1, postTIPI_q2
```

Each invocation now produces unique storage keys (`prompt_preTIPI_q1`, `prompt_postTIPI_q1`, …) — no collisions, exports keep responses separable.

### Modules that invoke other modules: extend the prefix

When a module template invokes another module template, it should *extend* the prefix it received before passing it down — adding its own subnamespace. This keeps the convention compositional through arbitrary nesting:

```yaml
# In a "battery" module that bundles a TIPI questionnaire + a Likert scale:
templates:
  - name: tipi_battery
    contentType: elements
    content:
      - template: tipi_questions
        fields:
          prefix: ${prefix}_tipi      # caller's prefix + this module's subnamespace
      - template: likert_scale
        fields:
          prefix: ${prefix}_likert
```

Now invoking `tipi_battery` with `prefix: pre` produces storage keys under `pre_tipi_*` and `pre_likert_*` — every leaf is uniquely identified by the full path of nested invocations that produced it.

### What happens if you forget

If a module author forgets to extend the prefix (or the caller forgets to pass one), two invocations of the same template produce colliding storage keys. Stagebook's storage-key collision detector catches this at validation time — the treatment file fails to validate before participants ever run it, with a message identifying the colliding elements.

The convention is enforced by the collision detector, not by the schema. There's nothing structurally requiring a `${prefix}` field in module templates; it's a discipline that lets modules be safely composed. Modules used only once in a study can skip the convention.

## Important Notes

- All `${field}` placeholders must be resolved after expansion. Leftover placeholders cause validation errors.
- All template blocks must be resolved. Leftover `template:` entries cause validation errors.
- Template expansion happens before schema validation. The expanded result must satisfy all Stagebook schemas.
- Field keys cannot be `type` (reserved for element type discrimination).
- Broadcast axis names must match `d0`, `d1`, `d2`, etc.
