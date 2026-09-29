# The media player logs every seek and closes playback at stage end

Status: accepted in [#682](https://github.com/talkbench/stagebook/issues/682),
[#677](https://github.com/talkbench/stagebook/issues/677) and
[#676](https://github.com/talkbench/stagebook/issues/676).

A `mediaPlayer`'s saved record is a measurement: researchers use its
`watchedRanges` to check whether a participant watched the clip. It is only
as good as the event log it is derived from, so every change of position,
playing state or speed made through stagebook — the player's own controls or
a sibling such as a Timeline — is logged. YouTube's own in-frame controls
are not yet covered ([#699](https://github.com/talkbench/stagebook/issues/699)).

**Seeks.** The player logs seeks made through its own controls, through the
PlaybackHandle it registers for siblings (a Timeline's ruler, playhead drag,
arrow keys and mark edits), and through its scrub bar. Before this, only its
own seek buttons and keys logged anything. A seek during playback ends the
watched range where it left and starts one where it landed. Previously a
play/pause pair spanned an unlogged jump, so a forward seek counted skipped
footage as watched and a backward one produced a backwards range. Backwards
and empty pairs are now dropped, which also cleans up logs saved before this
change.

A drag or a burst of held keys calls `seekTo` on every pointer move or key
repeat, and each logged event saves the whole record. Streams like that are
logged as one seek once no further seek arrives for 500ms. The seek runs
from where the stream started to where it landed, stamped with the stage
time when it started. Any other event logs a pending seek first, so the log
stays in order. Separate seeks less than 500ms apart merge too; during
playback, the moments played between them are then not counted, which errs
toward undercounting. The player's discrete seeks (buttons, `J`/`L`, arrows,
the replay jump) are logged at once, as before; its own held keys and held
seek buttons still log every step
([#698](https://github.com/talkbench/stagebook/issues/698)).

A grab of the scrub bar during playback logs its pause at once, where
playback stood, and ignores the pause report that follows: the browser, and
more so the YouTube iframe, can report that pause with the time from before
or after the scrub's seek. YouTube also reports PAUSED after every seek made
while paused, and PLAYING after every seek during playback once it buffers.
Those reports change nothing, so they aren't logged; logging them would also
split a Timeline drag into a seek per report.

**Stage end.** When the stage ends during playback, by submit or timeout,
the player unmounts without a pause, and nothing closed the open range. It
now logs a `stageEnd` event at the current position when it unmounts with
the log mid-playback, after logging any pending seek, and then closes its
log: a sibling still holding the handle logs nothing more. The same happens
if `hideTime` or a condition hides the player mid-stage. That is a
deliberate exception to
[Components own response commit boundaries](2026-09-response-commits.md),
where unmount cancels pending work without flushing. That rule keeps an
unfinished gesture from becoming an answer. Here, the playback and the seek
have already happened, and the log records them. There is still no stage
submission registry. The save reaches the host after `submit()`, because
stagebook swaps the stage's elements out at submit. A host that snapshots
its state synchronously in `submit()` misses it on the last stage
([talkbench/annotator#331](https://github.com/talkbench/annotator/issues/331)).
The event's `stageTimeElapsed` is the host's clock at that moment; a host
that has already started the next stage's clock reports that.

**Speed.** The `<` / `>` keys log the same `speed` event as the speed button,
and work only when `controls.speed` is on. Reaction lag in real-time marking
depends on speed, and a study without the speed control expects a fixed
speed.
