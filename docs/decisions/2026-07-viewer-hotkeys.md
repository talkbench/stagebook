# Viewer researcher keyboard shortcuts (July 2026)

Status: **accepted** — design settled in [#534] (see its thread for the full
compatibility research and citations). Implemented by the PR that links here.

[#534]: https://github.com/talkbench/stagebook/issues/534

## Motivation

The viewer (`stagebook/viewer` harness — the standalone app, the VS Code
webview preview, and external hosts) is how a researcher drives a study while
authoring it: switch treatment, step through stages, jump to a player
position, scrub the timeline. All of that was mouse-only. The common
inner-loop actions deserve keyboard shortcuts.

The constraint that shapes the whole design: the viewer renders **real study
content**, and that content has its own keyboard behavior (move a radio, type
in a Prompt, drag a Slider, Space to play a Timeline). Any chrome shortcut has
to coexist with participant input without a focus-sniffing heuristic.

## Decision

**The modifier is a namespace.** Every viewer shortcut is `Alt`/`Option` +
key, and the modifier separates the two roles unambiguously:

> **Bare keys → the study content** (participant actions).
> **Alt/Option + key → the viewer chrome** (researcher actions).

Because unmodified keys always pass through and modified keys always drive the
chrome, there is no `document.activeElement` sniffing and no special-casing of
the element-level key handlers — a chrome shortcut works even while the caret
sits in a textarea (that is the point: it is *focus-independent*).

### Keymap

| Keys | Action |
|---|---|
| `Alt+←` / `Alt+→` | previous / next step (clamped, no wrap) |
| `Alt+↑` / `Alt+↓` | previous / next treatment (cycle the unit list) |
| `Alt+P` | focus the "part to preview" picker |
| `Alt+0` … `Alt+9` | select player position N (ignored if `N ≥ playerCount`) |
| `Alt+K` | timer play/pause (only when the step has a `duration`) |
| `Alt+/` | toggle the shortcut cheatsheet |

Two points where the implementation refined the #534 sketch:

- **`Alt+P` to focus the picker.** `Alt+↑/↓` cycles *adjacent* treatments,
  which is right for A/B toggling but poor for browsing: treatments are a
  flat, name-keyed set with no meaningful order (alphabetical by group), so
  blind cycling can never show the whole list. `Alt+P` focuses the native
  `<select>`, which gives typeahead-by-name (the fast way into an alphabetical
  list) and the OS dropdown for a full view — mirroring an existing focusable
  control, per the "every shortcut mirrors a control" rule below.
- **Cheatsheet is `Alt+/`, not bare `?`.** #534 sketched a bare `?`; keeping
  it inside the `Alt` namespace holds the "bare keys belong to the study" line
  with no exception.

### Load-bearing implementation rules

- **Key off `event.code`, never `event.key`.** On macOS, `Option` composes the
  character (`Option+K` → `˚`, `Option+3` → `£`), so `event.key` is unreliable;
  `event.code` (`"KeyK"`, `"Digit3"`, `"ArrowLeft"`) is physical and
  layout-independent. Gate on `e.altKey && !e.ctrlKey && !e.metaKey` so Windows
  AltGr (reported as Ctrl+Alt) and Cmd/Ctrl accelerators still pass through.
- **Scope the listener to the focused viewer**, not `window`: it lives on the
  viewer root (`tabIndex=-1`, focus-on-click), so several embedded viewers and
  the host page never cross-fire.
- **Every shortcut mirrors an existing focusable control** (button or
  `<select>`) — never a keyboard-only action. Mirrored controls carry
  `aria-keyshortcuts` and key hints in their tooltips.
- **`preventDefault()` only on handled keys** — suppresses the macOS
  Option-symbol insertion and the one native overlap (see below).

## Cross-OS / cross-host caveats

Verified across Chrome / Firefox / Safari and the VS Code (Chromium) webview on
macOS / Windows / Linux (full citations in #534). Residual, accepted gaps:

- **`Alt+←/→` overlaps two native behaviors, both narrow.** (1) *Browser
  history* back/forward — but only for the viewer running as a plain web page
  on **Windows/Linux** desktop browsers; macOS browsers bind Back to `⌘←`, and
  the VS Code webview has no history stack. The `keydown` is cancelable, so
  `preventDefault()` suppresses it. Documented fallback if a real leak is ever
  reported: `Alt+[` / `Alt+]`. (2) **macOS in-field word-navigation** —
  `Option+←/→` is the standard word-jump (and `Option+Shift+←/→` word-select)
  inside any text field. This corrects #534's finding #3, which considered only
  browser history and concluded "macOS unaffected": inside a focused study
  Prompt/TextArea in the preview, `Option+←` steps the *stage* instead of the
  caret. This is consistent with the namespace design (Alt = chrome, even in a
  textarea) and is working-as-intended, but researchers lose in-preview word
  nav — an accepted trade, noted here so the claim isn't repeated uncorrected.
- **`Alt+digit`** switches tabs in Firefox-on-Linux (likely not preventable) —
  accepted minor gap.
- **Windows VS Code** captures `Alt` + a menu-mnemonic letter (F/E/S/V/G/R/T/H).
  The keymap avoids all of them; `Alt+P` and `Alt+K` are safe.

## Non-goals

- Participant-facing accessibility — that lives in the runner and its a11y
  work, not this researcher-only chrome. (These modifier-plus-single-key
  shortcuts are exempt from WCAG 2.1.4 Character Key Shortcuts anyway.)
- A user-configurable keybinding UI.
