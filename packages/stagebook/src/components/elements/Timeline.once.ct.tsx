/** Real MediaPlayer + Timeline wiring with deterministic native/YouTube media. */
import {
  test,
  expect,
  type Page,
  type Locator,
} from "@playwright/experimental-ct-react";
import { MockWindowedTimeline } from "../testing/MockWindowedTimeline.js";
import AxeBuilder from "@axe-core/playwright";

type Backend = "native" | "youtube";
type MediaState = {
  time: number;
  paused: boolean;
  plays: number;
  pauses: number;
  seeks: number[];
  tick: (time: number) => void;
  end: () => void;
};
type TestWindow = Window & { __onceMedia: MediaState };

async function installMedia(page: Page, backend: Backend, blocked = false) {
  await page.evaluate(
    ({ backend, blocked }) => {
      const state: MediaState = {
        time: 2,
        paused: true,
        plays: 0,
        pauses: 0,
        seeks: [],
        tick() {},
        end() {},
      };
      (window as TestWindow).__onceMedia = state;
      if (backend === "native") {
        const proto = HTMLMediaElement.prototype;
        Object.defineProperties(proto, {
          currentTime: {
            configurable: true,
            get: () => state.time,
            set: (time: number) => {
              state.time = time;
              state.seeks.push(time);
            },
          },
          duration: { configurable: true, get: () => 10 },
          paused: { configurable: true, get: () => state.paused },
          play: {
            configurable: true,
            value(this: HTMLMediaElement) {
              state.plays++;
              if (blocked && state.plays === 1)
                return Promise.reject(
                  new DOMException("Blocked", "NotAllowedError"),
                );
              state.paused = false;
              this.dispatchEvent(new Event("play"));
              return Promise.resolve();
            },
          },
          pause: {
            configurable: true,
            value(this: HTMLMediaElement) {
              state.pauses++;
              if (state.paused) return;
              state.paused = true;
              this.dispatchEvent(new Event("pause"));
            },
          },
        });
        state.tick = (time) => {
          state.time = time;
          document
            .querySelector("video")!
            .dispatchEvent(new Event("timeupdate"));
        };
        state.end = () => {
          state.time = 10;
          state.paused = true;
          document.querySelector("video")!.dispatchEvent(new Event("ended"));
        };
      } else {
        type Events = {
          onReady: () => void;
          onStateChange: (e: { data: number }) => void;
          onAutoplayBlocked?: () => void;
        };
        Object.assign(window, {
          YT: {
            Player: function (_el: HTMLElement, opts: { events: Events }) {
              const emit = (data: number) =>
                opts.events.onStateChange({ data });
              state.tick = (time) => {
                state.time = time;
              };
              state.end = () => {
                state.time = 10;
                state.paused = true;
                emit(0);
              };
              setTimeout(() => opts.events.onReady(), 0);
              return {
                playVideo() {
                  state.plays++;
                  if (blocked && state.plays === 1) {
                    opts.events.onAutoplayBlocked?.();
                    return;
                  }
                  state.paused = false;
                  emit(1);
                },
                pauseVideo() {
                  state.pauses++;
                  state.paused = true;
                  emit(2);
                },
                seekTo(time: number) {
                  state.time = time;
                  state.seeks.push(time);
                },
                getCurrentTime: () => state.time,
                getDuration: () => 10,
                getPlayerState: () => (state.paused ? 2 : 1),
                destroy() {},
              };
            },
          },
        });
      }
    },
    { backend, blocked },
  );
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const { time, paused, plays, pauses, seeks } = (window as TestWindow)
      .__onceMedia;
    return { time, paused, plays, pauses, seeks };
  });
}
async function tick(page: Page, time: number) {
  await page.evaluate(
    (time) => (window as TestWindow).__onceMedia.tick(time),
    time,
  );
}
async function marks(component: Locator, name = "marks") {
  const log = JSON.parse(
    (await component.getByTestId("save-log").textContent()) ?? "[]",
  ) as Array<{ key: string; value: unknown }>;
  return (
    log.filter((entry) => entry.key === `timeline_${name}`).at(-1)?.value ?? []
  );
}
async function pointerSeek(timeline: Locator) {
  for (const testId of ["time-ruler", "playhead"]) {
    const el = timeline.getByTestId(testId);
    const box = await el.boundingBox();
    if (!box) throw new Error(`Missing ${testId}`);
    const init = {
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      button: 0,
      buttons: 1,
      pointerId: 1,
    };
    await el.dispatchEvent("pointerdown", init);
    await el.dispatchEvent("pointermove", {
      ...init,
      clientX: init.clientX + 80,
    });
    await el.dispatchEvent("pointerup", {
      ...init,
      clientX: init.clientX + 80,
      buttons: 0,
    });
  }
}

for (const backend of ["native", "youtube"] as const) {
  const url =
    backend === "native" ? "/sample-video.mp4" : "https://youtu.be/QC8iQqtG0hg";

  test(`${backend} once: two timelines cannot pause, seek, step or replay, and Enter still marks`, async ({
    mount,
    page,
  }) => {
    await installMedia(page, backend);
    const component = await mount(
      <MockWindowedTimeline
        url={url}
        playback="once"
        startAt={2}
        stopAt={6}
        selectionType="point"
        timelineCount={2}
      />,
    );
    await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
    await tick(page, 4);
    const baseline = await snapshot(page);
    for (let i = 0; i < 2; i++) {
      const timeline = component.getByTestId("timeline").nth(i);
      await timeline.focus();
      for (const key of ["Space", "ArrowLeft", "ArrowRight", ",", "."])
        await page.keyboard.press(key);
      await pointerSeek(timeline);
      expect(await snapshot(page)).toEqual(baseline);
      await timeline.focus();
      await page.keyboard.press("Enter");
      await expect(timeline).toBeFocused();
      await expect
        .poll(() => marks(component, i === 0 ? "marks" : "marks2"))
        .toEqual([{ time: 4 }]);
      // Annotation navigation/editing must not move or pause the source either.
      await page.keyboard.press("]");
      await page.keyboard.press("ArrowLeft");
      await expect
        .poll(() => marks(component, i === 0 ? "marks" : "marks2"))
        .toEqual([{ time: 3 }]);
      expect(await snapshot(page)).toEqual(baseline);
    }
    await tick(page, 6);
    await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
    const ended = await snapshot(page);
    for (const timeline of await component.getByTestId("timeline").all()) {
      await timeline.focus();
      await page.keyboard.press("Escape");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Space");
    }
    expect(await snapshot(page)).toEqual(ended);
  });

  test(`${backend} once: blocked autoplay has one fallback start and natural end cannot replay`, async ({
    mount,
    page,
  }) => {
    await installMedia(page, backend, true);
    const component = await mount(
      <MockWindowedTimeline
        url={url}
        playback="once"
        startAt={2}
        selectionType="point"
      />,
    );
    const fallback = component.getByTestId("mediaPlayer-playOnce");
    await expect(fallback).toBeVisible();
    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="mediaPlayer"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    const timeline = component.getByTestId("timeline");
    await timeline.focus();
    await page.keyboard.press("Space");
    expect((await snapshot(page)).plays).toBe(1);
    await fallback.click();
    await expect(fallback).not.toBeVisible();
    await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
    expect((await snapshot(page)).plays).toBe(2);
    await expect(timeline).toBeFocused();
    await tick(page, 5);
    await page.keyboard.press("Enter");
    await expect.poll(() => marks(component)).toEqual([{ time: 5 }]);
    await page.evaluate(() => (window as TestWindow).__onceMedia.end());
    const ended = await snapshot(page);
    await page.keyboard.press("Space");
    await pointerSeek(timeline);
    expect(await snapshot(page)).toEqual(ended);
    await expect(fallback).not.toBeVisible();
  });

  test(`${backend} manual: Timeline retains pause, seek and replay`, async ({
    mount,
    page,
  }) => {
    await installMedia(page, backend);
    const component = await mount(
      <MockWindowedTimeline
        url={url}
        playback="manual"
        startAt={2}
        stopAt={6}
        selectionType="point"
      />,
    );
    const timeline = component.getByTestId("timeline");
    await expect(timeline).toHaveAttribute("data-viewport-start", "2");
    await timeline.focus();
    await page.keyboard.press("Space");
    await expect.poll(async () => (await snapshot(page)).paused).toBe(false);
    await tick(page, 4);
    await page.keyboard.press("Space");
    expect((await snapshot(page)).paused).toBe(true);
    await page.keyboard.press("ArrowLeft");
    expect((await snapshot(page)).time).toBe(3);
    await page.keyboard.press("Space");
    await tick(page, 6);
    await expect.poll(async () => (await snapshot(page)).paused).toBe(true);
    await page.keyboard.press("Space");
    const replayed = await snapshot(page);
    expect(replayed.time).toBe(2);
    expect(replayed.paused).toBe(false);
  });
}
