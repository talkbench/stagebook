// @vitest-environment jsdom
import { describe, test, expect, afterEach, beforeAll } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImageElement } from "./ImageElement.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  container = undefined;
});

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

describe("ImageElement — alt text (#536)", () => {
  test("renders the provided alt on the <img>", () => {
    const el = render(
      <ImageElement src="diagram.png" alt="A labeled bar chart" />,
    );
    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("A labeled bar chart");
  });

  test('renders alt="" (decorative) when alt is an explicit empty string', () => {
    const el = render(<ImageElement src="divider.png" alt="" />);
    const img = el.querySelector("img");
    // Present-but-empty: the image is exposed to screen readers as decorative.
    expect(img?.getAttribute("alt")).toBe("");
  });

  test('falls back to alt="" when no alt is supplied', () => {
    const el = render(<ImageElement src="diagram.png" />);
    const img = el.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("");
  });

  test("still honors width", () => {
    const el = render(
      <ImageElement src="diagram.png" alt="chart" width={50} />,
    );
    const img = el.querySelector("img");
    expect(img?.style.width).toBe("50%");
  });
});
