# Initial playback is independent of transport policy

Status: implements [#798](https://github.com/talkbench/stagebook/issues/798).
Extends the [once playback transport contract](2026-10-once-playback-transport.md).

An annotation participant may need to focus a Timeline before starting a
single viewing. Previously, `playback: once` always attempted autoplay and
Timeline could not start it. Choosing manual mode to wait for the participant
also permitted pause, seeking and replay, which changed the study's viewing
policy.

`MediaPlayer.autoplay` is an optional boolean controlling the initial start.
`playback` continues to control participant transport. The effective playback
mode remains explicit `playback`, or manual when `controls` are provided or
`syncToStageTime` is true, otherwise once. Omitted `autoplay` preserves
existing behavior: true in effective once mode, false in effective manual
mode. The authoring and resolved schemas retain the optional boolean without
materializing a default; Element forwards it unchanged.

| Effective playback | Autoplay         | Initial start                                          | Later participant transport |
| ------------------ | ---------------- | ------------------------------------------------------ | --------------------------- |
| Once               | Omitted or true  | Automatic attempt; player fallback if blocked          | No pause, seek or replay    |
| Once               | False            | Player's initial play button or focused Timeline Space | No pause, seek or replay    |
| Manual             | Omitted or false | Participant input                                      | Existing manual behavior    |
| Manual             | True             | Automatic attempt; player fallback if blocked          | Existing manual behavior    |

For once mode with explicit `autoplay: false`, the shared participant handle
permits play only when the media is ready, before the first successful start,
and while no start request is pending. Pause and seek remain unavailable.
All attached Timelines observe the same state, so activating Space or the
player's button cannot queue overlapping starts. A rejected start reopens
the initial-start action for retry. A successful start consumes it; pausing
externally, reaching `stopAt`, or ending the file does not make it available
again. Once mode provides no participant pause/resume operation.

The player exposes an accessible initial play button for native video, audio
only, and YouTube media. Starting from a focused Timeline preserves focus so
Enter can immediately record annotations. Clicking the player's button also
preserves existing Timeline focus. This change does not move focus into a
Timeline automatically or otherwise change annotation editing, navigation,
zoom or pan. Timeline help and transport affordances reflect the current
capabilities as the start becomes ready, pending, retryable or consumed.

Default once autoplay keeps its existing boundary: Timeline cannot initiate
the first start, including after a blocked automatic attempt. Only the
player's fallback button retries it. Manual mode with explicit
`autoplay: true` gets one automatic initial attempt and a fallback when
blocked, then keeps ordinary manual transport. A start failure is not a
completed viewing.

Both boolean values are accepted with `syncToStageTime`. That option still
only sets the initial native-media position using stage elapsed time; it does not
continuously synchronize playback, and waiting to start can cause drift.
YouTube currently uses `startAt` without the stage-time offset; this change
does not add synchronization behavior.
Its existing incompatibilities with `controls` and explicit
`playback: once` remain unchanged.

Each mounted media source has its own start lifecycle. Changing `autoplay`
or `playback` for the same source does not restore a consumed once start.
A source change or remount creates a new lifecycle. Viewing attempts are not
persisted across reloads, and this feature does not make annotation data
append-only.

Tests cover schema acceptance and boolean validation, Element routing,
default compatibility, both media backends and audio-only rendering,
readiness and pending starts, rejected-start retry, multiple Timelines,
focus and annotation preservation, completion boundaries, source changes,
and manual autoplay with normal transport.
