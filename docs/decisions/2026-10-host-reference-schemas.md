# Typed host reference sources

Status: accepted for implementation of [#673](https://github.com/talkbench/stagebook/issues/673)
and [#730](https://github.com/talkbench/stagebook/issues/730).

Discussion metrics need a declared producer and a saved-record contract. Host
extensions to participant attributes also need types without global schema
mutation. The expression grammar already infers types from saved-record Zod
schemas; use that same path for these sources.

Discussions may declare an optional name. Named blocks produce
`discussion_<name>` and follow the existing forward-reference and storage-key
collision rules. Keeping the name optional preserves existing discussions
that do not expose metrics. No implicit name is derived from a stage label.

The built-in discussion schema declares optional `discussionFailed` (Boolean)
and `cumulativeSpeakingTime` (finite nonnegative seconds). Absence means not
measured. The host saves observed fields in player state, preserving existing
observations and writing failure before advancing affected participants.
Stagebook never fabricates successful completion or speaking time.

`createHostRecordSchemas` returns a per-host registry extended with typed
`attributes` and `discussion` fields. Validation and host conformance APIs
accept that registry explicitly. Built-in fields cannot be overridden.
Discussion references require `self`, a numeric seat, or `everyone`; `shared`
is invalid because the host writes participant records. Custom fields do not
change this storage scope. Stored data and evaluator diagnostics remain
unchanged. Custom declarations are host code, not treatment syntax; standalone
tools use the built-in registry.

Discussion fields must be declared. Existing open attributes retain gradual
typing for undeclared extensions. MediaPlayer's record schema is shared with
its component type and supplies its known reference fields; unknown top-level
fields warn with spelling suggestions outside Zod refinements, preserving
`safeParse` behavior. This does not change playback or apply validation to
participant saves.

The length regression in [#780](https://github.com/talkbench/stagebook/issues/780)
has its own fix: counting an array requires its outer shape, whereas equality
and membership require compatible scalar contents. More complete host types
must preserve this distinction. The paired Runner storage/export work is
[runner#1005](https://github.com/talkbench/runner/issues/1005); deployment needs
both sides before named discussion gates can operate.
