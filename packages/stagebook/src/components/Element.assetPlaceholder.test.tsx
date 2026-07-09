// @vitest-environment jsdom
//
// #191: an `asset://` media/prompt reference that the host can't resolve (a
// preview host has no platform resolver, so its getAssetURL returns the URI
// unchanged) must render a labeled placeholder — NOT a broken <video>/<img>/
// <audio> or a request pointed at a nonsensical `<base>asset://…` URL.
import { describe, test, expect, vi, beforeAll } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import { Element } from "./Element.js";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

function makeContext(overrides?: Partial<StagebookContext>): StagebookContext {
  return {
    get: vi.fn(() => []),
    save: vi.fn(),
    getElapsedTime: vi.fn(() => 0),
    submit: vi.fn(),
    // A preview host with no platform resolver: `asset://` passes through
    // unchanged (the signal that it's unresolved); anything else gets a base.
    getAssetURL: vi.fn((p: string) =>
      p.startsWith("asset://") ? p : `https://cdn.test/${p}`,
    ),
    getTextContent: vi.fn(() => Promise.resolve("mock")),
    progressLabel: "game_0_media",
    playerId: "internal-player-1",
    position: 0,
    playerCount: 2,
    isSubmitted: false,
    ...overrides,
  };
}

function renderElement(
  element: Record<string, unknown>,
  ctx: StagebookContext = makeContext(),
): HTMLElement {
  const container = document.createElement("div");
  act(() => {
    createRoot(container).render(
      <StagebookProvider value={ctx}>
        <Element element={element as never} onSubmit={() => {}} />
      </StagebookProvider>,
    );
  });
  return container;
}

const placeholder = (c: HTMLElement) =>
  c.querySelector('[data-testid="asset-placeholder"]');

describe("Element asset:// placeholder (#191)", () => {
  test("mediaPlayer with an unresolved asset:// url renders a placeholder, not a <video>", () => {
    const uri = "asset://group_recordings/session.mp4";
    const c = renderElement({ type: "mediaPlayer", file: uri });
    // The whole point: no <video> pointed at a garbled/unresolvable URL.
    expect(c.querySelector("video")).toBeNull();
    const p = placeholder(c);
    expect(p).not.toBeNull();
    expect(p?.getAttribute("data-asset-uri")).toBe(uri);
    // The surface names the exact reference being stubbed.
    expect(p?.textContent).toContain(uri);
  });

  test("image with an unresolved asset:// file renders a placeholder, not an <img>", () => {
    const c = renderElement({ type: "image", file: "asset://diagrams/x.png" });
    expect(c.querySelector("img")).toBeNull();
    expect(placeholder(c)).not.toBeNull();
    expect(placeholder(c)?.textContent).toContain("asset://diagrams/x.png");
  });

  test("audio with an unresolved asset:// file renders a placeholder, not an <audio>", () => {
    const c = renderElement({ type: "audio", file: "asset://clips/intro.mp3" });
    expect(c.querySelector("audio")).toBeNull();
    expect(placeholder(c)).not.toBeNull();
  });

  test("prompt with an unresolved asset:// file renders a placeholder and never fetches it", () => {
    const getTextContent = vi.fn(() => Promise.resolve("mock"));
    const c = renderElement(
      { type: "prompt", file: "asset://private/intro.prompt.md" },
      makeContext({ getTextContent }),
    );
    expect(placeholder(c)).not.toBeNull();
    // The asset:// prompt path must NOT be handed to getTextContent.
    expect(getTextContent).not.toHaveBeenCalledWith(
      "asset://private/intro.prompt.md",
    );
  });

  test("a resolvable image file still renders the media (no placeholder)", () => {
    const c = renderElement({ type: "image", file: "images/logo.png" });
    expect(placeholder(c)).toBeNull();
    const img = c.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("https://cdn.test/images/logo.png");
  });

  test("mediaPlayer with a resolvable url + asset:// captions plays the video (captions dropped, not fetched)", () => {
    // Only the captions are unresolvable — the video itself resolves, so it
    // must still play; the asset:// track is dropped, never fetched (#191).
    const fetchSpy = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      } as unknown as Response),
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      const c = renderElement({
        type: "mediaPlayer",
        file: "clip.mp4",
        captionsFile: "asset://captions/en.vtt",
      });
      // Not a placeholder — the video resolved and plays.
      expect(placeholder(c)).toBeNull();
      expect(c.querySelector("video")).not.toBeNull();
      // The unresolved asset:// captions track must never be fetched.
      for (const call of fetchSpy.mock.calls) {
        expect(String(call[0])).not.toContain("asset://");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
