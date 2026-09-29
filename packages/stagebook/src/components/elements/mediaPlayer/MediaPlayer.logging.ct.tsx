/**
 * The MediaPlayer's event log: seeks from any source (#682), the range left
 * open when the stage ends mid-playback (#677), and keyboard speed changes
 * (#676).
 *
 * The <video> is mocked so tests control time exactly. Like a browser, the
 * mock flips `paused` at once and fires "play"/"pause" in a later task —
 * the ordering that let a scrub's pause read the scrub's target time.
 */
import { test, expect, type Locator } from "@playwright/experimental-ct-react";
import { MockLoggedPlayer } from "../../testing/MockLoggedPlayer.js";

const URL = "/sample-video.mp4";

interface LoggedEvent {
  type: string;
  videoTime: number;
  fromTime?: number;
  playbackRate?: number;
}

interface LoggedRecord {
  events: LoggedEvent[];
  lastVideoTime: number;
  watchedRanges: [number, number][];
}

async function mockVideo(component: Locator, duration = 100) {
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el, d) => {
    let ct = 0;
    let paused = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = el as any;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (s: number) => {
        ct = s;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => d,
      configurable: true,
    });
    Object.defineProperty(el, "paused", {
      get: () => paused,
      configurable: true,
    });
    v.pause = () => {
      if (paused) return;
      paused = true;
      setTimeout(() => el.dispatchEvent(new Event("pause")), 0);
    };
    v.play = () => {
      if (paused) {
        paused = false;
        setTimeout(() => el.dispatchEvent(new Event("play")), 0);
      }
      return Promise.resolve();
    };
    el.dispatchEvent(new Event("loadedmetadata"));
  }, duration);
  return video;
}

/** Move the mocked playhead, as playback (or anything unlogged) would. */
function setTime(video: Locator, t: number) {
  return video.evaluate((el: HTMLVideoElement, s) => {
    el.currentTime = s;
  }, t);
}

function getTime(video: Locator) {
  return video.evaluate((el: HTMLVideoElement) => el.currentTime);
}

async function playerSaves(component: Locator): Promise<LoggedRecord[]> {
  const text = await component
    .locator('[data-testid="save-log"]')
    .textContent();
  const log = JSON.parse(text ?? "[]") as Array<{
    key: string;
    value: LoggedRecord;
  }>;
  return log.filter((s) => s.key === "mediaPlayer_clip").map((s) => s.value);
}

async function lastRecord(component: Locator): Promise<LoggedRecord | null> {
  return (await playerSaves(component)).at(-1) ?? null;
}

async function lastEventType(component: Locator) {
  return (await lastRecord(component))?.events.at(-1)?.type;
}

async function play(component: Locator, video: Locator) {
  await video.evaluate((el: HTMLVideoElement) => void el.play());
  await expect.poll(() => lastEventType(component)).toBe("play");
}

async function pause(component: Locator, video: Locator) {
  await video.evaluate((el: HTMLVideoElement) => el.pause());
  await expect.poll(() => lastEventType(component)).toBe("pause");
}

async function rulerReady(component: Locator) {
  const ruler = component.locator('[data-testid="time-ruler"]');
  await expect
    .poll(async () => (await ruler.boundingBox())?.width ?? 0)
    .toBeGreaterThan(0);
  return ruler;
}

async function clickRuler(component: Locator, fraction: number) {
  const ruler = await rulerReady(component);
  const box = await ruler.boundingBox();
  if (!box) throw new Error("ruler not found");
  const page = component.page();
  // Explicit move/down/up: webkit needs the full pointer sequence (#416).
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

// -- Seeks from a Timeline (#682) --

test("a Timeline seek during playback ends the watched range and logs the seek", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} withTimeline />);
  const video = await mockVideo(component);
  await rulerReady(component);

  await setTime(video, 10);
  await play(component, video);
  await setTime(video, 20);
  await clickRuler(component, 0.8); // forward, past unwatched footage
  const landed = await getTime(video);
  expect(landed).toBeGreaterThan(60);
  await setTime(video, landed + 5);
  await pause(component, video);

  const record = await lastRecord(component);
  expect(record?.events).toEqual([
    expect.objectContaining({ type: "play", videoTime: 10 }),
    expect.objectContaining({ type: "seek", fromTime: 20, videoTime: landed }),
    expect.objectContaining({ type: "pause", videoTime: landed + 5 }),
  ]);
  expect(record?.watchedRanges).toEqual([
    [10, 20],
    [landed, landed + 5],
  ]);
});

test("a backward Timeline seek during playback leaves only forward ranges", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} withTimeline />);
  const video = await mockVideo(component);
  await rulerReady(component);

  await setTime(video, 50);
  await play(component, video);
  await setTime(video, 60);
  await clickRuler(component, 0.2);
  const landed = await getTime(video);
  expect(landed).toBeLessThan(40);
  await setTime(video, landed + 2);
  await pause(component, video);

  const record = await lastRecord(component);
  expect(record?.events.find((e) => e.type === "seek")).toMatchObject({
    fromTime: 60,
    videoTime: landed,
  });
  expect(record?.watchedRanges).toEqual([
    [landed, landed + 2],
    [50, 60],
  ]);
});

test("dragging the Timeline's ruler logs one seek, not one per move", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} withTimeline />);
  const video = await mockVideo(component);
  const ruler = await rulerReady(component);
  const box = await ruler.boundingBox();
  if (!box) throw new Error("ruler not found");
  const page = component.page();
  const y = box.y + box.height / 2;

  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  for (const f of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]) {
    await page.mouse.move(box.x + box.width * f, y);
  }
  await page.mouse.up();
  const landed = await getTime(video);
  expect(landed).toBeGreaterThan(60);

  await expect.poll(() => lastEventType(component)).toBe("seek");
  // Let any straggling per-move save arrive before counting.
  await page.waitForTimeout(700);
  const saves = await playerSaves(component);
  expect(saves).toHaveLength(1);
  expect(saves[0].events).toEqual([
    expect.objectContaining({ type: "seek", fromTime: 0, videoTime: landed }),
  ]);
});

// -- The player's own scrub bar (#682) --

test("scrubbing during playback doesn't count the skipped footage as watched", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} />);
  const video = await mockVideo(component);

  await setTime(video, 10);
  await play(component, video);
  await setTime(video, 20);

  // Hover keeps the controls up during playback.
  await component.locator('[data-testid="mediaPlayer"]').hover();
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  const box = await scrub.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  const at = {
    clientX: box.x + box.width * 0.8,
    clientY: box.y + box.height * 0.5,
    pointerId: 1,
  };
  await scrub.dispatchEvent("pointerdown", { ...at, buttons: 1 });
  await scrub.dispatchEvent("pointerup", at);
  const landed = await getTime(video);
  expect(landed).toBeGreaterThan(60);
  // Released during playback: the scrub resumes it.
  await expect.poll(() => lastEventType(component)).toBe("play");

  await setTime(video, landed + 5);
  await pause(component, video);

  const record = await lastRecord(component);
  expect(record?.events.find((e) => e.type === "seek")).toMatchObject({
    fromTime: 20,
    videoTime: landed,
  });
  expect(record?.watchedRanges).toEqual([
    [10, 20],
    [landed, landed + 5],
  ]);
});

// -- Stage ends mid-playback (#677) --

test("submitting during playback closes the open range where playback stood", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} />);
  const video = await mockVideo(component);

  await setTime(video, 15.25);
  await play(component, video);
  await setTime(video, 24.5);
  await component.locator('[data-testid="submit"]').click();

  await expect.poll(() => lastEventType(component)).toBe("stageEnd");
  const record = await lastRecord(component);
  expect(record?.events.at(-1)).toMatchObject({
    type: "stageEnd",
    videoTime: 24.5,
  });
  expect(record?.lastVideoTime).toBe(24.5);
  expect(record?.watchedRanges).toEqual([[15.25, 24.5]]);
});

test("submitting while paused adds nothing to the log", async ({ mount }) => {
  const component = await mount(<MockLoggedPlayer url={URL} />);
  const video = await mockVideo(component);

  await setTime(video, 10);
  await play(component, video);
  await setTime(video, 12);
  await pause(component, video);
  const before = (await playerSaves(component)).length;

  await component.locator('[data-testid="submit"]').click();
  await expect(component.locator('[data-testid="mediaPlayer"]')).toHaveCount(0);
  await component.page().waitForTimeout(700);
  expect(await playerSaves(component)).toHaveLength(before);
});

test("submitting right after a Timeline seek logs that seek at once", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} withTimeline />);
  await mockVideo(component);
  await rulerReady(component);

  // Seek and submit in one task, well inside the seek's settle window, then
  // read the log before that window could have closed.
  const events = await component.evaluate(async (root) => {
    const ruler = root.querySelector('[data-testid="time-ruler"]');
    const submit = root.querySelector<HTMLElement>('[data-testid="submit"]');
    if (!ruler || !submit) throw new Error("harness not found");
    const r = ruler.getBoundingClientRect();
    const init = {
      bubbles: true,
      clientX: r.left + r.width * 0.8,
      clientY: r.top + r.height / 2,
      pointerId: 1,
      button: 0,
      buttons: 1,
      isPrimary: true,
    };
    ruler.dispatchEvent(new PointerEvent("pointerdown", init));
    ruler.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
    submit.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const log = JSON.parse(
      root.querySelector('[data-testid="save-log"]')?.textContent ?? "[]",
    ) as Array<{ key: string; value: { events: Array<{ type: string }> } }>;
    return (
      log.filter((s) => s.key === "mediaPlayer_clip").at(-1)?.value.events ?? []
    );
  });
  expect(events.map((e) => e.type)).toEqual(["seek"]);

  // …and the settle timer doesn't log it a second time.
  await component.page().waitForTimeout(700);
  const saves = await playerSaves(component);
  expect(saves.at(-1)?.events.filter((e) => e.type === "seek")).toHaveLength(1);
});

// -- Keyboard speed changes (#676) --

test("the > and < keys log a speed event, like the speed button", async ({
  mount,
}) => {
  const component = await mount(<MockLoggedPlayer url={URL} />);
  const player = component.locator('[data-testid="mediaPlayer"]');

  await player.press("Shift+Period");
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "speed", playbackRate: 1.25 });

  await player.press("Shift+Comma");
  await player.press("Shift+Comma");
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "speed", playbackRate: 0.75 });
  const speeds = (await lastRecord(component))?.events.filter(
    (e) => e.type === "speed",
  );
  expect(speeds?.map((e) => e.playbackRate)).toEqual([1.25, 1, 0.75]);
});

test("the speed keys do nothing when controls.speed is off", async ({
  mount,
}) => {
  const component = await mount(
    <MockLoggedPlayer url={URL} controls={{ playPause: true, seek: true }} />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  await player.press("Shift+Period");
  await player.press("Shift+Comma");
  await player.press("Shift+Comma");
  expect(await video.evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(
    1,
  );
  expect(await playerSaves(component)).toEqual([]);
});

test("a speed key at the limit logs nothing", async ({ mount }) => {
  const component = await mount(<MockLoggedPlayer url={URL} />);
  const player = component.locator('[data-testid="mediaPlayer"]');

  for (let i = 0; i < 6; i++) await player.press("Shift+Period");
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "speed", playbackRate: 2 });
  const speeds = (await lastRecord(component))?.events.filter(
    (e) => e.type === "speed",
  );
  // 1 → 1.25 → 1.5 → 2, then three presses at the limit.
  expect(speeds?.map((e) => e.playbackRate)).toEqual([1.25, 1.5, 2]);
});
