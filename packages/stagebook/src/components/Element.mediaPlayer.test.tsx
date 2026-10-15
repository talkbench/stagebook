// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import { Element } from "./Element.js";

// MediaPlayer's start lifecycle has separate tests. This guards the treatment
// element -> player prop boundary, especially an explicit false value.
vi.mock("./elements/MediaPlayer.js", () => ({
  MediaPlayer: ({ autoplay }: { autoplay?: boolean }) => (
    <div data-testid="media-player" data-autoplay={String(autoplay)} />
  ),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const context: StagebookContext = {
  get: () => [],
  save: () => {},
  getElapsedTime: () => 0,
  submit: () => {},
  getAssetURL: (path) => `https://cdn.test/${path}`,
  getTextContent: () => Promise.resolve(""),
  progressLabel: "game_0_video",
  playerId: "participant",
  position: 0,
  playerCount: 1,
  isSubmitted: false,
};

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
});

test.each([true, false, undefined])(
  "Element forwards autoplay=%s without applying a default",
  (autoplay) => {
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root!.render(
        <StagebookProvider value={context}>
          <Element
            element={{
              type: "mediaPlayer",
              name: "clip",
              file: "clip.mp4",
              playback: "once",
              ...(autoplay === undefined ? {} : { autoplay }),
            }}
            onSubmit={() => {}}
          />
        </StagebookProvider>,
      );
    });
    expect(
      container
        .querySelector('[data-testid="media-player"]')
        ?.getAttribute("data-autoplay"),
    ).toBe(String(autoplay));
  },
);
