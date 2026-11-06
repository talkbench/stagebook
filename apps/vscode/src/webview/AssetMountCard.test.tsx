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
const title = (c: HTMLElement) => c.querySelector("strong")?.textContent;

describe("AssetMountCard (#192, #813)", () => {
  it("offers Choose folder… for each unmapped prefix", () => {
    const onPick = vi.fn();
    const { container, unmount } = render(
      <AssetMountCard unmapped={["recordings", "diagrams"]} onPick={onPick} />,
    );

    expect(title(container)).toBe("2 asset folders aren't mapped");
    expect(container.textContent).toContain("placeholder");
    // The live preview's banner: no mapped rows.
    expect(buttons(container)).toHaveLength(2);
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

    expect(title(container)).toBe("Asset folders");
    // Nothing is unmapped, so no placeholder caveat.
    expect(container.textContent).not.toContain("placeholder");
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

    expect(title(container)).toBe("1 asset folder isn't mapped");
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

  it("lists the files a mapped folder lacks under its Change… row (#833)", () => {
    const onPick = vi.fn();
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={[]}
        mounted={{ clips: "/data/wrong" }}
        missing={{ clips: ["session3/a.mp4", "session3/b.mp4"] }}
        onPick={onPick}
      />,
    );

    expect(title(container)).toBe("2 asset files weren't found");
    const list = container.querySelector(
      'ul[aria-label="Files not found in the folder for asset://clips/"]',
    );
    expect(
      [...(list?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
    ).toEqual(["session3/a.mp4", "session3/b.mp4"]);
    const [change] = buttons(container);
    expect(change.textContent).toBe("Change…");
    act(() => change.click());
    expect(onPick).toHaveBeenCalledWith("clips");
    unmount();
  });

  it("caps the missing list and says how many more (#833)", () => {
    const missing = Array.from({ length: 8 }, (_, i) => `clip${i}.mp4`);
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={[]}
        mounted={{ clips: "/data/wrong" }}
        missing={{ clips: missing }}
        onPick={() => {}}
      />,
    );

    expect(title(container)).toBe("8 asset files weren't found");
    const items = [
      ...container.querySelectorAll('ul[aria-label^="Files not found"] li'),
    ].map((li) => li.textContent);
    expect(items).toEqual([
      "clip0.mp4",
      "clip1.mp4",
      "clip2.mp4",
      "clip3.mp4",
      "clip4.mp4",
      "and 3 more",
    ]);
    unmount();
  });

  it("names a single missing file in the title (#833)", () => {
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={[]}
        mounted={{ clips: "/data/wrong", other: "/data/other" }}
        missing={{ clips: ["a.mp4"] }}
        onPick={() => {}}
      />,
    );

    expect(title(container)).toBe("1 asset file wasn't found");
    // A folder with nothing missing gets no list.
    expect(
      container.querySelectorAll('ul[aria-label^="Files not found"]'),
    ).toHaveLength(1);
    unmount();
  });

  it("keeps the unmapped title when prefixes are unmapped too (#833)", () => {
    const { container, unmount } = render(
      <AssetMountCard
        unmapped={["recordings"]}
        mounted={{ clips: "/data/wrong" }}
        missing={{ clips: ["a.mp4"] }}
        onPick={() => {}}
      />,
    );

    expect(title(container)).toBe("1 asset folder isn't mapped");
    expect(container.textContent).toContain("a.mp4");
    unmount();
  });
});
