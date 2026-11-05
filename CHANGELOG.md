# Changelog

## Unreleased

- Add input-event, composition, shortcut, and clipboard statistics to solo text
  and numeric response telemetry ([#824](https://github.com/talkbench/stagebook/issues/824)).
  Include input timing and a capped list of large insertions with event context;
  record lengths and counts, never inserted text or clipboard contents. Existing
  keystroke measurements and response save boundaries are unchanged.
- Include current numeric-response typing snapshots with every existing response
  commit, matching text responses. Checkpoints replace the current visit's
  provisional summary; blur finalizes it. No additional host saves are introduced.

Earlier releases are documented in [GitHub Releases](https://github.com/talkbench/stagebook/releases).
