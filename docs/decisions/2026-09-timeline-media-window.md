# Timeline follows its player's window

Status: accepted in [#675](https://github.com/talkbench/stagebook/issues/675).

When the source `mediaPlayer` has `startAt` / `stopAt` and
`allowScrubOutsideBounds` is false, its Timeline covers only that window. At
zoom 1 the track spans `[startAt, stopAt]`; zooming, panning, the minimap,
ruler and playhead drags, keyboard seeks, and every way of creating or editing
a mark stay inside it. With `allowScrubOutsideBounds: true`, or without a
window, the Timeline spans the whole file as before. Opening the full file
zoomed to the window was rejected: zoom is capped at 32×, too little for a
short window in a long recording, and zooming out would leave the window.

Times stay in media seconds throughout: the playhead, saved marks, ruler
labels and screen-reader status all read seconds from the start of the file,
matching the player's own clock. Downstream code can join marks to the
recording without knowing `startAt`. The Timeline represents the window as a
domain `{ start, end }` in media time. Pixel mapping already treated
`viewportStart` as an absolute time, so only the clamps that assumed a domain
starting at 0 changed; waveform buckets stay indexed by media time.

The player publishes its window through an optional
`PlaybackHandle.getBounds()`. The handle a MediaPlayer registers, HTML5 or
YouTube, wraps the underlying one so `seekTo` clamps to that window,
protecting the player from any sibling's seek. The method is optional so
external handle implementations keep compiling; a handle without it spans
`[0, getDuration()]`. A window that is empty once capped at the file (for
example `startAt` past the end of a shorter recording) falls back to the
whole file, in both the Timeline's domain and the player's seek clamp.

Enter marks the playhead clamped into the window, so if playback overshoots
`stopAt` before the player pauses it, the mark lands on `stopAt`. The
Timeline also tracks the playhead at zoom 1, so the first zoom-in no longer
mistakes playback that started at `startAt` for a seek jump.

Marks restored from saved data that fall outside the current window (for
example, saved before the window changed) are kept unchanged in the data.
The track and minimap don't show them, though `[` / `]` can still select
one; a keyboard edit then clamps the edited time into the window.

Browser tests mount the real MediaPlayer beside a Timeline and cover the
domain, media-time ruler, zoom, ruler and keyboard seeks, click, drag and
keyboard marks, `allowScrubOutsideBounds`, and a YouTube source. Unit tests
cover the domain derivation, window-aware viewport math, and the seek wrapper.
