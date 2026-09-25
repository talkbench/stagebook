# MediaPlayer replays its clip from the end

Status: accepted in [#684](https://github.com/talkbench/stagebook/issues/684)
and [#679](https://github.com/talkbench/stagebook/issues/679).

A player's clip is `[startAt, stopAt]`, defaulting to the whole file. When
playback sits at the clip's end, pressing play replays it from `startAt` (or
0). The play button shows a replay icon, labelled "Replay", in that state.
The rule covers stagebook's own ways to start playback: the button, `Space` /
`K` on the player, and the registered `PlaybackHandle.play()`, so a
Timeline's `Space` replays too. HTML5 and YouTube sources behave the same.
Playback started outside stagebook, by OS media keys or YouTube's own video
surface, doesn't pass through the rule.

Previously, play at `stopAt` started playback, crossed `stopAt` at once and
paused again, logging another `play` / `stopAt` pair each time. At the natural
end of the file, the browser restarted from 0 even when `startAt` was set. The
replay is logged as a `seek` from the end to `startAt`. The `stopAt` or
`ended` event before it closes the watched range, and the `play` that follows
opens a new one at `startAt`.

With `allowScrubOutsideBounds: true`, participants can seek past `stopAt`, but
playback still stops there, so the replay still starts at `startAt`: it plays
the clip as authored. Play-once and stage-synced players never replay; they
are single, uncontrolled playthroughs. "At the end" means at or past `stopAt`
(or the file's end). HTML5 reports its natural end exactly; YouTube can report
a time slightly short of its duration once ENDED, so for YouTube the ENDED
state also counts within half a second of the end until playback resumes.
YouTube's position is polled while paused as well as playing, so seeks from
the controls or a Timeline update the scrub bar and the Play/Replay button.

Only playback reaches `stopAt`. A seek that lands there while paused records
no `stopAt` event and doesn't trigger `submitOnComplete`. Previously it did
both, and because pausing an already-paused video fires no `pause` event, the
flag that suppresses the enforcement's own pause stayed set and swallowed the
participant's next real pause. The flag now also resets when playback starts.
A pause that ends playback just past `stopAt`, before the next time update
noticed the crossing, counts as reaching it. Since
[the Timeline follows its player's window](2026-09-timeline-media-window.md),
a paused seek to exactly `stopAt` is an ordinary way to reach the end.

Unit tests cover the clip window and end test. jsdom tests drive the player
through reaching `stopAt` (by playback, by a pause just past it, and not by a
paused seek) and through replay from the button, `Space`, the handle, the
natural end and `allowScrubOutsideBounds`, including the exclusions. Browser
tests replay HTML5 and YouTube sources (natural end, `stopAt`, `Space` / `K`,
paused seeks) and replay through a Timeline's `Space`. The contrast gate
measures the replay glyph over black and white backdrops, and the axe gate
scans the replay state.
