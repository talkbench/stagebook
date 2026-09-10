# Improve contrast while preserving visual hierarchy

Decision for [#616](https://github.com/talkbench/stagebook/issues/616), after
visual review of the revised forms and media mockup.

Radio and checkbox labels need to remain readable on hovered rows, and the
choice outlines must identify the controls. Large field borders should stay
light so their contents retain more visual weight. Slider minor ticks should
be easier to see while remaining subordinate to labeled major ticks: equally
prominent ticks can suggest that participants should align their responses to
them. Ruler timestamps should remain quieter than track labels and controls.

## Approved defaults

| Role                                             | Default                               |
| ------------------------------------------------ | ------------------------------------- |
| Muted text, including labels, hints and counters | `#626977`                             |
| Unchecked radio and checkbox outline             | `#858c99`                             |
| Select, text-area and secondary-button borders   | Existing `#d1d5db`                    |
| Normal timer fill                                | Primary color, `#2563eb` by default   |
| Major slider ticks                               | Existing `#6b7280`, 16px high, opaque |
| Minor slider ticks                               | `#6b7280`, 6px high, 0.7 opacity      |
| Ruler timestamps                                 | `#737373`                             |
| Unmuted track icon and asset-placeholder hint    | Muted text color                      |

The shared muted-text token changes throughout the components, including
fallbacks for hosts that do not load `stagebook/styles`. The waveform bar color
stays unchanged. Track labels retain their existing translucent white backing.

Three public tokens separate these roles from larger field borders and shared
text: `--stagebook-choice-border`, `--stagebook-slider-tick`, and
`--stagebook-timeline-ruler-text`. Hosts that previously used the general border,
muted-text or decoration tokens to theme these parts should now set the specific
token. The timer's normal fill now consumes `--stagebook-timer-fill`, which
defaults to the primary color; its inline fallback also follows the primary color.

## Verification and remaining questions

The rendered contrast gate measures unchecked choices at rest and on hover,
text, the timer fill, and the mute glyph. A full-height waveform fixture measures
track-label text against the painted background beneath its translucent backing.
Regression tests preserve the minor/major tick hierarchy and independent theme
controls, including their inline fallbacks.

This implements the approved appearance, not a complete resolution of #616.
The light text-area boundary still measures 1.47:1 against white. Minor ticks
measure about 2.43:1 on the resting track and 2.12:1 on hover, below the gate's
provisional 3:1 floor. These remain explicit known shortfalls while we resolve
whether the minor marks are necessary to understand the scale and how to treat
the text-area boundary. The stronger bottom edge and stronger minor-tick options
from the mockup were not selected.
