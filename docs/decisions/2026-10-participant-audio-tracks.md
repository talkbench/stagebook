# Participant audio tracks and annotation identity

Date: 2026-10-27. Status: accepted; implementation for Stagebook Release B.

Issue: [#663](https://github.com/talkbench/stagebook/issues/663), following the
[Release B design](https://github.com/talkbench/stagebook/issues/663#issuecomment-6023469104).
The encoding contract is pipeline ADR-0019: one MP4, an N-channel discrete
Opus track first and an AAC listening mix second. Solo recordings remain mono.

## Problem

The default `MediaElementAudioSourceNode.channelCount` is 2, not the recording's
decoded count. Browser decoders can also reorder participant channels. Release A
measured that ordering, but did not apply it to the player. A channel's file index
does not identify a study participant: a breakout room with positions 0 and 5 has
file channels 0 and 1.

## Decision

The host supplies `getChannelMapping(file)` and the session's `channelProbe`
through `StagebookContext`. `file` is the authored media identity before URL
resolution. Stagebook never fetches sidecars. The host reads the sidecar for the
exact served object, refuses missing group mappings at task construction, gates
admission on the session probe, and stores the mapping/probe with annotations.

Stagebook exports the React-free `checkChannelLayout` and mapping/diagnostic
types from its main entry point. Server callers omit `probe`; the renderer
includes it, even when absent, to require usable calibration for C ≥ 2.

Mappings contain exactly C entries (1–8), indices 0..C−1, only `participant`
roles, distinct non-negative integer positions and optional non-empty labels.
**Only the new layout is supported.** Legacy mix roles are rejected and require
re-composition, superseding the original issue's proposal to skip those roles.

The player uses an explicit, discrete C-wide splitter. It inverts the session
probe's decoded-channel-to-source-channel permutation for exactly C, then orders
waveforms and mute controls by ascending participant position. It mixes all C
participants into both ears at 1/C each, including without a Timeline. Solo
recordings need no calibration. Calibration assets remain isolated in the
`stagebook/audio-probe` bundle.

Labels come from the host or a localized “Track 1…N”, never raw participant
positions. Group recordings ignore authored `trackLabels`.

Timeline editing geometry keeps row indices internally. At storage boundaries,
group selections use `position`; ordinary selections retain `track`. All-track
marks have neither field. Both fields on one saved mark are invalid. Restoration
looks up positions in the current roster; unknown positions and legacy row-only
marks on group recordings are discarded, never silently reassigned. Explicit
host migration is needed to restore legacy group annotations.

## Refusal and its limits

Invalid group mappings, missing/invalid multichannel calibration or graph setup
failures replace the player and Timeline with a localized error. The host receives
`ChannelLayoutError.diagnostics` through `onElementError`; this is a controlled
refusal with no React component stack. Timeline cannot save once refused.

A parallel AudioWorklet observes the raw decoded count before the splitter can
truncate it. For mapped groups it checks agreement with the sidecar. For ordinary
media with a Timeline, it refuses more than two decoded channels without a
mapping, including with hidden waveforms. This deliberately excludes unlabelled
surround audio from Timeline use and requires secure-context/blob-script access.
Ordinary playback without a Timeline retains its existing path.

The count check can only act once audio signal is decoded. It cannot recognize
an omitted mapping on mono/stereo media, a stereo AAC fallback, or silent/audio-free
media. Nor can it recognize a valid mapping copied from another recording with
the same count. These remain host responsibilities; the backstop does not replace
task validation or the session gate.

`CAPABILITIES.perSpeakerTracks` becomes true. Hosts adopting this release must
implement enforcing admission rather than Release A's record-only mode. The
annotator integration is separate (#338 mapping delivery, #226 admission and
persistence); no runner-specific playback implementation is needed.

## Verification

Unit tests cover mapping/calibration validation and position-based persistence.
Real-browser tests use distinct source tones and amplitudes to verify player
waveform ordering at multiple counts, the audible mix under mute, the 0/5 breakout
case, restoration, solo playback, malformed mapping refusals, localization and
the missing-mapping guard. WebKit on macOS exercises refusal of the AAC fallback.
