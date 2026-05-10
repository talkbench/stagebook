# Imports walkthrough

A minimal example demonstrating two related features:

1. **Cross-file template imports** (#277) — pulling a reusable
   measurement instrument from a sibling `*.stagebook.yaml` file.
2. **The `prefix:` convention** for invoking a module template
   more than once without storage-key collisions.

## What's here

```
imports-walkthrough/
├── imports-walkthrough.stagebook.yaml   ← entry point
├── greeting.prompt.md
├── modules/
│   ├── demographics.stagebook.yaml      ← reusable demographics module
│   ├── age.prompt.md
│   └── country.prompt.md
└── README.md (this file)
```

## How the import works

The entry point declares:

```yaml
imports:
  - ./modules/demographics.stagebook.yaml
```

When `resolveImports` merges the imported templates, it
**path-rewrites** every `file:` field — so the module template's
`file: age.prompt.md` (relative to the module's directory)
becomes `file: modules/age.prompt.md` (relative to the entry
point's directory). The merged result is indistinguishable from
inline templates.

## How the `prefix:` convention works

The module's template uses `${prefix}` on every named element:

```yaml
templates:
  - name: demographics_survey
    contentType: elements
    content:
      - type: prompt
        name: ${prefix}_age
        file: age.prompt.md
      - type: prompt
        name: ${prefix}_country
        file: country.prompt.md
```

The entry point invokes it twice — at intake and at follow-up — with
a different `prefix:` each time:

```yaml
introSequences:
  - introSteps:
      - elements:
          - template: demographics_survey
            fields:
              prefix: intake     # → prompt_intake_age, prompt_intake_country

treatments:
  - exitSequence:
      - elements:
          - template: demographics_survey
            fields:
              prefix: followup   # → prompt_followup_age, prompt_followup_country
```

Each invocation produces unique storage keys, so the two sets of
responses stay separable in the export. If you forgot the prefix or
used the same one for both invocations, Stagebook's storage-key
collision detector would catch it at validation time, before
participants run the study.

## Try it

1. Open `imports-walkthrough.stagebook.yaml` in VS Code with the
   Stagebook extension installed.
2. Run **Stagebook: Preview Treatment**.
3. The intro shows the demographics survey; clicking through to
   the main stage and then the exit shows the same survey again,
   ready to be saved under a different namespace.

## What this example doesn't show (yet)

- Nested imports (a module that itself imports another module). The
  loading loop handles this transitively, but isn't exercised here.
- Modules that share template names across two imports (rejected
  at validation time with a "rename one to disambiguate" message).
- Compositional prefix extension across nested module invocations
  (a module that invokes another module passes `${prefix}_<sub>`
  down). Documented in `docs/researcher/templates.md`.
- Standalone viewer URL loading of imported files (follow-up #312).
