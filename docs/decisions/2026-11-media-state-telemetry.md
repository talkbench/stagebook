# Media audio and page state on existing saves

Status: implementation decision for
[#825](https://github.com/talkbench/stagebook/issues/825).

The player log describes transport and media coverage but previously omitted
audio settings and page state. These observations help investigate responses
without establishing that a participant heard, saw, or attended to a clip.

## Preserve the write budget

Every existing transport event saves the whole record. New audio/presentation
events are queued in memory and drained by those existing saves. They do not
save independently. A volume gesture settles after 500 ms of quiet; an existing
save flushes its pending state early so that save includes the latest settings.
Fullscreen and picture-in-picture observations join the same queue. No new
periodic save or teardown write is added. A state-only tail can be lost when a
paused player unmounts, because its removal does not already require a save.

This chooses the issue's no-additional-saves acceptance criterion over saving
each rare presentation event immediately. Existing play, pause, seek, speed,
end, and removal boundaries remain unchanged. `lastVideoTime`, playback
milestones, and coverage continue to follow transport events, not the queued
state events.

The first 50 events of each new kind are retained: `volumechange`,
`fullscreenchange`, `enterpictureinpicture`, and `leavepictureinpicture`.
Further observations increment fixed-category `mediaStateEventsDropped`
counts. Caps and drop counts continue across matching restored logs. This
bounds added state-event history without changing transport retention or
discarding existing host history.

## Record observations with distinct meanings

Each play snapshots backend `muted` and normalized `volume`. Null means the
backend could not report the value; omission remains valid in historical
records. `channelMuted` is copied when the graph's channel controls are
initialized, in the same index order used by the player's handle and Timeline.
Group recordings can map that order differently from decoded channel order.
Channel state becoming available at graph initialization is an observed audio
state change too; a `volumechange` is not necessarily a participant adjustment.
YouTube audio sampling reuses its existing 250 ms poll; no additional polling
loop is introduced, and changes between samples can be missed.

The visibility accumulator starts on HTML `playing` or YouTube PLAYING,
stops on waiting/buffering, seeking, pause/end/error, and backend replacement,
and resumes on another playing report. WebKit can complete a buffered seek
without emitting another `playing`, so `seeked` or a later `canplay` can resume
a previously observed active interval when the media is ready, no longer
seeking, unpaused, and not ended.
Linux WebKit may advance while reporting only current data and emitting neither
readiness event. In that case, an existing `timeupdate` must show advancement
beyond the completed seek position before accounting resumes. The seek jump
and buffering gap are not counted, and replacement elements discard that
pending recovery evidence. No additional timer or save is needed.
A paused or initial seek cannot establish playback. The earlier `play` event semantics
are preserved: it can precede rendering or a stalled playback request.
The counters therefore describe observed playback without redefining the
historical event log or its watched ranges.

Durations use a monotonic clock and wall seconds, not media seconds or distinct
coverage. `hiddenPlaybackSeconds` counts playback while the document reports
hidden; `unfocusedPlaybackSeconds` counts playback while `document.hasFocus()`
is false. They can overlap. `visibilityChangesDuringPlayback` counts actual
hidden/visible transitions while playback is active, not duplicate reports or
focus-only changes. All three update locally and are sampled only on existing
saves.

Valid matching restored totals continue without inferring playback during the
gap between mounts. Same-source backend reloads settle the old interval and
retain totals but never count the reload gap. A new named/source identity
starts its own measurement. Missing older fields represent unmeasured history,
not proof that prior playback was visible or focused.

## Limits and deferred work

Native audio settings do not establish system/device volume, physical
audibility, or every Web Audio condition. Visible/focused documents do not
establish on-screen pixels or attention; other windows, scrolling, audio-only
presentation, captions, and picture-in-picture affect interpretation. Internal
YouTube fullscreen/picture-in-picture transitions can be hidden inside its
cross-origin iframe. No automatic gate, bot verdict, or exclusion threshold
is added.

`audibleVisibleSeconds` remains deferred with
[#719](https://github.com/talkbench/stagebook/issues/719) and
[#760](https://github.com/talkbench/stagebook/issues/760). It would require
settling combined coverage and audibility semantics beyond these descriptive
observations. Download detection remains out of scope.

Agent session: `q7m2vk`.
