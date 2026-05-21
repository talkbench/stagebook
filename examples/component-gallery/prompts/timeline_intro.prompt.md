---
type: noResponse
---

# MediaPlayer + Timeline

The `mediaPlayer` element renders a video or audio file with
standard playback controls. The `timeline` element renders an
interactive scrubber underneath, bound to the mediaPlayer by name
(`source: <player.name>`). Together they're the canonical
annotation surface: the participant plays the media, then drags or
clicks on the timeline to mark ranges or points relative to the
playback.

Two timelines are attached to the same player below — the first
collects **ranges** (drag or press-and-hold Enter), the second
collects **points** (click or tap Enter). Both share the same
playhead because they read the same MediaPlayer's currentTime
through the PlaybackProvider context.

Try it:

- **Play / pause** with the controls under the video, or press
  Space when a Timeline has keyboard focus.
- **Click a timeline** to seek the playhead — the click also
  focuses the timeline, lighting up the blue ring around it
  (keyboard shortcuts go live for that timeline).
- **Drag** on the range timeline to create a range; **click** on
  the point timeline to drop a point.
- **Tab through** the controls — every interactive surface shows
  a focus ring (per the #382 polish).
- **Click the `?` button** in the timeline footer for the full
  keyboard reference.
