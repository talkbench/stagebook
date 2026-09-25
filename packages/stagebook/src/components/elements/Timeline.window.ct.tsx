/**
 * A Timeline attached to a MediaPlayer with a startAt/stopAt window (#675).
 *
 * These mount the real MediaPlayer (not MockTimeline's hand-built handle), so
 * the Timeline sees exactly the PlaybackHandle a study would give it. The
 * fixture is 10 s long; the player shows the [4, 6] window with the default
 * `allowScrubOutsideBounds: false`. The track then spans the window, and every
 * time — playhead, marks, ruler labels — stays in media seconds.
 */
import { test, expect, type Locator } from "@playwright/experimental-ct-react";
import { MockWindowedTimeline } from "../testing/MockWindowedTimeline.js";
import { MockTimeline } from "../testing/MockTimeline.js";

const URL = "/sample-video.mp4";
const START_AT = 4;
const STOP_AT = 6;

function windowed(
  selectionType: "point" | "range",
  allowScrubOutsideBounds?: boolean,
) {
  return (
    <MockWindowedTimeline
      url={URL}
      startAt={START_AT}
      stopAt={STOP_AT}
      allowScrubOutsideBounds={allowScrubOutsideBounds}
      selectionType={selectionType}
    />
  );
}

async function whenReady(component: Locator) {
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  // Metadata loaded, the startAt seek applied, and the Timeline laid out.
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeCloseTo(START_AT, 1);
  const overlay = component.locator('[data-testid="selection-overlay"]');
  await expect
    .poll(async () => (await overlay.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);
  const timeline = component.locator('[data-testid="timeline"]');
  return { video, overlay, timeline };
}

function videoTime(video: Locator): Promise<number> {
  return video.evaluate((el: HTMLVideoElement) => el.currentTime);
}

/** The Timeline's last save, or [] before its first. */
async function savedMarks(component: Locator): Promise<unknown[]> {
  const text = await component
    .locator('[data-testid="save-log"]')
    .textContent();
  const log = JSON.parse(text ?? "[]") as Array<{
    key: string;
    value: unknown;
  }>;
  const last = log.filter((s) => s.key === "timeline_marks").pop();
  return (last?.value ?? []) as unknown[];
}

type Box = { x: number; y: number; width: number; height: number };

function pointerAt(box: Box, fraction: number) {
  return {
    clientX: box.x + box.width * fraction,
    clientY: box.y + box.height * 0.5,
    button: 0,
    buttons: 1,
    pointerId: 1,
    isPrimary: true,
  };
}

async function clickTrack(overlay: Locator, fraction: number) {
  const box = await overlay.boundingBox();
  if (!box) throw new Error("overlay not found");
  await overlay.dispatchEvent("pointerdown", pointerAt(box, fraction));
  await overlay.dispatchEvent("pointerup", pointerAt(box, fraction));
}

async function dragTrack(overlay: Locator, from: number, to: number) {
  const box = await overlay.boundingBox();
  if (!box) throw new Error("overlay not found");
  await overlay.dispatchEvent("pointerdown", pointerAt(box, from));
  await overlay.dispatchEvent("pointermove", pointerAt(box, to));
  await overlay.dispatchEvent("pointerup", pointerAt(box, to));
}

async function clickRuler(component: Locator, fraction: number) {
  const page = component.page();
  const ruler = component.locator('[data-testid="time-ruler"]');
  const box = await ruler.boundingBox();
  if (!box) throw new Error("ruler not found");
  // Explicit move/down/up — see the ruler-click test in Timeline.ct.tsx
  // (#416) for why webkit needs the full pointer sequence.
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

// -- Domain --

test("the track spans the window: startAt at the left edge, media-time ruler", async ({
  mount,
}) => {
  const component = await mount(windowed("point"));
  const { timeline } = await whenReady(component);
  const playhead = component.locator('[data-testid="playhead"]');
  await expect
    .poll(() =>
      playhead.evaluate((el: HTMLElement) => parseFloat(el.style.left)),
    )
    .toBeLessThan(2);
  await expect(timeline).toHaveAttribute("data-viewport-start", "4");
  const ruler = component.locator('[data-testid="time-ruler"]');
  await expect(ruler).toContainText("0:04");
  await expect(ruler).toContainText("0:06");
  await expect(ruler).not.toContainText("0:00");
});

test("with allowScrubOutsideBounds the track spans the whole file", async ({
  mount,
}) => {
  const component = await mount(windowed("point", true));
  const { overlay } = await whenReady(component);
  const playhead = component.locator('[data-testid="playhead"]');
  const width = (await overlay.boundingBox())?.width ?? 0;
  // startAt = 4 of 10 s → 40% across.
  await expect
    .poll(() =>
      playhead.evaluate((el: HTMLElement) => parseFloat(el.style.left)),
    )
    .toBeCloseTo(width * 0.4, -1);
});

test("zooming stays inside the window and zooming out returns to it", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { timeline } = await whenReady(component);
  const viewportStart = async () =>
    Number(await timeline.getAttribute("data-viewport-start"));
  await page.getByTestId("timeline-zoom-in").click();
  await expect(timeline).toHaveAttribute("data-zoom-level", "2");
  // 1 s of the 2 s window is visible, so the start stays within [4, 5].
  expect(await viewportStart()).toBeGreaterThanOrEqual(START_AT);
  expect(await viewportStart()).toBeLessThanOrEqual(STOP_AT - 1);
  await page.getByTestId("timeline-zoom-out").click();
  await expect(timeline).toHaveAttribute("data-viewport-start", "4");
});

// -- Seeks the Timeline issues --

test("clicking the ruler seeks in media time within the window", async ({
  mount,
}) => {
  const component = await mount(windowed("point"));
  const { video, overlay } = await whenReady(component);
  await clickRuler(component, 0.25);
  // 25% of [4, 6] = 4.5 s.
  await expect.poll(() => videoTime(video)).toBeCloseTo(4.5, 1);
  // And the playhead is drawn a quarter of the way along the track.
  const width = (await overlay.boundingBox())?.width ?? 0;
  await expect
    .poll(() =>
      component
        .locator('[data-testid="playhead"]')
        .evaluate((el: HTMLElement) => parseFloat(el.style.left)),
    )
    .toBeCloseTo(width * 0.25, -1);
});

test("arrow keys with no selection stop at the window edges", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { video, timeline } = await whenReady(component);
  await timeline.focus();
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => videoTime(video)).toBeCloseTo(START_AT, 2);
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => videoTime(video)).toBeCloseTo(STOP_AT, 2);
});

// -- Marks --

test("Enter after ArrowLeft saves the point at startAt", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { timeline } = await whenReady(component);
  await timeline.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect.poll(() => savedMarks(component)).toEqual([{ time: 4 }]);
});

test("clicking the track saves the point in media time", async ({ mount }) => {
  const component = await mount(windowed("point"));
  const { overlay } = await whenReady(component);
  await clickTrack(overlay, 0.1);
  // 10% of [4, 6] = 4.2 s — media time, not 0.2 s into the window.
  await expect
    .poll(async () => {
      const [mark] = (await savedMarks(component)) as { time: number }[];
      return mark?.time ?? null;
    })
    .toBeCloseTo(4.2, 1);
  // Drawn where it was clicked (the marker is 10 px wide, centered).
  const width = (await overlay.boundingBox())?.width ?? 0;
  const left = await component
    .locator('[data-testid="point-0"]')
    .evaluate((el: HTMLElement) => parseFloat(el.style.left) + 5);
  expect(left).toBeCloseTo(width * 0.1, -1);
});

test("dragging on the track saves the range in media time", async ({
  mount,
}) => {
  const component = await mount(windowed("range"));
  const { overlay } = await whenReady(component);
  await dragTrack(overlay, 0.1, 0.3);
  await expect
    .poll(async () => {
      const [mark] = (await savedMarks(component)) as {
        start: number;
        end: number;
      }[];
      return mark ? [mark.start, mark.end].map((t) => t.toFixed(1)) : null;
    })
    .toEqual(["4.2", "4.6"]);
});

test("the arrow keys can't move a selected point out of the window", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { overlay, video } = await whenReady(component);
  // A click-created point stays selected, so ← moves it.
  await clickTrack(overlay, 0.05);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(() => savedMarks(component)).toEqual([{ time: 4 }]);
  // The player follows the point to the frame it marks — also in bounds.
  await expect.poll(() => videoTime(video)).toBeCloseTo(START_AT, 2);
});

test("the repro from #675: click the track near the start, then press Enter", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { overlay } = await whenReady(component);
  await clickTrack(overlay, 0.05);
  await page.keyboard.press("Enter");
  await expect
    .poll(async () => {
      const marks = (await savedMarks(component)) as { time: number }[];
      return marks.map((m) => m.time.toFixed(1));
    })
    .toEqual(["4.0", "4.1"]);
});

test("Space on the timeline at the window end replays the clip (#684)", async ({
  mount,
  page,
}) => {
  const component = await mount(windowed("point"));
  const { video, timeline } = await whenReady(component);
  await timeline.focus();
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(() => videoTime(video)).toBeCloseTo(STOP_AT, 2);
  // The Timeline plays through the player's handle, which replays at the end.
  await page.keyboard.press(" ");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(false);
  // The player logged the jump back to startAt.
  const playerEvents = async () => {
    const text = await component
      .locator('[data-testid="save-log"]')
      .textContent();
    const log = JSON.parse(text ?? "[]") as Array<{
      key: string;
      value: { events?: Array<{ type: string; videoTime: number }> };
    }>;
    return (
      log.filter((s) => s.key === "mediaPlayer_clip").pop()?.value.events ?? []
    );
  };
  await expect
    .poll(async () => (await playerEvents()).map((e) => e.type))
    .toContain("play");
  expect(await playerEvents()).toContainEqual(
    expect.objectContaining({
      type: "seek",
      videoTime: START_AT,
      fromTime: STOP_AT,
    }),
  );
});

// -- YouTube --

test("a YouTube source bounds the timeline the same way", async ({
  mount,
  page,
}) => {
  // Stub only the IFrame API. Seeks move the stub's clock so the Timeline's
  // RAF loop and Enter read the position the handle actually sought to.
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__ytTime = 20;
    w.__ytSeeks = [] as number[];
    w.YT = {
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
      Player: function (
        _el: unknown,
        opts: { events?: { onReady?: () => void } },
      ) {
        queueMicrotask(() => opts.events?.onReady?.());
        return {
          playVideo() {},
          pauseVideo() {},
          seekTo(t: number) {
            (w.__ytSeeks as number[]).push(t);
            w.__ytTime = t;
          },
          getCurrentTime: () => w.__ytTime,
          getDuration: () => 60,
          getPlayerState: () => 2,
          destroy() {},
        };
      },
    };
  });
  const component = await mount(
    <MockWindowedTimeline
      url="https://youtu.be/QC8iQqtG0hg"
      startAt={20}
      stopAt={30}
      selectionType="point"
    />,
  );
  const timeline = component.locator('[data-testid="timeline"]');
  await expect(timeline).toHaveAttribute("data-viewport-start", "20");
  await timeline.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  expect(
    await page.evaluate(
      () => (window as unknown as { __ytSeeks: number[] }).__ytSeeks,
    ),
  ).toEqual([20]);
  await expect.poll(() => savedMarks(component)).toEqual([{ time: 20 }]);
});

// -- A mock player's window: deterministic time, restored marks, minimap --

// The same [4, 6] window of a 10 s file, reported by MockTimeline's handle.
const mockWindow = {
  source: "player",
  playerName: "player",
  name: "marks",
  mockDuration: 10,
  mockBounds: { start: START_AT, end: STOP_AT },
  mockCurrentTime: START_AT,
};

async function readSaves(component: Locator): Promise<unknown[]> {
  const text = await component
    .locator('[data-testid="save-log"]')
    .textContent();
  const log = JSON.parse(text ?? "[]") as Array<{ value: unknown }>;
  return (log.at(-1)?.value ?? []) as unknown[];
}

test("the minimap maps the window across its width", async ({ mount }) => {
  const component = await mount(
    <MockTimeline
      {...mockWindow}
      selectionType="point"
      multiSelect={true}
      initialSelections={[{ time: 1 }, { time: 5 }]}
    />,
  );
  const timeline = component.locator('[data-testid="timeline"]');
  await component.locator('[data-testid="timeline-zoom-in"]').click();
  await expect(timeline).toHaveAttribute("data-zoom-level", "2");
  const minimap = component.locator('[data-testid="timeline-minimap"]');
  const box = await minimap.boundingBox();
  if (!box) throw new Error("minimap not found");

  // Zoom 2 shows half the window, so the viewport rect is half the minimap.
  const rect = await component
    .locator('[data-testid="minimap-viewport"]')
    .boundingBox();
  expect(rect?.width ?? 0).toBeCloseTo(box.width / 2, -1);
  // The playhead at startAt sits at the minimap's left edge.
  const playheadLeft = await component
    .locator('[data-testid="minimap-playhead"]')
    .evaluate((el: HTMLElement) => parseFloat(el.style.left));
  expect(playheadLeft).toBeLessThan(2);
  // The restored mark at 1 s lies outside the window and isn't drawn.
  await expect(component.locator('[data-testid="minimap-mark"]')).toHaveCount(
    1,
  );

  // Clicking 75% across centers the viewport on 5.5 s, clamped to 5.
  await minimap.dispatchEvent("pointerdown", {
    ...pointerAt(box, 0.75),
    buttons: 1,
  });
  await minimap.dispatchEvent("pointerup", pointerAt(box, 0.75));
  await expect(timeline).toHaveAttribute("data-viewport-start", "5");
});

test("a restored mark outside the window is kept, and a keyboard edit clamps it in", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockTimeline
      {...mockWindow}
      selectionType="point"
      multiSelect={true}
      initialSelections={[{ time: 1 }, { time: 5 }]}
    />,
  );
  const timeline = component.locator('[data-testid="timeline"]');
  await timeline.focus();
  // Adding a mark saves the out-of-window one untouched.
  await page.keyboard.press("Enter");
  await expect
    .poll(() => readSaves(component))
    .toEqual([{ time: 1 }, { time: 4 }, { time: 5 }]);
  // `]` still reaches it; moving it clamps the edited time into the window.
  await page.keyboard.press("]");
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => readSaves(component))
    .toEqual([{ time: 4 }, { time: 4 }, { time: 5 }]);
});

test("a click-created range near the window end is shifted back inside", async ({
  mount,
}) => {
  const component = await mount(
    <MockTimeline {...mockWindow} selectionType="range" multiSelect={true} />,
  );
  await clickTrack(component.locator('[data-testid="selection-overlay"]'), 0.9);
  // A 1 s range from 5.8 s would end at 6.8; it moves back to [5, 6].
  await expect.poll(() => readSaves(component)).toEqual([{ start: 5, end: 6 }]);
});

test("a drag past either edge of the track stops at the window", async ({
  mount,
}) => {
  const component = await mount(
    <MockTimeline {...mockWindow} selectionType="range" multiSelect={true} />,
  );
  const overlay = component.locator('[data-testid="selection-overlay"]');
  await dragTrack(overlay, 0.5, 1.3);
  await expect.poll(() => readSaves(component)).toEqual([{ start: 5, end: 6 }]);
  await dragTrack(overlay, 0.25, -0.3);
  await expect
    .poll(() => readSaves(component))
    .toEqual([
      { start: 4, end: 4.5 },
      { start: 5, end: 6 },
    ]);
});

test("a tap-length Enter range at stopAt widens backwards, inside the window", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockTimeline
      {...mockWindow}
      mockCurrentTime={STOP_AT}
      selectionType="range"
      multiSelect={true}
    />,
  );
  await component.locator('[data-testid="timeline"]').focus();
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  await expect.poll(async () => (await readSaves(component)).length).toBe(1);
  const [range] = (await readSaves(component)) as {
    start: number;
    end: number;
  }[];
  expect(range.end).toBe(STOP_AT);
  expect(range.start).toBeGreaterThanOrEqual(START_AT);
  expect(range.start).toBeLessThan(STOP_AT);
});

test("pinch-zoom anchors on the media time under the cursor", async ({
  mount,
}) => {
  const component = await mount(
    <MockTimeline {...mockWindow} selectionType="point" />,
  );
  const timeline = component.locator('[data-testid="timeline"]');
  const overlay = component.locator('[data-testid="selection-overlay"]');
  // Wait for layout: a zero-width overlay would aim the pinch at its edge.
  await expect
    .poll(async () => (await overlay.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);
  const box = await overlay.boundingBox();
  if (!box) throw new Error("overlay not found");
  // ctrl+wheel is a trackpad pinch. Zoom e^1 about 5 s (the track's middle):
  // visible 2 / e ≈ 0.736 s, so the viewport starts at 5 - 0.368 ≈ 4.63 s.
  await timeline.dispatchEvent("wheel", {
    ctrlKey: true,
    deltaX: 0,
    deltaY: -100,
    deltaMode: 0,
    clientX: box.x + box.width * 0.5,
    clientY: box.y + box.height * 0.5,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () =>
      Number(await timeline.getAttribute("data-viewport-start")),
    )
    .toBeCloseTo(4.63, 1);
});

test("zooming in centers on the playhead, not a phantom seek from 0", async ({
  mount,
}) => {
  const component = await mount(
    <MockTimeline {...mockWindow} mockCurrentTime={5} selectionType="point" />,
  );
  const timeline = component.locator('[data-testid="timeline"]');
  await component.locator('[data-testid="timeline-zoom-in"]').click();
  // 1 s visible, centered on 5 s. (Treating the playhead's start at
  // startAt as a seek from 0 would snap it to 25%: 4.75.)
  await expect(timeline).toHaveAttribute("data-viewport-start", "4.5");
});
