# Imports walkthrough

A minimal example demonstrating Stagebook's cross-file template
imports (#277). The root file `imports-walkthrough.stagebook.yaml`
declares:

```yaml
imports:
  - ./modules/consent.stagebook.yaml
```

and invokes the template that file defines:

```yaml
introSequences:
  - name: intro
    introSteps:
      - template: shared_consent_step
```

When `resolveImports` merges the imported templates, it
**path-rewrites** every `file:` field — so the template's
`file: consent.prompt.md` (relative to the module's directory)
becomes `file: modules/consent.prompt.md` (relative to the root
file's directory). The merged result is indistinguishable from
inline templates.

## Try it

1. Open `imports-walkthrough.stagebook.yaml` in VS Code with the
   Stagebook extension installed.
2. Run **Stagebook: Preview Treatment**.
3. The first intro step is the imported consent prompt; clicking
   "I agree, continue" proceeds to the in-file `greeting`.

## What this example doesn't show (yet)

- Nested imports (a module that itself imports another module). The
  loading loop handles this transitively, but isn't exercised here.
- Modules that share template names (rejected at validation time
  with a "rename one to disambiguate" message).
- Multi-module setups (more than one `imports:` entry).
- Standalone viewer URL loading of imported files (follow-up; this
  example currently works in the VS Code preview only).
