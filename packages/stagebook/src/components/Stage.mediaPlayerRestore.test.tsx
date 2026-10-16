// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Stage } from "./Stage.js";
import {
  StagebookProvider,
  type StagebookContext,
} from "./StagebookProvider.js";
import type { VideoPlaybackRecord } from "../schemas/mediaPlayerRecord.js";

// Persist records outside React, as a host does across conditional removal or
// tree recreation. No fixture is a partial milestone-only record: restoration
// must check the source/window identity before accepting its event history.
type Elements = Record<string, unknown>[];
type Store = Record<string, unknown>;
let stores: Record<string, Store>;
let writes: { scope: string; key: string; value: unknown }[];
let container: HTMLDivElement;
let root: Root;
let stageTime: number;
let cdnVersion: number;
const source = "https://example.com/clip.mp4";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function completed(
  overrides: Partial<VideoPlaybackRecord> = {},
): VideoPlaybackRecord {
  const firstPlay = {
    type: "play" as const,
    videoTime: 2,
    stageTimeElapsed: 1,
  };
  const firstEnd = {
    type: "stopAt" as const,
    videoTime: 8,
    stageTimeElapsed: 7,
  };
  return {
    name: "clip",
    url: source,
    startAt: 2,
    stopAt: 8,
    events: [firstPlay, firstEnd],
    lastVideoTime: 8,
    watchedRanges: [[2, 8]],
    firstPlay,
    firstEnd,
    ...overrides,
  };
}

function player(extra: Record<string, unknown> = {}) {
  return {
    type: "mediaPlayer",
    name: "clip",
    file: source,
    startAt: 2,
    stopAt: 8,
    playback: "manual",
    controls: { playPause: true, seek: true, speed: true },
    ...extra,
  };
}

const next = {
  type: "submitButton",
  name: "next",
  conditions: [
    { reference: "self.mediaPlayer.clip.firstPlay", comparator: "exists" },
    { reference: "self.mediaPlayer.clip.firstEnd", comparator: "exists" },
  ],
};

function Host({
  elements,
  scope,
  generation,
  stableStage = false,
}: {
  elements: Elements;
  scope: string;
  generation: number;
  stableStage?: boolean;
}) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const ctx: StagebookContext = {
    get: (key) => (key in stores[scope] ? [stores[scope][key]] : []),
    save: (key, value) => {
      writes.push({ scope, key, value });
      stores[scope] = { ...stores[scope], [key]: value };
      redraw();
    },
    getElapsedTime: () => stageTime,
    submit: () => {},
    getAssetURL: (path) => `https://cdn.test/${path}?v=${cdnVersion}`,
    getTextContent: () => Promise.resolve(""),
    progressLabel: scope,
    playerId: "player1",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
  };
  return (
    <StagebookProvider value={ctx}>
      <Stage
        key={stableStage ? generation : `${scope}:${generation}`}
        stage={{ name: scope, elements }}
        onSubmit={() => {}}
      />
    </StagebookProvider>
  );
}

function render(
  elements: Elements = [player(), next],
  scope = "intro_0_instructions",
  generation = 0,
  { stableStage = false, strict = false } = {},
) {
  stores[scope] ??= {};
  act(() => {
    const host = <Host {...{ elements, scope, generation, stableStage }} />;
    root.render(strict ? <React.StrictMode>{host}</React.StrictMode> : host);
  });
}

function video() {
  const el = container.querySelector("video");
  if (!el) throw new Error("Expected a mounted video");
  return el;
}

function ready() {
  const el = video();
  Object.defineProperty(el, "duration", { configurable: true, get: () => 100 });
  Object.defineProperty(el, "seekable", {
    configurable: true,
    get: () => ({ length: 1, start: () => 0, end: () => 100 }),
  });
  act(() => {
    el.dispatchEvent(new Event("loadedmetadata"));
  });
}

function press(key: string) {
  const el = container.querySelector('[data-testid="mediaPlayer"]')!;
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function moveTo(time: number) {
  act(() => {
    video().currentTime = time;
    video().dispatchEvent(new Event("timeupdate"));
  });
}

const record = (scope = "intro_0_instructions") =>
  stores[scope].mediaPlayer_clip as VideoPlaybackRecord;
const nextShown = () =>
  container.querySelector('[data-testid="element-submitButton-next"]') !== null;

beforeEach(() => {
  stores = { intro_0_instructions: {} };
  writes = [];
  stageTime = 20;
  cdnVersion = 2;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", {
      configurable: true,
      get: () => false,
    });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    if (this.paused) return;
    Object.defineProperty(this, "paused", {
      configurable: true,
      get: () => true,
    });
    this.dispatchEvent(new Event("pause"));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("host playback record restoration (#728)", () => {
  it("keeps completed milestones and Next after the first post-reload seek, without a mount write", () => {
    const saved = completed();
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render();
    ready();
    expect(writes).toEqual([]);
    expect(video().currentTime).toBe(2); // History does not restore the playhead.
    expect(nextShown()).toBe(true);

    press("ArrowRight");
    expect(nextShown()).toBe(true);
    expect(record().firstPlay).toEqual(saved.firstPlay);
    expect(record().firstEnd).toEqual(saved.firstEnd);
    expect(record().watchedRanges).toEqual([[2, 8]]);
    expect(record().events.slice(0, 2)).toEqual(saved.events);
    expect(record().events.map((event) => event.type)).toEqual([
      "play",
      "stopAt",
      "restored",
      "seek",
    ]);

    // The save rerenders the host. It must not reseed the log or append a
    // second restoration marker when the next interaction arrives.
    press(">");
    expect(record().events.map((event) => event.type)).toEqual([
      "play",
      "stopAt",
      "restored",
      "seek",
      "speed",
    ]);
    expect(saved.events).toHaveLength(2);
  });

  it("retains earlier closed ranges when a conditional player hides and returns", () => {
    const elements = [
      player({
        conditions: [
          {
            reference: "self.attributes.visible",
            comparator: "equals",
            value: true,
          },
        ],
      }),
    ];
    stores.intro_0_instructions.attributes = { visible: true };
    render(elements);
    ready();
    press("k");
    moveTo(4);
    press("k");
    const before = record();
    expect(before.watchedRanges).toEqual([[2, 4]]);

    stores.intro_0_instructions.attributes = { visible: false };
    render(elements);
    expect(container.querySelector("video")).toBeNull();
    const writeCount = writes.length;
    stores.intro_0_instructions.attributes = { visible: true };
    render(elements);
    ready();
    expect(writes).toHaveLength(writeCount);
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowRight");
    press("k");
    moveTo(7);
    press("k");
    expect(record().watchedRanges).toEqual([
      [2, 4],
      [5, 7],
    ]);
    expect(record().firstPlay).toEqual(before.firstPlay);
    expect(record().events.slice(0, before.events.length)).toEqual(
      before.events,
    );
  });

  it("does not invent coverage from an unfinished saved play across reload", () => {
    const saved = completed({
      events: [
        { type: "play", videoTime: 2, stageTimeElapsed: 1 },
        { type: "pause", videoTime: 3, stageTimeElapsed: 2 },
        { type: "play", videoTime: 4, stageTimeElapsed: 3 },
      ],
      watchedRanges: [[2, 3]],
      lastVideoTime: 4,
      firstEnd: undefined,
    });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render();
    ready();
    expect(writes).toEqual([]);
    moveTo(6);
    press("ArrowRight");
    expect(record().watchedRanges).toEqual([[2, 3]]);
    expect(record().events.slice(0, 3)).toEqual(saved.events);
    expect(
      record()
        .events.slice(3)
        .map((event) => event.type),
    ).toEqual(["restored", "seek"]);
    press("k");
    moveTo(8);
    expect(record().watchedRanges).toEqual([
      [2, 3],
      [7, 8],
    ]);
  });

  it("does not close an old unfinished play merely by mounting and leaving again", () => {
    const saved = completed({
      events: [{ type: "play", videoTime: 2, stageTimeElapsed: 1 }],
      watchedRanges: [],
      lastVideoTime: 2,
      firstEnd: undefined,
    });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render();
    ready();
    moveTo(6);
    render([]);
    expect(writes).toEqual([]);
    expect(record()).toBe(saved);
  });

  it.each([
    ["name", { name: "another" }],
    ["URL", { url: "https://example.com/other.mp4" }],
    ["start", { startAt: 1 }],
    ["stop", { stopAt: 9 }],
    ["authored source", { sourceId: "different.mp4" }],
    [
      "malformed events",
      { events: [{ type: "seek", videoTime: 2, stageTimeElapsed: 1 }] },
    ],
  ])("does not import a record with a mismatched %s", (_label, overrides) => {
    stores.intro_0_instructions.mediaPlayer_clip = {
      ...completed(),
      ...overrides,
    };
    render();
    ready();
    expect(writes).toEqual([]);
    press("ArrowRight");
    expect(record().events.map((event) => event.type)).toEqual(["seek"]);
    expect(record().watchedRanges).toEqual([]);
    expect(record().firstPlay).toBeUndefined();
    expect(record().firstEnd).toBeUndefined();
  });

  it("reads only the current task's host store when the same player name is reused", () => {
    const saved = completed();
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render();
    ready();
    render([player(), next], "game_1_new_task");
    ready();
    expect(nextShown()).toBe(false);
    press("ArrowRight");
    expect(record("game_1_new_task").events.map((event) => event.type)).toEqual(
      ["seek"],
    );
    expect(record()).toBe(saved);
    expect(writes.every((write) => write.scope === "game_1_new_task")).toBe(
      true,
    );
  });

  it("isolates history when the host changes tasks without remounting Stage", () => {
    const elements = [player(), next];
    render(elements, "intro_0_instructions", 0, { stableStage: true });
    ready();
    press("k");
    moveTo(4);
    press("k");
    const saved = record();
    const previousVideo = video();
    expect(saved.watchedRanges).toEqual([[2, 4]]);

    render(elements, "game_1_new_task", 0, { stableStage: true });
    ready();
    expect(video()).not.toBe(previousVideo);
    expect(video().currentTime).toBe(2);
    press("ArrowRight");
    expect(record("game_1_new_task").events.map((event) => event.type)).toEqual(
      ["seek"],
    );
    expect(record("game_1_new_task").watchedRanges).toEqual([]);
    expect(record("game_1_new_task").firstPlay).toBeUndefined();
    expect(record()).toBe(saved);
  });

  it("does not save a restored open log during StrictMode effect replay", () => {
    const saved = completed({
      events: [{ type: "play", videoTime: 2, stageTimeElapsed: 1 }],
      watchedRanges: [],
      lastVideoTime: 2,
      firstEnd: undefined,
    });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render([player(), next], "intro_0_instructions", 0, { strict: true });
    ready();
    expect(writes).toEqual([]);
    expect(record()).toBe(saved);
    press("ArrowRight");
    expect(record().events.map((event) => event.type)).toEqual([
      "play",
      "restored",
      "seek",
    ]);
    expect(record().watchedRanges).toEqual([]);
  });

  it("keeps the authored source history when its resolved CDN URL changes", () => {
    const saved = completed({
      url: "https://cdn.test/clip.mp4?v=1",
      sourceId: "clip.mp4",
    });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render([player({ file: "clip.mp4" }), next]);
    ready();
    expect(video().src).toBe("https://cdn.test/clip.mp4?v=2");
    expect(writes).toEqual([]);
    press("ArrowRight");
    expect(record().firstEnd).toEqual(saved.firstEnd);
    expect(record().watchedRanges).toEqual([[2, 8]]);
    expect(record().sourceId).toBe("clip.mp4");
    expect(record().url).toBe("https://cdn.test/clip.mp4?v=2");
    expect(nextShown()).toBe(true);
  });

  it("starts a fresh interval when a CDN URL reloads the mounted media source", () => {
    const elements = [player({ file: "clip.mp4", startAt: 0, stopAt: 30 })];
    cdnVersion = 1;
    render(elements);
    ready();
    moveTo(10);
    press("k");
    moveTo(12);
    press("k");
    moveTo(20);
    press("k");
    const before = record();
    expect(before.watchedRanges).toEqual([[10, 12]]);
    expect(before.events.at(-1)).toMatchObject({ type: "play", videoTime: 20 });
    const mountedVideo = video();
    const writesBeforeReload = writes.length;

    cdnVersion = 2;
    render(elements);
    expect(video()).toBe(mountedVideo);
    expect(video().src).toBe("https://cdn.test/clip.mp4?v=2");
    // jsdom does not implement the HTML media resource-selection algorithm.
    // A real source replacement resets its backend to paused at the start.
    Object.defineProperty(video(), "paused", {
      configurable: true,
      get: () => true,
    });
    moveTo(0);
    ready();
    expect(writes).toHaveLength(writesBeforeReload);
    press("k");
    moveTo(5);
    press("k");
    expect(record().events.slice(0, before.events.length)).toEqual(
      before.events,
    );
    expect(record().watchedRanges).toEqual([
      [0, 5],
      [10, 12],
    ]);
    expect(record().watchedSeconds).toBe(7);
    expect(
      record()
        .events.slice(before.events.length)
        .map((event) => event.type),
    ).toEqual(["restored", "play", "pause"]);
    expect(record().firstPlay).toEqual(before.firstPlay);
  });

  it("allows a fresh once viewing after remount while preserving the earlier completion", async () => {
    const saved = completed();
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render([player({ playback: "once", autoplay: false }), next]);
    ready();
    expect(writes).toEqual([]);
    expect(video().currentTime).toBe(2);
    const playOnce = container.querySelector<HTMLButtonElement>(
      '[data-testid="mediaPlayer-playOnce"]',
    );
    expect(playOnce).not.toBeNull();
    await act(async () => {
      playOnce!.click();
      await Promise.resolve();
    });
    expect(video().paused).toBe(false);
    expect(record().firstEnd).toEqual(saved.firstEnd);
    expect(nextShown()).toBe(true);
  });
});

describe("YouTube host playback record restoration", () => {
  let time: number;
  let state: number;
  let change: (nextState: number) => void;

  beforeEach(() => {
    time = 0;
    state = 2;
    (window as unknown as { YT: unknown }).YT = {
      Player: function (
        _el: unknown,
        opts: {
          playerVars: { start?: number };
          events: {
            onReady: () => void;
            onStateChange: (event: { data: number }) => void;
          };
        },
      ) {
        time = opts.playerVars.start ?? 0;
        change = (nextState: number) => {
          state = nextState;
          opts.events.onStateChange({ data: state });
        };
        queueMicrotask(() => opts.events.onReady());
        return {
          playVideo: () => change(1),
          pauseVideo: () => change(2),
          seekTo: (nextTime: number) => {
            time = nextTime;
          },
          getCurrentTime: () => time,
          getDuration: () => 100,
          getPlayerState: () => state,
          destroy: () => {},
        };
      },
    };
  });

  afterEach(() => {
    delete (window as unknown as { YT?: unknown }).YT;
  });

  it("ignores an initial PAUSED report for an old open log and counts only fresh playback", async () => {
    const url = "https://youtu.be/QC8iQqtG0hg";
    const saved = completed({
      url,
      events: [
        { type: "play", videoTime: 2, stageTimeElapsed: 1 },
        { type: "pause", videoTime: 3, stageTimeElapsed: 2 },
        { type: "play", videoTime: 4, stageTimeElapsed: 3 },
      ],
      watchedRanges: [[2, 3]],
      lastVideoTime: 4,
      firstEnd: undefined,
    });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render([player({ file: url }), next]);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      time = 6;
      change(2);
    });
    expect(writes).toEqual([]);
    expect(record()).toBe(saved);

    act(() => {
      time = 5;
      change(1);
    });
    act(() => {
      time = 6;
      change(2);
    });
    expect(record().events.slice(0, 3)).toEqual(saved.events);
    expect(
      record()
        .events.slice(3)
        .map((event) => event.type),
    ).toEqual(["restored", "play", "pause"]);
    expect(record().firstPlay).toEqual(saved.firstPlay);
    expect(record().watchedRanges).toEqual([
      [2, 3],
      [5, 6],
    ]);
    press("ArrowRight");
    expect(record().watchedRanges).toEqual([
      [2, 3],
      [5, 6],
    ]);
    expect(
      record().events.filter((event) => event.type === "restored"),
    ).toHaveLength(1);
  });

  it("retains the saved milestones and ranges after its first new seek", async () => {
    const url = "https://youtu.be/QC8iQqtG0hg";
    const saved = completed({ url });
    stores.intro_0_instructions.mediaPlayer_clip = saved;
    render([player({ file: url }), next]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(time).toBe(2);
    expect(writes).toEqual([]);
    expect(nextShown()).toBe(true);
    press("ArrowRight");
    expect(time).toBe(3);
    expect(record().firstPlay).toEqual(saved.firstPlay);
    expect(record().firstEnd).toEqual(saved.firstEnd);
    expect(record().watchedRanges).toEqual([[2, 8]]);
    expect(record().events.map((event) => event.type)).toEqual([
      "play",
      "stopAt",
      "restored",
      "seek",
    ]);
    expect(nextShown()).toBe(true);
  });

  it.each([
    { label: "startAt", extra: { startAt: 0 }, newStart: 0 },
    {
      label: "native controls",
      extra: { controls: { playPause: false, seek: false, speed: false } },
      newStart: 2,
    },
  ])(
    "starts a new log segment when changing $label recreates the backend",
    async ({ extra, newStart }) => {
      const url = "https://youtu.be/QC8iQqtG0hg";
      render([player({ file: url })]);
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        time = 6;
        change(1);
      });
      act(() => {
        time = 7;
        change(2);
      });
      act(() => {
        time = 4;
        change(1);
      });
      const before = record();
      const playerNode = container.querySelector('[data-testid="mediaPlayer"]');
      expect(before.watchedRanges).toEqual([[6, 7]]);
      const writeCount = writes.length;

      render([player({ file: url, ...extra })]);
      await act(async () => {
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="mediaPlayer"]')).toBe(
        playerNode,
      );
      expect(time).toBe(newStart);
      expect(writes).toHaveLength(writeCount);
      act(() => {
        change(1);
      });
      act(() => {
        time = newStart + 1;
        change(2);
      });
      expect(record().watchedRanges).toEqual([
        [newStart, newStart + 1],
        [6, 7],
      ]);
      expect(record().watchedSeconds).toBe(2);
      expect(record().events.slice(0, before.events.length)).toEqual(
        before.events,
      );
      expect(
        record()
          .events.slice(before.events.length)
          .map((event) => event.type),
      ).toEqual(["restored", "play", "pause"]);
      expect(record().firstPlay).toEqual(before.firstPlay);
    },
  );
});
