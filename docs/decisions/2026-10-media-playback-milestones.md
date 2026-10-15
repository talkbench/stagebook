# Conditions can gate on a media player's playback milestones

Status: accepted in [#710](https://github.com/talkbench/stagebook/issues/710).

`mediaPlayer` is a named reference source: `<position>.mediaPlayer.<name>`
reads the player's saved record, `mediaPlayer_<name>`. The record carries two
playback milestones. `firstPlay` is the first `play` event. `firstEnd` is the
first `ended` or `stopAt` event, the same moments `submitOnComplete` advances
on. Each is a copy of its event, absent until it happens, and never changed
after. Authors gate on them with `exists`, e.g. a **Next** button that appears
once the step's video has started.

**Why fields on the record.** The record already had the data, but no
condition could read it. Comparators can't search a list of objects, so
`events` holds the answer where no condition can reach it. The fields that
conditions can read each fail. `events.0.type` misses a play after a seek, and
the record exists as soon as a seek or speed change saves it. `watchedRanges`
gains a range only when a pause, seek or end closes it, so a gate on it waits
for a pause. Querying the log from conditions would need list operations, which
the [#299](https://github.com/talkbench/stagebook/issues/299) grammar leaves
out. A `trackedLink` saves `totalTimeAwaySeconds` for the same reason.

**Why milestones, and why this shape.** The record has to say when the
milestone happens, not later. Started and reached the end are single events,
so the save that logs the event also carries the field. A field that is absent
until something happens follows how references already express "has this
happened": a `submitButton` record appears only on click. A boolean such as
`hasStarted` was rejected. A copy of the event also records when it happened,
in stage and video time.

**"Started" means the logged `play`.** The browser fires `play` when playback
is requested and allowed, before any frame renders. A blocked autoplay fires
none, so it doesn't count. A source that stalls after an accepted request
does count. Using `playing` instead would change what the log records, and
the watched ranges built from it.

**Coverage follow-up.** Gates such as "watched 75%" need
`watchedSeconds` / `watchedFraction`. Those come from closed ranges, so without
saves during playback they lag until a pause or the end. Making them current
raises questions about how often to save and about the log's semantics; they
are tracked in [#719](https://github.com/talkbench/stagebook/issues/719).
The [coverage and restoration decision](2026-10-media-coverage-restore.md)
adds amounts to existing event saves as a first slice; it does not add live
progress saves or promise that a 75% gate opens during uninterrupted playback.
Thresholds stay in conditions, not on the player. A completion setting on the
player was rejected because each kind of criterion would need its own setting,
and it allows one threshold per player.

**Restoration and remaining gaps.** The
[coverage and restoration decision](2026-10-media-coverage-restore.md)
addresses [#728](https://github.com/talkbench/stagebook/issues/728) for media
players: a matching record supplied before mount preserves milestones and
closed ranges across reloads and conditional remounts. Firefox and Safari
fire `ended` when a paused video is seeked to the file's end, so there `firstEnd`
(and `submitOnComplete`) can fire without playback
([#729](https://github.com/talkbench/stagebook/issues/729)). A misspelled field,
such as `firstplay`, validates clean and never matches
([#730](https://github.com/talkbench/stagebook/issues/730)).

Unit tests cover the milestone derivation. jsdom tests drive the player
through play, pause, replay, `stopAt`, the file's end, a paused seek to
`stopAt`, and YouTube state reports. They also render a Stage whose **Next**
is gated on `firstPlay` or `firstEnd`, with saves flowing back through the
host. Next stays hidden through seeks, speed changes, another player's
playback and a blocked autoplay, while a gate on the record itself opens. It
appears at the first play or at reaching the end. Schema tests cover the
reference, its storage key, and the unknown-name and forward-reference checks.
