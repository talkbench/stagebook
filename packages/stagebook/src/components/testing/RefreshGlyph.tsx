/**
 * A decorative glyph for icon-only Button tests. Playwright CT can only
 * mount components it can import, so this lives here rather than inline in
 * the `.ct.tsx` files that use it.
 *
 * `aria-hidden` keeps the SVG out of the accessible-name computation —
 * which is what a consumer should do with a decorative glyph, so the name
 * is the button's `aria-label` alone. `currentColor` picks up the variant's
 * text colour.
 */
import React from "react";

export function RefreshGlyph() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      width="1.25rem"
      height="1.25rem"
      fill="currentColor"
      data-testid="glyph"
    >
      <path d="M4 10a6 6 0 0 1 10.24-4.24L15.5 4.5V9h-4.5l1.7-1.7A4 4 0 1 0 14 10h2a6 6 0 1 1-12 0z" />
    </svg>
  );
}
