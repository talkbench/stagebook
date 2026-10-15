// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import { Stage } from "./Stage.js";

// A Next button gated on a sibling player's playback (#710), end to end:
// the player saves through the host, the host re-renders, and the button's
// condition reads the record back through `resolve`. The Host below stores
// saves the way a real host does, keyed by storage key. jsdom's <video>
// never plays: play()/pause() are stubbed to flip `paused` and fire their
// events, and time is moved by hand.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Elements = Record<string, unknown>[];

function Host({
  elements,
  initial = {},
}: {
  elements: Elements;
  initial?: Record<string, unknown>;
}) {
  const [store, setStore] = useState(initial);
  const ctx: StagebookContext = {
    get: (key) => (key in store ? [store[key]] : []),
    save: (key, value) => setStore((s) => ({ ...s, [key]: value })),
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path) => `https://cdn.test/${path}`,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "intro_0_instructions",
    playerId: "player1",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
  };
  return (
    <StagebookProvider value={ctx}>
      <Stage stage={{ name: "instructions", elements }} onSubmit={() => {}} />
    </StagebookProvider>
  );
}

function player(name: string, extra: Record<string, unknown> = {}) {
  return {
    type: "mediaPlayer",
    name,
    file: `https://example.com/${name}.mp4`,
    controls: { playPause: true, seek: true, speed: true },
    ...extra,
  };
}

function next(reference: string) {
  return {
    type: "submitButton",
    name: "next",
    conditions: [{ reference, comparator: "exists" }],
  };
}

let container: HTMLDivElement;
let root: Root;

function render(elements: Elements, initial?: Record<string, unknown>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Host elements={elements} initial={initial} />));
  for (const video of container.querySelectorAll("video")) {
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(video, "seekable", {
      configurable: true,
      get: () => ({ length: 1, start: () => 0, end: () => 100 }),
    });
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
  }
}

const shown = (button: string) =>
  container.querySelector(`[data-testid="element-submitButton-${button}"]`) !==
  null;
const nextShown = () => shown("next");

function within(name: string) {
  const el = container.querySelector(
    `[data-testid="element-mediaPlayer-${name}"]`,
  );
  if (!el) throw new Error(`no player ${name}`);
  return el;
}

// The controls hide during playback unless hovered; the keys always work.
function press(name: string, key: string) {
  const el = within(name).querySelector('[data-testid="mediaPlayer"]')!;
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}
const playPause = (name: string) => press(name, "k");

function moveTo(name: string, t: number) {
  const video = within(name).querySelector("video")!;
  act(() => {
    video.currentTime = t;
    video.dispatchEvent(new Event("timeupdate"));
  });
}

const proto = window.HTMLMediaElement.prototype;
const originals = {
  play: Object.getOwnPropertyDescriptor(proto, "play"),
  pause: Object.getOwnPropertyDescriptor(proto, "pause"),
};

function stubPlay(play: (this: HTMLMediaElement) => Promise<void>) {
  Object.defineProperty(proto, "play", { configurable: true, value: play });
}

function playing(this: HTMLMediaElement) {
  Object.defineProperty(this, "paused", {
    configurable: true,
    get: () => false,
  });
  this.dispatchEvent(new Event("play"));
  return Promise.resolve();
}

beforeEach(() => {
  stubPlay(playing);
  Object.defineProperty(proto, "pause", {
    configurable: true,
    value(this: HTMLMediaElement) {
      if (this.paused) return;
      Object.defineProperty(this, "paused", {
        configurable: true,
        get: () => true,
      });
      this.dispatchEvent(new Event("pause"));
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  if (originals.play) Object.defineProperty(proto, "play", originals.play);
  if (originals.pause) Object.defineProperty(proto, "pause", originals.pause);
});

describe("Next gated on a player's playback (#710)", () => {
  it("appears at the first play, not for seeks or speed changes", () => {
    render([
      player("example_nod"),
      next("self.mediaPlayer.example_nod.firstPlay"),
      // Gated on the record existing: the gate the issue warns against.
      {
        type: "submitButton",
        name: "saved",
        conditions: [
          { reference: "self.mediaPlayer.example_nod", comparator: "exists" },
        ],
      },
    ]);
    expect(nextShown()).toBe(false);

    press("example_nod", "ArrowRight"); // seek
    press("example_nod", ">"); // speed
    expect(shown("saved")).toBe(true);
    expect(nextShown()).toBe(false);

    playPause("example_nod");
    expect(nextShown()).toBe(true);
  });

  it("stays after pause, the end, and a replay", () => {
    render([
      player("example_nod", { stopAt: 5 }),
      next("self.mediaPlayer.example_nod.firstPlay"),
    ]);
    playPause("example_nod");
    playPause("example_nod");
    expect(nextShown()).toBe(true);
    playPause("example_nod");
    moveTo("example_nod", 5.1);
    playPause("example_nod"); // replay from the start
    expect(nextShown()).toBe(true);
  });

  it("ignores another player's playback", () => {
    render([
      player("example_nod"),
      player("other"),
      next("self.mediaPlayer.example_nod.firstPlay"),
    ]);
    playPause("other");
    expect(nextShown()).toBe(false);
    playPause("example_nod");
    expect(nextShown()).toBe(true);
  });

  it("does not appear when the browser blocks the play attempt", async () => {
    // Blocked autoplay rejects play() and fires no `play` event.
    stubPlay(() => Promise.reject(new DOMException("blocked", "NotAllowed")));
    render([
      { type: "mediaPlayer", name: "intro", file: "https://example.com/i.mp4" },
      next("self.mediaPlayer.intro.firstPlay"),
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    const playOnce = container.querySelector<HTMLButtonElement>(
      '[data-testid="mediaPlayer-playOnce"]',
    );
    expect(playOnce).not.toBeNull();
    expect(nextShown()).toBe(false);

    // The participant starts it with the fallback button.
    stubPlay(playing);
    await act(async () => {
      playOnce!.click();
      await Promise.resolve();
    });
    expect(nextShown()).toBe(true);
  });

  it("appears from a restored record that already started", () => {
    render(
      [player("example_nod"), next("self.mediaPlayer.example_nod.firstPlay")],
      {
        mediaPlayer_example_nod: {
          events: [{ type: "play", videoTime: 0, stageTimeElapsed: 2 }],
          firstPlay: { type: "play", videoTime: 0, stageTimeElapsed: 2 },
        },
      },
    );
    expect(nextShown()).toBe(true);
  });
});

describe("Next gated on reaching the end (#710)", () => {
  it("appears when playback reaches stopAt, not before", () => {
    render([
      player("clip", { stopAt: 5 }),
      next("self.mediaPlayer.clip.firstEnd"),
    ]);
    playPause("clip");
    moveTo("clip", 3);
    expect(nextShown()).toBe(false);
    moveTo("clip", 5.1);
    expect(nextShown()).toBe(true);
  });
});

function coverageNext(threshold: number) {
  return {
    type: "submitButton",
    name: "next",
    conditions: [
      {
        reference: "self.mediaPlayer.clip.watchedFraction",
        comparator: "isAtLeast",
        value: threshold,
      },
    ],
  };
}

describe("Next gated on distinct clip coverage (#719)", () => {
  it("aggregates pause/resume fragments and stays open through replay", () => {
    render([player("clip", { stopAt: 4 }), coverageNext(0.98)]);
    playPause("clip");
    moveTo("clip", 1.6);
    playPause("clip");
    moveTo("clip", 1.603);
    playPause("clip");
    moveTo("clip", 2);
    playPause("clip");
    expect(nextShown()).toBe(false);
    moveTo("clip", 2.003);
    playPause("clip");
    moveTo("clip", 4.01);
    expect(nextShown()).toBe(true);
    playPause("clip"); // replay cannot erase previously verified coverage
    expect(nextShown()).toBe(true);
    moveTo("clip", 1);
    playPause("clip");
    expect(nextShown()).toBe(true);
  });

  it("does not mistake first/last endpoints for coverage across a seek", () => {
    render([
      player("clip", { stopAt: 4, stepDuration: 2 }),
      coverageNext(0.98),
      { ...next("self.mediaPlayer.clip.firstEnd"), name: "ended" },
    ]);
    playPause("clip");
    moveTo("clip", 1);
    press("clip", "ArrowRight"); // skip 1–3
    moveTo("clip", 4.01);
    expect(shown("ended")).toBe(true);
    expect(nextShown()).toBe(false);
    playPause("clip");
    moveTo("clip", 3.1); // replay fills the previously skipped interval
    playPause("clip");
    expect(nextShown()).toBe(true);
  });

  it("uses the authored window, including nonzero start and out-of-window playback", () => {
    render([
      player("clip", {
        startAt: 10,
        stopAt: 14,
        stepDuration: 10,
        allowScrubOutsideBounds: true,
      }),
      coverageNext(0.98),
    ]);
    press("clip", "ArrowLeft"); // start playback at 0, outside the clip
    playPause("clip");
    moveTo("clip", 10);
    playPause("clip");
    expect(nextShown()).toBe(false);
    playPause("clip");
    moveTo("clip", 14.2);
    expect(nextShown()).toBe(true);
  });

  it("counts media seconds at a different speed and updates on existing saves", () => {
    render([player("clip", { stopAt: 4 }), coverageNext(0.75)]);
    press("clip", ">");
    expect(nextShown()).toBe(false);
    playPause("clip");
    moveTo("clip", 3);
    // This first slice saves on events, not periodic playback progress.
    expect(nextShown()).toBe(false);
    playPause("clip");
    expect(nextShown()).toBe(true);
  });

  it("does not expose a fraction when the media duration is unknown", () => {
    render([player("clip", { stopAt: 4 }), coverageNext(0.75)]);
    const video = within("clip").querySelector("video")!;
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => Infinity,
    });
    act(() => {
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    playPause("clip");
    moveTo("clip", 4.01);
    expect(nextShown()).toBe(false);
  });
});
