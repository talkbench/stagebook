# Stagebook DSL: design principles

This document captures the cross-cutting design principles that have emerged
from a sequence of related decisions about the Stagebook DSL — the YAML
treatment files, prompt files, condition expressions, and references that
researchers author. It synthesises the rationales recorded in individual
issues and ADRs, written so contributors can answer "why does Stagebook do
it _this way_?" without re-deriving the answer from scratch.

It's the companion to per-decision ADRs in this directory. ADRs record
individual decisions; this document synthesises the recurring patterns.
Component-design principles ("components are measurement instruments,"
"reproducibility over composability") are separate and live in
[CLAUDE.md](../../CLAUDE.md) — they govern UI behaviour, not DSL shape.

## 1. Markdown-renderability for participant-facing files

A researcher should be able to read a raw `.prompt.md` file in any markdown
viewer (GitHub, VS Code preview, plain text editor) and understand the
prompt — title, body, response options — without Stagebook tooling.

This principle is what kept the three-section prompt format alive when we
considered folding response options into YAML frontmatter (#243). The
frontmatter-only form would have been schematically cleaner but would have
made raw files unreadable on GitHub. Cleanup landed _inside_ the
three-section frame instead — slider labels paired inline (`- 0: Not
familiar`), a discriminated-union schema, strict keys.

## 2. Operator-keyed nested objects for declarative trees

When the DSL needs nested logical structure, use operator-keyed objects
(`all:`, `any:`, `none:`) with leaves at the bottom — the convention
CircleCI, MongoDB, and JSON Schema all settled on. Don't invent
string-grammar mini-languages or operator-prefix function-call shapes for
declarative YAML.

This is why boolean condition logic (#235) is `all: [...]` / `any: [...]` /
`none: [...]` rather than expression strings or JSON-Logic-style
operator-prefix arrays. The shape is recursive, schema-validatable per
branch, and reads as English.

## 3. Single discriminator over nested category wrappers

When a field has multiple kinds of values, distinguish them with one
discriminator rather than wrapping categories in another layer.
`source: entryUrl` and `source: prompt` sit at the same level; we don't
wrap external sources in `context: { source: entryUrl }` or named sources
in `element: { source: prompt }`.

The rule: if the discriminator value already names the kind, the wrapper
is redundant. Schema validation per-source stays clean; researchers learn
one shape (#240).

## 4. One concept, one field

Fields should not change meaning by value. If a field's semantics shift
depending on what's written in it, split it — even at the cost of breakage.

`position` on a condition was doing three jobs (read selector, fan-out
aggregator, agreement metric). The fix wasn't to document the three modes;
it was to narrow `position` to one job and lift the other two into different
mechanisms — the boolean tree (#235) for aggregation and a future
countables family for metrics (#238).

## 5. Backward-compatible sugar where possible; hard breaks where the value justifies

Each breaking change is evaluated against one criterion: does back-compat
cost more than authors save by skipping the migration?

- Boolean operators (#235) — added as new sugar; existing flat-array
  conditions stay valid as `all: [...]` shorthand. Zero migration.
- Structured references (#240) — added; dotted-string form parsed as sugar.
  Zero migration for existing files.
- `position` narrowing (#238) — hard break for files using the dropped
  values. The boolean tree provides the substitute; back-compat would mean
  carrying the old aggregator semantics forever.
- Prompt-file format (#243) — hard break, no sniffing. The format itself was
  broken (parallel schemas, `---` collision, separated slider labels);
  supporting both shapes in parallel costs more than the documented
  conversion does.

Sugar where the existing surface maps cleanly; break where the old shape
requires permanent dual maintenance.

## 6. Schema-level cleanups beat runtime-only patches

If the pain point is in the schema — cross-field guard rules, parallel
definitions, value-typed overloads, custom parsers in two places — fix the
schema. Runtime workarounds compound; schema fixes propagate to every
downstream consumer at once.

Examples in the syntax review: `metadataTypeSchema` +
`metadataRefineSchema` parallel pair → one `discriminatedUnion("type")`
(#243); bespoke per-type reference parser in two files → one
discriminated-on-`source` schema (#240); `position` value-typed overload
requiring superRefine guard rules → narrowed enum plus the boolean tree
(#238).

## 7. Explicit over magic; ergonomic shortcuts as sugar

Defaults are fine when they're explicitly documented; magic researchers
have to reverse-engineer is not. Sugar over an explicit form is fine — the
explicit form must always exist and work.

The implicit `[value]` path on prompt references (#240) is the canonical
example: `self.prompt.foo` works as today, but the underlying
`{position: self, source: prompt, name: foo, path: [value]}` is the
documented model, and overriding the path with `[debugMessages]` etc. is
supported. The shortcut isn't load-bearing.

## 8. Validation at the point of authoring

Errors that can be caught at preflight should be caught at preflight, not
at runtime in the participant's session. The schema isn't just for parsing
— it's the contract authors validate against during development.

This is why cross-stage reference validation walks the whole tree (#197);
condition rules that would desync players are rejected at schema time
(#183); strict frontmatter keys catch typos before a study runs (#243).

## 9. `name:` is the universal identifier

Every nameable portion of a study uses `name:` as its identifier —
elements, stages, treatments, intro sequences, intro/exit steps, prompt
files, templates. The validation regex is shared (alphanumeric, spaces,
underscores, hyphens, max 64 characters), even though only some of those
portions (elements, templates) are addressable elsewhere in the schema
via references or template invocation.

This is a deliberate looseness. Researchers think about "naming a portion
of the study" uniformly, regardless of whether they'll reference it
later. Splitting into `name:` (identifier) and `title:` (display label)
was considered during the syntax review and rejected — the dual role of
`name:` is mild, and teaching researchers two field names for one mental
concept is more friction than carrying a name that's never referenced.

One field that looks like a counter-example but isn't:
`groupComposition[].title:` (max 25 characters). It's _not_ a generic
display label — it's a participant role marker that appears on the
participant's nametag during the study (e.g., "Manager", "Sales Agent",
"Republican"). It carries different semantics from a name and stays
distinct deliberately.
