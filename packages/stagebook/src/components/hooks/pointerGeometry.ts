import type { PointerPosition } from "../../utils/pointerTelemetry.js";

function usableRectangle(rect: DOMRect): boolean {
  return (
    [
      rect.left,
      rect.top,
      rect.right,
      rect.bottom,
      rect.width,
      rect.height,
    ].every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Measure the stable control/label border box in CSS pixels. Keep full numeric
 * precision and out-of-bounds values: a label click can lie outside its input.
 *
 * The in-view center uses WebDriver's floor(center) convention. This captures
 * fractional-origin rounding that width/height alone cannot reconstruct.
 * Viewport clipping does not account for overflow ancestors or occlusion;
 * transformed controls use their axis-aligned bounding box.
 */
export function pointerPosition(
  element: Element,
  clientX: number,
  clientY: number,
): PointerPosition | null {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  if (
    !view ||
    !usableRectangle(rect) ||
    ![clientX, clientY, view.innerWidth, view.innerHeight].every(
      Number.isFinite,
    ) ||
    view.innerWidth < 0 ||
    view.innerHeight < 0
  ) {
    return null;
  }

  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const left = Math.max(0, rect.left);
  const right = Math.min(view.innerWidth, rect.right);
  const top = Math.max(0, rect.top);
  const bottom = Math.min(view.innerHeight, rect.bottom);
  const intersectsViewport = right > left && bottom > top;

  return {
    x,
    y,
    width: rect.width,
    height: rect.height,
    viewportClipped:
      left !== rect.left ||
      right !== rect.right ||
      top !== rect.top ||
      bottom !== rect.bottom,
    inViewCenterX: intersectsViewport
      ? (Math.floor((left + right) / 2) - rect.left) / rect.width
      : null,
    inViewCenterY: intersectsViewport
      ? (Math.floor((top + bottom) / 2) - rect.top) / rect.height
      : null,
  };
}

function containsPoint(rect: DOMRect, x: number, y: number): boolean {
  return (
    usableRectangle(rect) &&
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  );
}

/**
 * Choice labels contain plain text nodes. Ranges preserve that DOM/layout while
 * distinguishing text fragments from padding and gaps, including wrapped/RTL
 * text. These are font metric rectangles, not the painted pixels of glyphs.
 */
export function pointerRegion(
  row: Element,
  input: Element,
  x: number,
  y: number,
): "control" | "label-text" | "padding" {
  if (containsPoint(input.getBoundingClientRect(), x, y)) return "control";

  const document = row.ownerDocument;
  const texts = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    if (input.contains(node) || !node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (containsPoint(rect, x, y)) return "label-text";
    }
  }
  return "padding";
}
