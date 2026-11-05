// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pointerPosition, pointerRegion } from "./pointerGeometry.js";

function rectangle(
  element: Element,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    new DOMRect(x, y, w, h),
  );
}

beforeEach(() => {
  vi.stubGlobal("innerWidth", 100);
  vi.stubGlobal("innerHeight", 80);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pointerPosition", () => {
  test("retains fractional geometry and normalizes against the whole control", () => {
    const button = document.createElement("button");
    rectangle(button, 10.25, 20.75, 61, 31);

    expect(pointerPosition(button, 40.75, 36.25)).toEqual({
      x: 0.5,
      y: 0.5,
      width: 61,
      height: 31,
      viewportClipped: false,
      inViewCenterX: (40 - 10.25) / 61,
      inViewCenterY: (36 - 20.75) / 31,
    });
  });

  test("does not round a near-center sample into an exact-center sample", () => {
    const input = document.createElement("input");
    rectangle(input, 10.125, 20.375, 70.5, 30.25);

    const position = pointerPosition(input, 45.376, 35.499);
    expect(position?.x).toBe((45.376 - 10.125) / 70.5);
    expect(position?.y).toBe((35.499 - 20.375) / 30.25);
    expect(position?.x).not.toBe(0.5);
    expect(position?.y).not.toBe(0.5);
  });

  test("uses the floored center of the viewport intersection", () => {
    const field = document.createElement("textarea");
    rectangle(field, -20.5, 60.25, 60, 40);

    expect(pointerPosition(field, 19, 70)).toEqual({
      x: 39.5 / 60,
      y: 9.75 / 40,
      width: 60,
      height: 40,
      viewportClipped: true,
      inViewCenterX: 39.5 / 60,
      inViewCenterY: 9.75 / 40,
    });
  });

  test("does not invent an in-view center for a fully offscreen element", () => {
    const button = document.createElement("button");
    rectangle(button, 100, 0, 40, 20);

    expect(pointerPosition(button, 110, 10)).toMatchObject({
      x: 0.25,
      y: 0.5,
      viewportClipped: true,
      inViewCenterX: null,
      inViewCenterY: null,
    });
  });

  test("retains coordinates outside a control, including a genuine zero", () => {
    const input = document.createElement("input");
    rectangle(input, 10, 10, 10, 10);

    expect(pointerPosition(input, 0, 25)).toMatchObject({ x: -1, y: 1.5 });
  });

  test.each([
    [0, 10],
    [10, 0],
    [-10, 10],
    [Number.NaN, 10],
    [10, Number.POSITIVE_INFINITY],
  ])("omits unusable rectangles with dimensions %s by %s", (width, height) => {
    const input = document.createElement("input");
    rectangle(input, 0, 0, width, height);

    expect(pointerPosition(input, 5, 5)).toBeNull();
  });

  test("omits non-finite coordinates or a non-finite rectangle origin", () => {
    const input = document.createElement("input");
    rectangle(input, 0, 0, 20, 20);
    expect(pointerPosition(input, Number.NaN, 5)).toBeNull();
    expect(pointerPosition(input, 5, Number.POSITIVE_INFINITY)).toBeNull();

    rectangle(input, Number.POSITIVE_INFINITY, 0, 20, 20);
    expect(pointerPosition(input, 5, 5)).toBeNull();
  });

  test("omits geometry when its document has no viewport", () => {
    const detachedDocument = document.implementation.createHTMLDocument();
    const input = detachedDocument.createElement("input");
    rectangle(input, 0, 0, 20, 20);

    expect(pointerPosition(input, 5, 5)).toBeNull();
  });
});

describe("pointerRegion", () => {
  function choice() {
    const row = document.createElement("label");
    const input = document.createElement("input");
    const text = document.createTextNode("A long label");
    row.append(input, text);
    rectangle(input, 8, 14, 16, 16);

    // jsdom has no layout. Keep real Ranges so these fixtures verify which
    // text nodes are measured; the browser supplies their rectangles.
    const boxes = new Map<Node, DOMRect[]>([
      [text, [new DOMRect(32, 10, 60, 14), new DOMRect(32, 24, 30, 14)]],
    ]);
    const createRange = document.createRange.bind(document);
    vi.spyOn(document, "createRange").mockImplementation(() => {
      const range = createRange();
      Object.defineProperty(range, "getClientRects", {
        value: () => boxes.get(range.startContainer) ?? [],
      });
      return range;
    });
    return { row, input, text, boxes };
  }

  test("recognizes the native input glyph before overlapping text rectangles", () => {
    const { row, input, text, boxes } = choice();
    boxes.set(text, [new DOMRect(0, 0, 100, 44)]);

    expect(pointerRegion(row, input, 16, 22)).toBe("control");
  });

  test("recognizes each wrapped text fragment without changing the label", () => {
    const { row, input } = choice();
    const before = row.innerHTML;

    expect(pointerRegion(row, input, 80, 15)).toBe("label-text");
    expect(pointerRegion(row, input, 45, 30)).toBe("label-text");
    expect(row.innerHTML).toBe(before);
  });

  test("does not mistake whitespace inside a text bounding union for text", () => {
    const { row, input } = choice();

    expect(pointerRegion(row, input, 80, 30)).toBe("padding");
    expect(pointerRegion(row, input, 4, 22)).toBe("padding");
    expect(pointerRegion(row, input, 28, 22)).toBe("padding");
  });

  test("ignores whitespace-only nodes and text inside the input", () => {
    const { row, input, boxes } = choice();
    const blank = document.createTextNode(" \n ");
    const inside = document.createTextNode("not label text");
    row.append(blank);
    input.append(inside);
    boxes.set(blank, [new DOMRect(0, 0, 100, 44)]);
    boxes.set(inside, [new DOMRect(0, 0, 100, 44)]);

    expect(pointerRegion(row, input, 80, 30)).toBe("padding");
  });

  test("supports nested and RTL text using rendered coordinates", () => {
    const { row, input, text, boxes } = choice();
    row.dir = "rtl";
    const span = document.createElement("span");
    span.append(text);
    row.append(span);
    rectangle(input, 76, 14, 16, 16);
    boxes.set(text, [new DOMRect(8, 15, 60, 14)]);

    expect(pointerRegion(row, input, 84, 22)).toBe("control");
    expect(pointerRegion(row, input, 20, 22)).toBe("label-text");
    expect(pointerRegion(row, input, 72, 22)).toBe("padding");
  });
});
