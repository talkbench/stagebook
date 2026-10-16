# Media coverage on event saves and playback-log restoration

Status: implementation decision for the media-player portion of
[#728](https://github.com/talkbench/stagebook/issues/728) and the first slice of
[#719](https://github.com/talkbench/stagebook/issues/719). Live progress saves
remain open under #719; tracked-link restoration is a separate concern.

## Scope and motivation

Playback milestones distinguish starting from reaching the end, but neither
measures how much footage played. A seek near the end can satisfy `firstEnd`.
Inspecting only `watchedRanges.0` misses later intervals: requiring that first
range to span the clip can block someone who paused and resumed, while merely
requiring it to exist admits any closed interval. Conditions need numeric
coverage fields. Reloading or conditionally remounting
the player must also preserve earlier observations instead of replacing the log
on its next event.

This first slice adds coverage to existing saves and restores matching logs.
It does not choose a new save cadence. Every save persists the whole record
and may be broadcast by the host; introducing periodic progress saves requires
agreement on cost and log semantics across hosts.

## Coverage contract

Records gain optional `duration`, `watchedSeconds`, and `watchedFraction`.
Optional fields keep older records readable. Each existing playback-event
save computes the amounts for HTML5 and YouTube:

- `duration` is the full media duration when known and finite.
- `watchedSeconds` is the length of the union of closed watched intervals,
  clipped to `[startAt ?? 0, min(stopAt ?? duration, duration)]` when duration
  is known and positive. With unknown duration, an explicit `stopAt` still
  bounds seconds; without it, the upper bound is open. Rewatching never
  double-counts footage.
- `watchedFraction` divides those seconds by the clip-window length. It is
  absent until duration is finite and positive and the window has positive
  length, even when an explicit `stopAt` supplies the upper bound.

The end is capped at the known media duration, matching the player's playable
window. A ten-second file with `stopAt: 20` has a ten-second coverage window;
playing all ten seconds yields a fraction of `1`, not `0.5`.

The existing `watchedRanges` field remains raw log-derived intervals; clipping
for these amounts does not rewrite it. Playback outside the configured window
does not contribute to the amounts. Coverage measures video seconds, so 30
seconds of footage at 2× counts as 30 watched seconds.

There is no hidden tolerance at endpoints or across interior gaps. Researchers
choose thresholds in conditions. `isAtLeast: 0.98` accepts 2% missing in total,
wherever it occurs; it does not establish that all interior footage played.
For a four-second window, intervals `[0, 1]` and `[3, 4]` yield two seconds and
a fraction of `0.5`, not full coverage despite reaching the end.

## Save timing

No new progress-save interval is added. Coverage uses closed intervals, so the
range currently playing is excluded until a pause, seek, end, or removal closes
it. A speed change can save a record without closing that open range. Duration
metadata alone does not cause a save.

Consequently, during uninterrupted playback a 75% gate may remain closed until
the end. This implements coverage fields without satisfying #719's live-75%
acceptance criterion. A follow-up must settle bounded save cadence, the
representation of confirmed in-progress ranges, and host persistence/broadcast
cost before claiming that behavior.

## Restore the log, independently of transport

`Element` passes the saved participant record to `MediaPlayer.initialRecord`.
Direct component callers supply it themselves. The player seeds its log once
from a valid record matching its name, source identity, and clip bounds. The
optional `sourceId` prop is saved on the record; `Element` sets it to the
authored `file` path or asset URI. Matching this stable identity allows hosts
to rotate signed playback URLs. When both player and record have `sourceId`,
those identities must match; otherwise matching falls back to the media URL.
Legacy records without `sourceId` restore only if their URL still matches.
Hosts must restore participant state before mounting; subsequent host updates
do not replace a running log. Records for another source or window do not seed
the current player.

No event is saved just for mounting. On the next saved playback event, the
player appends a `restored` marker and then the new event in the same record.
The range walk treats the marker as a boundary: discard any pending open
interval from the prior mount. A disconnect does not establish where playback
stopped, and a new playhead position must not manufacture watched footage
between mounts. Earlier closed ranges and playback milestones remain intact.
Downstream log consumers must retain and understand this marker.

If a signed URL rotates while the same authored source remains mounted, the
backend reload also starts a new segment with a `restored` marker. Earlier
closed ranges survive; the unverified open range cannot bridge that reload.
Recreating YouTube's backend after a creation-setting change starts a new
segment too. Changing to another named source starts its own log. Changing
only the window re-clips the raw log on its next save; it does not force a
remount of the outer player.

Restoration does not seek to `lastVideoTime`, resume playback, or persist the
once-mode attempt policy. Existing `startAt`, `syncToStageTime`, and `autoplay`
behavior continues. `playback: once` still applies to a mounted player and
source, so remounting can begin another attempt. Preserving observation history
and restricting attempts are separate contracts.

## Migration and validation

Replace `self.mediaPlayer.<name>.watchedRanges.0` / `exists` gates with a
`watchedFraction` threshold chosen for the study. Add `firstEnd` / `exists` only
when reaching the clip's end is independently required. Use `watchedSeconds`
for an absolute coverage requirement or genuinely unknown-duration media.
The [conditions guide](../researcher/conditions.md#migrating-a-watched-range-gate)
contains an explicit source and submit-button example. Old records gain
coverage fields on their next playback-event save, not on mount. No existing
study workflows are migrated as part of this slice.

Verification covers clipped union coverage, overlap and replay, interior gaps,
unknown duration, restored closed ranges and milestones, discarded open
intervals, source/window mismatch, and no mount-only saves. Host-flow coverage
must include a conditional remount with restored participant state and a
fraction gate. Live threshold timing and tracked-link restoration remain out
of scope.
