/**
 * The focus indicator every Stagebook control shares (#610).
 *
 * Stagebook components each carry their own scoped `<style>` block rather
 * than depending on `styles.css` being loaded (#213), which is why the ring
 * is a string helper here and not a class in the stylesheet: it has to be
 * inlined per component, with `var()` fallbacks, so a host that never loads
 * our CSS still gets the right indicator. Keeping the single definition here
 * is what stops the sixteen copies from drifting again — they already had,
 * identically wrong, which is how #610 came to be sixteen fixes.
 *
 * Two things make this pattern non-obvious, and both are load-bearing:
 *
 * **The ring is opaque, and drawn as two layers.** A translucent ring can't
 * reach the 3:1 that WCAG 1.4.11 asks of a non-text indicator — no hue at
 * 25% alpha does. But going opaque isn't enough on its own: on a control
 * whose own fill *is* the accent (a primary Button, a checked radio) a flat
 * accent ring is 1.00:1 — invisible. So the accent ring sits outside a
 * page-colored spacer, which guarantees a contrasting edge whatever the ring
 * abuts: 5.17:1 on the page, 3.51:1 against a gray-300 control border,
 * 5.17:1 against an accent fill.
 *
 * **The outline is transparent on purpose — do not "clean it up".** In
 * forced-colors mode the browser drops `box-shadow` entirely and honors
 * `outline`, so the old `outline: none` + box-shadow pairing left high-
 * contrast users with no focus indicator at all. Declaring a transparent
 * outline costs nothing visually (the halo does the drawing, and outlines
 * don't affect layout), and forced-colors repaints its color from the system
 * palette — so the indicator survives with no `@media` block, and no
 * `!important` fight against the inline styles some containers set. This is
 * also what honors the policy stated at styles.css:64 — an OS accessibility
 * override is the participant's need, not a theme preference.
 *
 * The same two layers are written out longhand for the native inputs in
 * `styles.css`, which can't import this. Change one, change both.
 */

/**
 * The two halo layers: a page-colored spacer, then the accent ring.
 *
 * `--stagebook-focus-ring` defaults to `--stagebook-primary`, so retuning a
 * host's accent retunes the ring — as long as that accent itself clears 3:1
 * on the host's page color, which the palette gate asserts for ours.
 */
export const FOCUS_RING_HALO =
  "0 0 0 2px var(--stagebook-bg, #fff), 0 0 0 4px var(--stagebook-focus-ring, #2563eb)";

/**
 * The full declaration block for a focus rule, for interpolation into a
 * component's scoped `<style>`:
 *
 * ```ts
 * `.${cls}:focus-visible { ${focusRingCss()} }`
 * ```
 *
 * Any `beneath` shadows are appended after the halo layers, so a control's
 * resting elevation survives underneath the ring rather than being replaced
 * by it (box-shadow is a single property — naming the ring alone would drop
 * the elevation for exactly as long as the control is focused).
 *
 * `beneath` takes literal shadow values only. The result is interpolated
 * into a component's `<style>` block, so passing anything caller- or
 * author-derived would be a CSS injection point; no call site does, and none
 * should start.
 */
export function focusRingCss(...beneath: string[]): string {
  const layers = [FOCUS_RING_HALO, ...beneath].join(", ");
  return `outline: 2px solid transparent;
          outline-offset: 2px;
          box-shadow: ${layers};`;
}

/**
 * The indicator for inline text — a link inside a paragraph, or a scrollable
 * code block. A box-shadow halo would wrap each line fragment of a wrapped
 * link and read as a highlight rather than a ring, so these take a real
 * outline instead. Forced-colors needs no special handling here: it already
 * honors `outline`, and only repaints the color.
 */
export function focusOutlineCss(): string {
  return `outline: 2px solid var(--stagebook-focus-ring, #2563eb);
          outline-offset: 2px;`;
}
