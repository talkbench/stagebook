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
 *
 * Three treatments, one file: the halo for box-model controls
 * (`focusRingCss`), a real outline for inline text (`focusOutlineCss`), and
 * an inset outline for rows inside a scroll container
 * (`focusInsetOutlineCss`, #627). Every focusable primitive is in
 * `focus.gate.ct.tsx`, whichever it takes.
 */

/**
 * The accent the indicator is painted in.
 *
 * The fallback is nested for a reason. `--stagebook-focus-ring` is aliased to
 * `--stagebook-primary` in `styles.css`, which hosts may legitimately not
 * load (#213) — components carry their own styles. Such a host themes by
 * defining `--stagebook-primary` alone, which leaves `--stagebook-focus-ring`
 * undefined; a single-level fallback would then drop straight to our
 * hard-coded blue and ignore their accent entirely. Reaching through to
 * `--stagebook-primary` first keeps the "retuning the accent retunes the
 * ring" promise true in both configurations — as long as that accent itself
 * clears 3:1 on the host's page color, which the palette gate asserts for
 * ours.
 */
export const FOCUS_RING_ACCENT =
  "var(--stagebook-focus-ring, var(--stagebook-primary, #2563eb))";

/** The two halo layers: a page-colored spacer, then the accent ring. */
export const FOCUS_RING_HALO = `0 0 0 2px var(--stagebook-bg, #fff), 0 0 0 4px ${FOCUS_RING_ACCENT}`;

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
  return `outline: 2px solid ${FOCUS_RING_ACCENT};
          outline-offset: 2px;`;
}

/**
 * The indicator for a row inside a scroll container — the Select picker's
 * options (#627). Rows sit flush against each other and are clipped at the
 * container's edge, so the outer halo would overlap the neighbouring rows
 * and lose its top or bottom at the scroll boundary. Inset, the ring stays
 * whole on every row. No page-colored spacer is needed: a row's fill is
 * never the accent (the surface at rest, the hover fill when hovered or
 * walked), and the palette gate asserts the ring at 3:1 on both.
 * Forced-colors honors it as it does the inline-text outline.
 */
export function focusInsetOutlineCss(): string {
  return `outline: 2px solid ${FOCUS_RING_ACCENT};
          outline-offset: -2px;`;
}
