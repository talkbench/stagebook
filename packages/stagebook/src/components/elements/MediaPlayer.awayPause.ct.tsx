/**
 * Pausing while the participant is away, in real browsers (#844). The page's
 * visibility and focus are stubbed and their events dispatched; playback,
 * media events and the Timeline wiring are real. The YouTube cases stub the
 * IFrame API, as Timeline.once.ct.tsx does.
 */
import {
  test,
  expect,
  type Locator,
  type Page,
} from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../testing/MockMediaPlayer.js";
import { MockWindowedTimeline } from "../testing/MockWindowedTimeline.js";
import type { VideoPlaybackRecord } from "../../schemas/mediaPlayerRecord.js";

type PageWindow = Window & { __away: { hidden: boolean; focused: boolean } };

async function stubPageState(page: Page) {
  await page.evaluate(() => {
    const state = { hidden: false, focused: true };
    (window as PageWindow).__away = state;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (state.hidden ? "hidden" : "visible"),
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => state.hidden,
    });
    document.hasFocus = () => state.focused;
  });
}

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    const state = (window as PageWindow).__away;
    state.hidden = hidden;
    state.focused = !hidden;
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function records(component: Locator) {
  const log = JSON.parse(
    (await component.getByTestId("save-log").textContent()) ?? "[]",
  ) as Array<{ key: string; value: VideoPlaybackRecord }>;
  return log
    .filter((entry) => entry.key === "mediaPlayer_clip")
    .map((entry) => entry.value);
}
async function lastRecord(component: Locator) {
  return (await records(component)).at(-1);
}

test("native video pauses while hidden and resumes rewound on return", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="clip"
      playAudio={false}
      playback="manual"
      controls={{ playPause: true }}
      pauseWhen={["hidden"]}
      rewindOnResume={1}
    />,
  );
  const video = component.getByTestId("mediaPlayer-video");
  await expect(video).toHaveAttribute("disablepictureinpicture", "");
  await video.evaluate(async (el: HTMLVideoElement) => {
    await el.play();
  });
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBeGreaterThan(1.5);

  await setHidden(page, true);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(true);
  const pausedAt = await video.evaluate(
    (el: HTMLVideoElement) => el.currentTime,
  );
  // The pause is written once the absence passes a second.
  await expect
    .poll(async () =>
      (await lastRecord(component))?.events.find(
        (event) => event.type === "pause",
      ),
    )
    .toMatchObject({ type: "pause", reason: "hidden" });

  await setHidden(page, false);
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(false);
  await expect
    .poll(async () =>
      (await lastRecord(component))?.events.slice(-2).map((e) => e.type),
    )
    .toEqual(["seek", "play"]);
  const record = (await lastRecord(component))!;
  const [seek, play] = record.events.slice(-2);
  expect(seek).toMatchObject({ reason: "return" });
  expect(play).toMatchObject({ reason: "return" });
  expect(seek.fromTime).toBeCloseTo(pausedAt, 1);
  expect(seek.videoTime).toBeCloseTo(pausedAt - 1, 1);
  expect(record).toMatchObject({ awayPauseCount: 1, resumeBlockedCount: 0 });
  expect(record.awayPausedSeconds).toBeGreaterThanOrEqual(1);
  // Playback was paused while hidden, so none of it counts as hidden.
  expect(record.hiddenPlaybackSeconds ?? 0).toBeLessThan(0.5);
});

type YouTubeState = {
  time: number;
  paused: boolean;
  plays: number;
  seeks: number[];
  /** Refuse this many plays, as an autoplay policy would. */
  blockCount: number;
  /** Hold pause reports until `__ytFlush`, as postMessage can (#844). */
  lagPause: boolean;
  /** The state YouTube last reported: what getPlayerState() answers. */
  reported: number;
};
type YouTubeWindow = Window & {
  __yt: YouTubeState;
  __ytFlush: () => void;
  __ytEnd: () => void;
};

async function stubYouTube(page: Page) {
  await page.evaluate(() => {
    const state: YouTubeState = {
      time: 2,
      paused: true,
      plays: 0,
      seeks: [],
      blockCount: 0,
      lagPause: false,
      reported: 2,
    };
    (window as YouTubeWindow).__yt = state;
    type Events = {
      onReady: () => void;
      onStateChange: (e: { data: number }) => void;
      onAutoplayBlocked?: () => void;
    };
    Object.assign(window, {
      YT: {
        Player: function (_el: HTMLElement, opts: { events: Events }) {
          const emit = (data: number) => {
            state.reported = data;
            opts.events.onStateChange({ data });
          };
          const held: number[] = [];
          (window as YouTubeWindow).__ytFlush = () => {
            for (const data of held.splice(0)) emit(data);
          };
          (window as YouTubeWindow).__ytEnd = () => {
            state.time = 10;
            state.paused = true;
            emit(0);
          };
          setTimeout(() => opts.events.onReady(), 0);
          return {
            playVideo() {
              state.plays++;
              if (state.blockCount > 0) {
                state.blockCount--;
                opts.events.onAutoplayBlocked?.();
                return;
              }
              state.paused = false;
              emit(1);
            },
            pauseVideo() {
              state.paused = true;
              if (state.lagPause) held.push(2);
              else emit(2);
            },
            seekTo(time: number) {
              state.time = time;
              state.seeks.push(time);
            },
            getCurrentTime: () => state.time,
            getDuration: () => 10,
            getPlayerState: () => state.reported,
            destroy() {},
          };
        },
      },
    });
  });
}
const youtube = (page: Page) =>
  page.evaluate(() => ({ ...(window as YouTubeWindow).__yt }));
const setYouTubeTime = (page: Page, time: number) =>
  page.evaluate((time) => {
    (window as YouTubeWindow).__yt.time = time;
  }, time);

const YOUTUBE = "https://youtu.be/QC8iQqtG0hg";

test("YouTube pauses while hidden and resumes rewound, with the Timeline following", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  await stubYouTube(page);
  const component = await mount(
    <MockWindowedTimeline
      url={YOUTUBE}
      selectionType="point"
      pauseWhen={["hidden"]}
      rewindOnResume={2}
    />,
  );
  await page.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await setYouTubeTime(page, 5);
  await setHidden(page, true);
  await expect.poll(async () => (await youtube(page)).paused).toBe(true);
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "pause", videoTime: 5, reason: "hidden" });
  await setHidden(page, false);
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  expect((await youtube(page)).seeks.at(-1)).toBe(3);
  // The whole log: the automatic pause appears once, with its reason.
  await expect
    .poll(async () =>
      (await lastRecord(component))?.events.map(
        ({ type, videoTime, reason }) => ({ type, videoTime, reason }),
      ),
    )
    .toEqual([
      { type: "play", videoTime: 2, reason: undefined },
      { type: "pause", videoTime: 5, reason: "hidden" },
      { type: "seek", videoTime: 3, reason: "return" },
      { type: "play", videoTime: 3, reason: "return" },
    ]);
});

test("YouTube play-once resumes on its own, and a twice-refused resume keeps its control", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  await stubYouTube(page);
  const component = await mount(
    <MockMediaPlayer
      url={YOUTUBE}
      name="clip"
      playback="once"
      pauseWhen={["hidden"]}
    />,
  );
  // Autoplay starts it: play-once has no controls.
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await setHidden(page, true);
  await expect.poll(async () => (await youtube(page)).paused).toBe(true);
  await page.waitForTimeout(1100);
  await setHidden(page, false);
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "play", reason: "return" });

  await setHidden(page, true);
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    (window as YouTubeWindow).__yt.blockCount = 2;
  });
  await setHidden(page, false);
  const resume = page.getByTestId("mediaPlayer-awayResume");
  await expect(resume).toBeVisible();
  await resume.click();
  // Refused again: the control comes back, the only way to continue.
  await expect(resume).toBeVisible();
  await resume.click();
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await expect(resume).toBeHidden();
});

test("YouTube: a refused resume offers play, and the Timeline's play is the participant's", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  await stubYouTube(page);
  const component = await mount(
    <MockWindowedTimeline
      url={YOUTUBE}
      selectionType="point"
      pauseWhen={["hidden"]}
    />,
  );
  await page.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await setHidden(page, true);
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1)?.reason)
    .toBe("hidden");
  await page.evaluate(() => {
    (window as YouTubeWindow).__yt.blockCount = 1;
  });
  await setHidden(page, false);
  const resume = page.getByTestId("mediaPlayer-awayResume");
  await expect(resume).toBeVisible();
  await expect(resume).toHaveText(/paused while you were away/i);
  expect((await youtube(page)).paused).toBe(true);

  // Resuming from the Timeline counts as the participant's own play.
  await page.getByTestId("timeline").focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await youtube(page)).paused).toBe(false);
  await expect(resume).toBeHidden();
  await expect
    .poll(async () => (await lastRecord(component))?.events.at(-1))
    .toMatchObject({ type: "play" });
  const record = (await lastRecord(component))!;
  expect(record.events.at(-1)?.reason).toBeUndefined();
  expect(record).toMatchObject({ awayPauseCount: 1, resumeBlockedCount: 1 });
});

const lagPauses = (page: Page) =>
  page.evaluate(() => {
    (window as YouTubeWindow).__yt.lagPause = true;
  });
const flushYouTube = (page: Page) =>
  page.evaluate(() => (window as YouTubeWindow).__ytFlush());

test("YouTube: a pause the participant just made is not claimed by leaving before YouTube reports it", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  await stubYouTube(page);
  const component = await mount(
    <MockWindowedTimeline
      url={YOUTUBE}
      selectionType="point"
      pauseWhen={["hidden"]}
    />,
  );
  const playPause = page.getByTestId("mediaPlayer-playPause");
  await playPause.click();
  await expect.poll(async () => (await youtube(page)).reported).toBe(1);
  await lagPauses(page);
  await playPause.click();
  // The participant left before YouTube reported their pause.
  await setHidden(page, true);
  await flushYouTube(page);
  await page.waitForTimeout(1200);
  await setHidden(page, false);
  await page.waitForTimeout(300);
  const state = await youtube(page);
  expect(state.paused).toBe(true);
  expect(state.plays).toBe(1);
  const events = (await lastRecord(component))!.events;
  expect(events.map(({ type, reason }) => ({ type, reason }))).toEqual([
    { type: "play", reason: undefined },
    { type: "pause", reason: undefined },
  ]);
  expect(await lastRecord(component)).toMatchObject({ awayPauseCount: 0 });
});

test("YouTube: an automatic pause that never reports does not swallow a later pause", async ({
  mount,
  page,
}) => {
  await stubPageState(page);
  await stubYouTube(page);
  const component = await mount(
    <MockWindowedTimeline
      url={YOUTUBE}
      selectionType="point"
      pauseWhen={["hidden"]}
    />,
  );
  const playPause = page.getByTestId("mediaPlayer-playPause");
  await playPause.click();
  await expect.poll(async () => (await youtube(page)).reported).toBe(1);
  // Leaving pauses it, but the clip ends before YouTube reports the pause.
  await lagPauses(page);
  await setHidden(page, true);
  await page.evaluate(() => (window as YouTubeWindow).__ytEnd());
  await setHidden(page, false);
  await page.evaluate(() => {
    (window as YouTubeWindow).__yt.lagPause = false;
  });
  // The participant replays, then pauses on purpose.
  await playPause.click();
  await expect.poll(async () => (await youtube(page)).reported).toBe(1);
  await playPause.click();
  await expect
    .poll(async () =>
      (await lastRecord(component))?.events.map(({ type }) => type),
    )
    .toEqual(["play", "ended", "seek", "play", "pause"]);
  expect((await lastRecord(component))!.events.at(-1)?.reason).toBeUndefined();
});

test("unfocused: focus moving into a frame on the page does not pause (real focus)", async ({
  mount,
  page,
  browserName,
}) => {
  // No stubs: the browser's own hasFocus() during the window's blur.
  const component = await mount(
    <div>
      <MockMediaPlayer
        url="/sample-video.mp4"
        name="clip"
        playAudio={false}
        playback="manual"
        controls={{ playPause: true }}
        pauseWhen={["unfocused"]}
      />
      <iframe
        title="frame"
        srcDoc="<button id='inside'>Inside</button>"
        style={{ width: 200, height: 60 }}
      />
    </div>,
  );
  const video = component.getByTestId("mediaPlayer-video");
  await page.getByTestId("mediaPlayer-playPause").click();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(false);
  await page.evaluate(() => {
    window.addEventListener("blur", () => {
      document.documentElement.dataset.blurred = "true";
    });
  });
  await page.frameLocator("iframe").locator("#inside").click();
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.tagName.toLowerCase()),
    )
    .toBe("iframe");
  // The window did blur, so the guard was exercised, and the browser counts
  // focus inside the frame as the page's. Playwright's Firefox delivers no
  // window blur for this, so there the test shows only that nothing pauses.
  if (browserName !== "firefox")
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.blurred))
      .toBe("true");
  expect(await page.evaluate(() => document.hasFocus())).toBe(true);
  await page.waitForTimeout(300);
  expect(await video.evaluate((el: HTMLVideoElement) => el.paused)).toBe(false);
  expect(
    (await records(component)).flatMap((record) => record.events),
  ).not.toContainEqual(expect.objectContaining({ reason: "unfocused" }));
});
