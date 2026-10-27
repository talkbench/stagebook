// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssetMountCard } from "./AssetMountCard.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function render(node: ReactNode): {
  container: HTMLElement;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
  });
  return {
    container,
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
}

const buttons = (c: HTMLElement) => [...c.querySelectorAll("button")];

describe("AssetMountCard (#192, #813)", () => {
  it("offers Choose folder… for each unmapped prefix", () => {
    const onPick = vi.fn();
    const { container, unmount } = render(
      <AssetMountCard unmapped={["recordings", "diagrams"]} onPick={onPick} />,
    );

    expect(container.textContent).toContain("2 asset folders aren't mapped");
    expect(container.textContent).toContain(
      "on your machine — until a prefix has one, its media shows a placeholder.",
    );
    const [first, second] = buttons(container);
    expect(first.textContent).toBe("Choose folder…");
    expect(first.getAttribute("aria-label")).toBe(
      "Choose folder for asset://recordings/",
    );
    act(() => second.click());
    expect(onPick).toHaveBeenCalledWith("diagrams");
    unmount();
  });

  it("lists each mapped prefix with its folder and a Change… button", () => {
    const onPick = vi.fn();
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={[]}
        mounted={{ annotation: "/Volumes/media/preview" }}
        onPick={onPick}
      />,
    );

    expect(container.textContent).toContain("Asset folders");
    expect(container.textContent).not.toContain("mapped");
    // Nothing is unmapped, so no placeholder caveat.
    expect(container.textContent).toContain("on your machine. Choose");
    expect(container.textContent).toContain("asset://annotation/");
    expect(container.textContent).toContain("/Volumes/media/preview");
    const [change] = buttons(container);
    expect(change.textContent).toBe("Change…");
    expect(change.getAttribute("aria-label")).toBe(
      "Change folder for asset://annotation/",
    );
    act(() => change.click());
    expect(onPick).toHaveBeenCalledWith("annotation");
    unmount();
  });

  it("puts unmapped prefixes before mapped ones", () => {
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={["recordings"]}
        mounted={{ annotation: "/data/annotation" }}
        onPick={() => {}}
      />,
    );

    expect(container.textContent).toContain("1 asset folder isn't mapped");
    expect(buttons(container).map((b) => b.textContent)).toEqual([
      "Choose folder…",
      "Change…",
    ]);
    unmount();
  });

  it("renders nothing when there are no prefixes", () => {
    const { container, unmount } = render(
      <AssetMountCard unmapped={[]} mounted={{}} onPick={() => {}} />,
    );

    expect(container.innerHTML).toBe("");
    unmount();
  });
});
