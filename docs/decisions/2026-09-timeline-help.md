# Timeline help stays nonmodal and fits the viewport

Status: accepted. Follow-up to the [Timeline accessibility audit (#552)](https://github.com/talkbench/stagebook/issues/552).

Opening keyboard help moves focus to its scrollable, named dialog. The help
button exposes its expanded state and controls relationship. Escape and the
visible Close button dismiss help and return focus to the trigger. The Close
button keeps the shared 44px minimum target and stays visible while scrolling.
Its accessible name is localized in English and Hebrew.

Help is nonmodal: Tab moves from the scroll container to Close, then closes
help and continues forward from the trigger's place in the page. Shift+Tab
from Close returns to the scroll container; from there it dismisses help and
continues backward from the trigger. Outside clicks and focus changes dismiss
without stealing focus from the chosen destination. Annotation keybindings
retain their existing behavior when the Timeline itself has focus.

The panel wraps its shortcut table, scrolls vertically, and clamps both axes
inside the viewport with room for its focus ring. Resize and scroll events,
plus observed panel/trigger size changes, reposition it as the viewport, text
size, or translated content changes. A sticky header keeps dismissal available
when a small viewport forces help to cover its trigger.

Browser regressions cover real keyboard navigation, outside dismissal, English
and Hebrew reflow at 320px with 200% text, short viewports, and changes while
open. The axe gate includes the portal and measures Close glyph contrast at
rest, hover, and press; focus gates cover the panel and Close in normal and
forced colors. Screen-reader speech still needs a VoiceOver/NVDA walkthrough;
this does not close the wider Timeline audit or decide multitrack interaction.
