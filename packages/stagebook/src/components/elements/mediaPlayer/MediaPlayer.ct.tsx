import { test, expect } from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../../testing/MockMediaPlayer.js";

// -- Rendering structure --

test("renders with correct ARIA region", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  await expect(player).toBeAttached();
  await expect(player).toHaveAttribute("role", "region");
  await expect(player).toHaveAttribute("aria-label", "Media player");
});

test("renders a video element for direct URL", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-video"]'),
  ).toBeAttached();
});

test("video element has crossOrigin=anonymous for waveform capture", async ({
  mount,
}) => {
  // Required so the Web Audio API can read audio samples when a Timeline
  // attaches to this player. Without it, cross-origin media is silently
  // CORS-tainted and waveforms render as flat lines.
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect(video).toHaveAttribute("crossorigin", "anonymous");
});

test("audio-only video element also has crossOrigin=anonymous", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" playVideo={false} />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect(video).toHaveAttribute("crossorigin", "anonymous");
});

test("renders an iframe for YouTube URL", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="https://youtu.be/QC8iQqtG0hg" name="test" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-youtube"]'),
  ).toBeAttached();
  // No HTML5 video element
  await expect(
    component.locator('[data-testid="mediaPlayer-video"]'),
  ).not.toBeAttached();
});

// -- Viewport border: edges stay visible when video content is near-white --
// Without a border or subtle outline, light-colored content (a washed-out
// blurred background, a whiteboard) bleeds into the page. The viewport div
// is where the definition needs to live so it applies equally to HTML5 and
// YouTube embeds.

test("video viewport has a visible edge for white-content visibility", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  const viewport = component.locator('[data-testid="mediaPlayer-viewport"]');
  const { borderTopWidth, boxShadow } = await viewport.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return {
      borderTopWidth: s.borderTopWidth,
      boxShadow: s.boxShadow,
    };
  });
  // Either a non-zero border or a non-"none" box-shadow suffices.
  const hasBorder = borderTopWidth !== "0px";
  const hasShadow = boxShadow !== "none";
  expect(hasBorder || hasShadow).toBe(true);
});

test("YouTube viewport has the same visible edge as HTML5", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer url="https://youtu.be/QC8iQqtG0hg" name="test" />,
  );
  const viewport = component.locator('[data-testid="mediaPlayer-viewport"]');
  const { borderTopWidth, boxShadow } = await viewport.evaluate((el) => {
    const s = window.getComputedStyle(el);
    return {
      borderTopWidth: s.borderTopWidth,
      boxShadow: s.boxShadow,
    };
  });
  const hasBorder = borderTopWidth !== "0px";
  const hasShadow = boxShadow !== "none";
  expect(hasBorder || hasShadow).toBe(true);
});

// -- YouTube IFrame API integration --

// Injects a synchronous mock window.YT into the page so YouTubePlayer's
// createYouTubePlayer() takes the sync path. Tests then fire onReady /
// onStateChange via page.evaluate() to simulate the real API callbacks.

type PWT = import("@playwright/test").Page;

async function installYTMock(page: PWT) {
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__ytOnReady = null;
    w.__ytOnStateChange = null;
    w.__ytCurrentTime = 0;
    w.__ytDuration = 60;
    w.__ytState = 2; // PAUSED
    w.__ytPlayCalled = 0;
    w.__ytPauseCalled = 0;
    w.__ytLastSeek = null;

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
        opts: {
          events?: {
            onReady?: () => void;
            onStateChange?: (e: { data: number }) => void;
          };
        },
      ) {
        w.__ytOnReady = opts.events?.onReady ?? null;
        w.__ytOnStateChange = opts.events?.onStateChange ?? null;
        return {
          playVideo() {
            w.__ytPlayCalled++;
          },
          pauseVideo() {
            w.__ytPauseCalled++;
          },
          seekTo(t: number) {
            w.__ytLastSeek = t;
          },
          getCurrentTime() {
            return w.__ytCurrentTime;
          },
          getDuration() {
            return w.__ytDuration;
          },
          getPlayerState() {
            return w.__ytState;
          },
          destroy() {},
        };
      },
    };
  });
}

// Fires the YT onReady callback, waiting first for the Player constructor to have
// run (useEffect is async — it may not have run yet when mount() resolves).
async function fireYTOnReady(page: PWT) {
  // Poll until createYouTubePlayer's useEffect has run and registered __ytOnReady
  await expect
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .poll(() => page.evaluate(() => (window as any).__ytOnReady !== null))
    .toBe(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => (window as any).__ytOnReady?.());
}

test("YouTube: play button shown after IFrame API ready", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="test"
      controls={{ playPause: true, seek: true }}
    />,
  );
  await fireYTOnReady(page);
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-seekBack"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-seekForward"]'),
  ).toBeVisible();
});

test("YouTube: play button aria-label becomes Pause after PLAYING state", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  await fireYTOnReady(page);
  // Hover to keep controls visible while playing
  await component
    .locator('[data-testid="mediaPlayer"]')
    .dispatchEvent("mouseover", { bubbles: true });
  // Simulate YouTube state change to PLAYING
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__ytState = 1;
    w.__ytOnStateChange?.({ data: 1 });
  });
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Pause");
});

test("YouTube: clicking play button calls player.playVideo()", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  // seek: true exposes time display as a sync point for setDuration (= setYtHandle batch)
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="test"
      controls={{ playPause: true, seek: true }}
    />,
  );
  await fireYTOnReady(page);
  // setDuration(60) is called in the same onHandleReady batch as setYtHandle; wait for it
  await expect(
    component.locator('[data-testid="mediaPlayer-time"]'),
  ).toContainText("1:00");
  const btn = component.locator('[data-testid="mediaPlayer-playPause"]');
  await btn.click();
  await expect
    .poll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => page.evaluate(() => (window as any).__ytPlayCalled as number),
    )
    .toBeGreaterThan(0);
});

test("YouTube: clicking pause button calls player.pauseVideo()", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  await fireYTOnReady(page);
  // Put player into playing state so button shows "Pause"
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__ytState = 1;
    w.__ytOnStateChange?.({ data: 1 });
  });
  // Hover to keep controls visible while playing; aria-label "Pause" confirms isPaused=false
  await component
    .locator('[data-testid="mediaPlayer"]')
    .dispatchEvent("mouseover", { bubbles: true });
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Pause");
  await component.locator('[data-testid="mediaPlayer-playPause"]').click();
  const callCount = await page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__ytPauseCalled as number,
  );
  expect(callCount).toBeGreaterThan(0);
});

test("YouTube: seekBack button calls player.seekTo(currentTime - 1)", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="test"
      controls={{ seek: true }}
    />,
  );
  // Set currentTime before firing onReady so the handle captures it
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => ((window as any).__ytCurrentTime = 30));
  await fireYTOnReady(page);
  // aria-valuemax = 60 (= __ytDuration) once setDuration(60) has been committed
  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toHaveAttribute("aria-valuemax", "60");
  const btn = component.locator('[data-testid="mediaPlayer-seekBack"]');
  await btn.click();
  await expect
    .poll(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => page.evaluate(() => (window as any).__ytLastSeek as number | null),
    )
    .toBe(29);
});

test("YouTube: save() called with play event when state changes to PLAYING", async ({
  mount,
  page,
}) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer
      url="https://youtu.be/QC8iQqtG0hg"
      name="coding_video"
      controls={{ playPause: true }}
    />,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => ((window as any).__ytCurrentTime = 5));
  await fireYTOnReady(page);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    w.__ytState = 1;
    w.__ytOnStateChange?.({ data: 1 });
  });
  // Wait for React to flush and MockMediaPlayer to update the save-log
  const saveLog = component.locator('[data-testid="save-log"]');
  await expect
    .poll(async () => {
      const text = await saveLog.textContent();
      return text ?? "";
    })
    .toMatch(/"type":"play"/);
  const saveText = await saveLog.textContent();
  const saves = JSON.parse(saveText ?? "[]") as Array<{
    key: string;
    value: { events: Array<{ type: string; videoTime: number }> };
  }>;
  const lastRecord = saves[saves.length - 1].value;
  expect(lastRecord.events.at(-1)?.type).toBe("play");
  expect(lastRecord.events.at(-1)?.videoTime).toBe(5);
});

test("YouTube: no video element rendered", async ({ mount, page }) => {
  await installYTMock(page);
  const component = await mount(
    <MockMediaPlayer url="https://youtu.be/QC8iQqtG0hg" name="test" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-video"]'),
  ).not.toBeAttached();
});

// -- Controls visibility --

// Real fixture video served by Vite from /public.
const FIXTURE_VIDEO = "/sample-video.mp4";

// Visual inspection test: all controls enabled together using the real fixture.
// Run with `--ui` to interact — click play/pause, drag the scrub bar, etc.
test("all controls shown together", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ playPause: true, seek: true, step: true, speed: true }}
      stepDuration={5}
    />,
  );

  // Controls visible on mount (paused state)
  await expect(
    component.locator('[data-testid="mediaPlayer-seekBack"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-stepBack"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-stepForward"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-seekForward"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toBeVisible();
});

test("no controls shown when controls prop is omitted", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-controls"]'),
  ).not.toBeAttached();
});

test("play/pause button shown when controls.playPause is true", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toBeVisible();
});

test("scrub bar shown when controls.seek is true", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toBeVisible();
});

test("speed button shown when controls.speed is true", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toBeVisible();
});

test("no controls shown when syncToStageTime is true", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      syncToStageTime={true}
      controls={{ playPause: true, seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-controls"]'),
  ).not.toBeAttached();
});

// -- playVideo: false (audio-only mode) --

test("video element is hidden when playVideo is false", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="https://example.com/discussion.mp4"
      name="test"
      playVideo={false}
    />,
  );
  // Video element present for audio but not visible
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect(video).toBeAttached();
  await expect(video).not.toBeVisible();
});

// -- Data recording --

test("save is called with play event data when video plays", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test_vid"
      playback="manual"
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("play")));

  const log = component.locator('[data-testid="save-log"]');
  const raw = await log.textContent();
  const saves = JSON.parse(raw ?? "[]") as Array<{
    key: string;
    value: unknown;
  }>;

  expect(saves).toHaveLength(1);
  expect(saves[0].key).toBe("mediaPlayer_test_vid");
  const record = saves[0].value as {
    events: Array<{
      type: string;
      videoTime: number;
      stageTimeElapsed: number;
    }>;
  };
  expect(record.events).toHaveLength(1);
  expect(record.events[0].type).toBe("play");
  expect(typeof record.events[0].videoTime).toBe("number");
  expect(typeof record.events[0].stageTimeElapsed).toBe("number");
});

test("save is called with pause event data when video pauses", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test_vid"
      playback="manual"
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("pause")));

  const log = component.locator('[data-testid="save-log"]');
  const raw = await log.textContent();
  const saves = JSON.parse(raw ?? "[]") as Array<{
    key: string;
    value: unknown;
  }>;

  expect(saves).toHaveLength(1);
  const record = saves[0].value as {
    events: Array<{ type: string }>;
  };
  expect(record.events[0].type).toBe("pause");
});

test("save log accumulates multiple events", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test_vid"
      playback="manual"
    />,
  );

  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => el.dispatchEvent(new Event("play")));
  await video.evaluate((el) => el.dispatchEvent(new Event("pause")));

  const raw = await component.locator('[data-testid="save-log"]').textContent();
  const saves = JSON.parse(raw ?? "[]") as Array<{
    key: string;
    value: unknown;
  }>;

  // Two saves, each containing the full record up to that point
  expect(saves).toHaveLength(2);
  const lastRecord = saves[1].value as {
    events: Array<{ type: string }>;
  };
  expect(lastRecord.events).toHaveLength(2);
  expect(lastRecord.events[0].type).toBe("play");
  expect(lastRecord.events[1].type).toBe("pause");
});

// -- submitOnComplete --

test("onComplete not called when submitOnComplete is false", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      submitOnComplete={false}
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("ended")));

  const completed = await component
    .locator('[data-testid="completed"]')
    .textContent();
  expect(completed).toBe("false");
});

test("onComplete called when submitOnComplete is true and video ends", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      submitOnComplete={true}
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("ended")));

  const completed = await component
    .locator('[data-testid="completed"]')
    .textContent();
  expect(completed).toBe("true");
});

// -- startAt / stopAt scrub bounds --

test("scrub bar aria-valuemin is startAt", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      startAt={10}
      stopAt={90}
      controls={{ seek: true }}
    />,
  );
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  await expect(scrub).toHaveAttribute("aria-valuemin", "10");
});

test("scrub bar aria-valuemax is stopAt", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      startAt={10}
      stopAt={90}
      controls={{ seek: true }}
    />,
  );
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  await expect(scrub).toHaveAttribute("aria-valuemax", "90");
});

test("scrub bar defaults to 0/Infinity when startAt/stopAt omitted", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  await expect(scrub).toHaveAttribute("aria-valuemin", "0");
  // Without stopAt and no loaded metadata, max should be 0 or unset — not NaN
  const max = await scrub.getAttribute("aria-valuemax");
  expect(isNaN(Number(max))).toBe(false);
});

// -- stopAt enforcement --

test("save records stopAt event when timeupdate exceeds stopAt", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stopAt={5}
      playback="manual"
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "currentTime", {
        get: () => 6,
        configurable: true,
      });
      el.dispatchEvent(new Event("timeupdate"));
    });

  const raw = await component.locator('[data-testid="save-log"]').textContent();
  const saves = JSON.parse(raw ?? "[]") as Array<{
    key: string;
    value: { events: Array<{ type: string }> };
  }>;
  expect(saves.length).toBeGreaterThan(0);
  const lastEvents = saves[saves.length - 1].value.events;
  // Should record exactly one "stopAt" event — distinct from natural "ended"
  expect(lastEvents).toHaveLength(1);
  expect(lastEvents[0].type).toBe("stopAt");
});

test("onComplete called when submitOnComplete is true and stopAt is reached", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stopAt={5}
      submitOnComplete={true}
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "currentTime", {
        get: () => 6,
        configurable: true,
      });
      el.dispatchEvent(new Event("timeupdate"));
    });

  const completed = await component
    .locator('[data-testid="completed"]')
    .textContent();
  expect(completed).toBe("true");
});

// -- captions overlay --

test("no caption overlay when captionsURL is not provided", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-caption"]'),
  ).not.toBeAttached();
});

test("caption overlay shows active cue text on timeupdate", async ({
  mount,
  page,
}) => {
  const vtt = `WEBVTT\n\n00:00.000 --> 00:10.000\nHello world\n`;
  await page.route("**/captions.vtt", (route) =>
    route.fulfill({ body: vtt, contentType: "text/vtt" }),
  );

  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      captionsURL="https://example.com/captions.vtt"
    />,
  );

  // Wait for VTT fetch to complete
  await page.waitForFunction(() => {
    // poll until the caption element appears or we decide it isn't coming
    return true; // just a small pause for the fetch
  });

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "currentTime", {
        get: () => 5,
        configurable: true,
      });
      el.dispatchEvent(new Event("timeupdate"));
    });

  await expect(
    component.locator('[data-testid="mediaPlayer-caption"]'),
  ).toContainText("Hello world");
});

test("caption overlay clears when no cue is active", async ({
  mount,
  page,
}) => {
  const vtt = `WEBVTT\n\n00:05.000 --> 00:10.000\nHello world\n`;
  await page.route("**/captions.vtt", (route) =>
    route.fulfill({ body: vtt, contentType: "text/vtt" }),
  );

  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      captionsURL="https://example.com/captions.vtt"
    />,
  );

  // At t=1, no cue is active
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "currentTime", {
        get: () => 1,
        configurable: true,
      });
      el.dispatchEvent(new Event("timeupdate"));
    });

  await expect(
    component.locator('[data-testid="mediaPlayer-caption"]'),
  ).not.toBeAttached();
});

// -- Scrub bar state tracking --

test("scrub bar aria-valuenow tracks currentTime on timeupdate", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );

  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "currentTime", {
        get: () => 7.5,
        configurable: true,
      });
      el.dispatchEvent(new Event("timeupdate"));
    });

  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toHaveAttribute("aria-valuenow", "7.5");
});

test("scrub bar data-step equals stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stepDuration={0.1}
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toHaveAttribute("data-step", "0.1");
});

test("scrub bar data-step defaults to 1 when stepDuration is omitted", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-scrubBar"]'),
  ).toHaveAttribute("data-step", "1");
});

// Helper: set up a video element with a controllable currentTime / paused state
async function setupVideoMock(
  video: import("@playwright/test").Locator,
  opts: { duration?: number; playing?: boolean } = {},
) {
  await video.evaluate((el, { duration = 100, playing = false }) => {
    let ct = 0;
    let paused = !playing;
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
      get: () => duration,
      configurable: true,
    });
    Object.defineProperty(el, "paused", {
      get: () => paused,
      configurable: true,
    });
    v.pause = () => {
      paused = true;
      el.dispatchEvent(new Event("pause"));
    };
    v.play = () => {
      paused = false;
      el.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    el.dispatchEvent(new Event("loadedmetadata"));
  }, opts);
}

test("scrub bar: pointerdown seeks video to clicked position", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await setupVideoMock(video);
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  const box = await scrub.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  await scrub.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.5,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  // Seek happens immediately on pointerdown
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeCloseTo(50, 0);
});

test("scrub bar: pointermove seeks video during drag", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await setupVideoMock(video);
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  const box = await scrub.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  await scrub.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.1,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  await scrub.dispatchEvent("pointermove", {
    clientX: box.x + box.width * 0.75,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  // seek updates in real-time during drag
  expect(await video.evaluate((el) => el.currentTime)).toBeCloseTo(75, 0);
});

test("scrub bar: pauses video on grab while playing, resumes on release", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  // Set up as currently playing (paused=false)
  await setupVideoMock(video, { playing: true });
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  const box = await scrub.boundingBox();
  if (!box) throw new Error("scrub bar not found");

  // Grab scrubbar while playing → should auto-pause
  await scrub.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.5,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  // video.paused should now be true and a "pause" event recorded
  const pausedAfterDown = await video.evaluate((el) => el.paused);
  expect(pausedAfterDown).toBe(true);
  const saveLog = component.locator('[data-testid="save-log"]');
  const rawAfterDown = await saveLog.textContent();
  const savesAfterDown = JSON.parse(rawAfterDown ?? "[]") as Array<{
    value: { events: Array<{ type: string }> };
  }>;
  expect(savesAfterDown.at(-1)?.value.events.at(-1)?.type).toBe("pause");

  // Release → should resume
  await scrub.dispatchEvent("pointerup", {
    clientX: box.x + box.width * 0.5,
    clientY: box.y + box.height * 0.5,
    pointerId: 1,
  });
  const pausedAfterUp = await video.evaluate((el) => el.paused);
  expect(pausedAfterUp).toBe(false);
  const rawAfterUp = await saveLog.textContent();
  const savesAfterUp = JSON.parse(rawAfterUp ?? "[]") as Array<{
    value: { events: Array<{ type: string }> };
  }>;
  expect(savesAfterUp.at(-1)?.value.events.at(-1)?.type).toBe("play");
});

test("scrub bar: no play/pause events when scrubbing from paused state", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await setupVideoMock(video, { playing: false });
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  const box = await scrub.boundingBox();
  if (!box) throw new Error("scrub bar not found");
  await scrub.dispatchEvent("pointerdown", {
    clientX: box.x + box.width * 0.3,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  await scrub.dispatchEvent("pointermove", {
    clientX: box.x + box.width * 0.7,
    clientY: box.y + box.height * 0.5,
    buttons: 1,
    pointerId: 1,
  });
  await scrub.dispatchEvent("pointerup", {
    clientX: box.x + box.width * 0.7,
    clientY: box.y + box.height * 0.5,
    pointerId: 1,
  });
  // No save events should have been recorded (scrubbing while paused = no events)
  const raw = await component.locator('[data-testid="save-log"]').textContent();
  const saves = JSON.parse(raw ?? "[]") as Array<unknown>;
  expect(saves).toHaveLength(0);
});

// -- Play/pause button state --

test("play button aria-label is Play when paused", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Play");
});

test("play button aria-label becomes Pause after play event", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("play")));
  // Hover to reveal controls (hidden while playing)
  await player.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Pause");
});

test("play button aria-label returns to Play after pause event", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => el.dispatchEvent(new Event("play")));
  await video.evaluate((el) => el.dispatchEvent(new Event("pause")));
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Play");
});

// -- Speed control --

test("speed button shows 1x initially", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toContainText("1\u00d7");
});

test("speed button cycles to next speed on click", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  await component.locator('[data-testid="mediaPlayer-speed"]').click();
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).not.toContainText("1\u00d7");
});

test("speed button wraps back to first speed after cycling through all", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  const btn = component.locator('[data-testid="mediaPlayer-speed"]');
  // SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]; starts at 1× (idx 2)
  // 6 clicks cycles through all 6 speeds and lands back at 1×
  for (let i = 0; i < 6; i++) await btn.click();
  await expect(btn).toContainText("1\u00d7");
});

// -- Keyboard shortcuts --

test("Space key toggles to playing state", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      el.play = () => {
        el.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
    });
  await player.press("Space");
  // Hover to reveal controls (hidden while playing)
  await player.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Pause");
});

test("K key toggles to playing state", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      el.play = () => {
        el.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
    });
  await player.press("k");
  // Hover to reveal controls (hidden while playing)
  await player.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Pause");
});

test("Enter key does not toggle playback (#268 — reserved for Timeline)", async ({
  mount,
}) => {
  // Without preventDefault on Enter, a focused play/pause button would
  // fire a click and unpause the video — making playback behavior depend
  // on which control had focus last. We suppress Enter unconditionally so
  // the Timeline can own it for real-time annotation (#263).
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      el.play = () => {
        el.dispatchEvent(new Event("play"));
        return Promise.resolve();
      };
    });
  await player.focus();
  await player.press("Enter");
  // Reveal controls — hover doesn't auto-hide while paused, but be safe.
  await player.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );
  // Should still be paused (button still says Play, not Pause).
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).toHaveAttribute("aria-label", "Play");
});

test("ArrowRight seeks forward 1 second", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press("ArrowRight");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(11);
});

test("ArrowLeft seeks backward 1 second", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 20;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press("ArrowLeft");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(19);
});

test("L key seeks forward 10 seconds", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" playback="manual" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 5;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press("l");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(15);
});

test("J key seeks backward 10 seconds", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" playback="manual" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 30;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press("j");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(20);
});

test("Period key steps forward by stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stepDuration={0.5}
      playback="manual"
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press(".");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeCloseTo(10.5);
});

test("Comma key steps backward by stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stepDuration={0.5}
      playback="manual"
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press(",");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeCloseTo(9.5);
});

test("ArrowLeft clamps to startAt boundary", async ({ mount }) => {
  // ct=10.5, startAt=10: seek(-1) → max(9.5, 10) = 10
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      startAt={10}
      playback="manual"
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10.5;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer"]').press("ArrowLeft");
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(10);
});

// -- Speed keyboard shortcuts --

test("Greater-than key speeds up playback", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  // Start at 1×; > should advance to 1.25×
  await component.locator('[data-testid="mediaPlayer"]').press("Shift+Period");
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toContainText("1.25\u00d7");
});

test("Less-than key slows down playback", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  // Start at 1×; < should step back to 0.75×
  await component.locator('[data-testid="mediaPlayer"]').press("Shift+Comma");
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toContainText("0.75\u00d7");
});

test("Less-than key clamps at minimum speed", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  // Press < many times; should stay at 0.5×
  for (let i = 0; i < 10; i++)
    await component.locator('[data-testid="mediaPlayer"]').press("Shift+Comma");
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toContainText("0.5\u00d7");
});

test("Greater-than key clamps at maximum speed", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ speed: true }}
    />,
  );
  // Press > many times; should stay at 2×
  for (let i = 0; i < 10; i++)
    await component
      .locator('[data-testid="mediaPlayer"]')
      .press("Shift+Period");
  await expect(
    component.locator('[data-testid="mediaPlayer-speed"]'),
  ).toContainText("2\u00d7");
});

// -- controls.step buttons --

test("step buttons shown when controls.step is true", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ step: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-stepBack"]'),
  ).toBeVisible();
  await expect(
    component.locator('[data-testid="mediaPlayer-stepForward"]'),
  ).toBeVisible();
});

test("step forward button advances by stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stepDuration={0.5}
      controls={{ step: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer-stepForward"]').click();
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeCloseTo(10.5);
});

test("step back button retreats by stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      stepDuration={0.5}
      controls={{ step: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer-stepBack"]').click();
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeCloseTo(9.5);
});

// -- seekBack / seekForward buttons --

test("seekBack button shown when controls.seek is true", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-seekBack"]'),
  ).toBeVisible();
});

test("seekForward button shown when controls.seek is true", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-seekForward"]'),
  ).toBeVisible();
});

test("seekBack button tap seeks -1 second", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer-seekBack"]').click();
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(9);
});

test("seekForward button tap seeks +1 second", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });
  await component.locator('[data-testid="mediaPlayer-seekForward"]').click();
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBe(11);
});

// -- allowScrubOutsideBounds --

test("scrub bar clamped to startAt/stopAt by default", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      startAt={10}
      stopAt={50}
      controls={{ seek: true }}
    />,
  );
  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  await expect(scrub).toHaveAttribute("aria-valuemin", "10");
  await expect(scrub).toHaveAttribute("aria-valuemax", "50");
});

test("scrub bar full duration when allowScrubOutsideBounds is true", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      startAt={10}
      stopAt={50}
      allowScrubOutsideBounds={true}
      controls={{ seek: true }}
    />,
  );

  // Simulate loadedmetadata so duration is known
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "duration", {
        get: () => 120,
        configurable: true,
      });
      el.dispatchEvent(new Event("loadedmetadata"));
    });

  const scrub = component.locator('[data-testid="mediaPlayer-scrubBar"]');
  await expect(scrub).toHaveAttribute("aria-valuemin", "0");
  await expect(scrub).toHaveAttribute("aria-valuemax", "120");
});

// -- Buffered range --

test("buffered range element present when controls.seek is true", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-buffered"]'),
  ).toBeAttached();
});

test("buffered range width updates on progress event", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );

  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Set duration first and fire loadedmetadata so duration state is populated
  await video.evaluate((el) => {
    Object.defineProperty(el, "duration", {
      get: () => 100,
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  });

  await video.evaluate((el) => {
    // Mock buffered TimeRanges: buffered 0–60
    Object.defineProperty(el, "buffered", {
      get: () => ({
        length: 1,
        start: () => 0,
        end: () => 60,
      }),
      configurable: true,
    });
    el.dispatchEvent(new Event("progress"));
  });

  const buffered = component.locator('[data-testid="mediaPlayer-buffered"]');
  const width = await buffered.evaluate(
    (el) => (el as HTMLElement).style.width,
  );
  expect(width).toBe("60%");
});

// -- Hold-to-scrub (arrow keys) --

test("holding ArrowRight does rapid forward seeks after repeat threshold", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );

  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    el.play = () => {
      el.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });

  // Simulate 15 repeated keydown events (browser auto-repeat). Once the
  // repeat count hits HOLD_REPEAT_THRESHOLD (10), subsequent events perform
  // seek(+0.5). Playback rate is unchanged (no fast-forward mode).
  await component.locator('[data-testid="mediaPlayer"]').evaluate((el) => {
    for (let i = 0; i < 15; i++) {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          repeat: true,
          bubbles: true,
        }),
      );
    }
  });

  const rate = await video.evaluate((el) => el.playbackRate);
  expect(rate).toBe(1);
  const ct = await video.evaluate((el) => el.currentTime);
  // 6 seeks × 0.5s starting from ct=10 → 13
  expect(ct).toBeCloseTo(13, 5);
});

// -- Hold-to-scrub (seekForward button) --

test("holding seekForward button performs rapid seeks after threshold", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );

  const player = component.locator('[data-testid="mediaPlayer"]');
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await video.evaluate((el) => {
    el.play = () => {
      el.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    let ct = 10;
    Object.defineProperty(el, "currentTime", {
      get: () => ct,
      set: (v: number) => {
        ct = v;
      },
      configurable: true,
    });
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
  });

  // Hover over player so controls remain visible when video starts playing
  await player.evaluate((el) =>
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })),
  );

  // Hold mousedown without releasing. After 500ms threshold the interval
  // starts firing seek(+0.5) every 100ms.
  await component
    .locator('[data-testid="mediaPlayer-seekForward"]')
    .dispatchEvent("mousedown");
  await page.waitForTimeout(800); // threshold 500ms + ~3 ticks

  const rate = await video.evaluate((el) => el.playbackRate);
  expect(rate).toBe(1);
  const ct = await video.evaluate((el) => el.currentTime);
  expect(ct).toBeGreaterThan(10);

  // Cleanup: release
  await component
    .locator('[data-testid="mediaPlayer-seekForward"]')
    .dispatchEvent("mouseup");
});

// -- Hover-to-reveal controls --

test("controls are visible when paused (initial state)", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true, seek: true }}
    />,
  );
  const controls = component.locator('[data-testid="mediaPlayer-controls"]');
  await expect(controls).toBeVisible();
});

test("controls become visible on hover while playing", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  const controls = component.locator('[data-testid="mediaPlayer-controls"]');

  // Simulate play while not hovered (dispatch mouseout first so isHovered = false)
  await player.evaluate((el) => {
    el.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  await video.evaluate((el) => {
    el.dispatchEvent(new Event("play"));
  });

  // Playing + not hovered → controls not in DOM
  await expect(controls).not.toBeAttached();

  // Dispatch mouseover → isHovered = true → controls visible
  await player.evaluate((el) => {
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  await expect(controls).toBeVisible();

  // Dispatch mouseout → isHovered = false → controls hidden again
  await player.evaluate((el) => {
    el.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  await expect(controls).not.toBeAttached();
});

// -- Time display --

test("time display updates after loadedmetadata and timeupdate", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Set duration via loadedmetadata
  await video.evaluate((el) => {
    Object.defineProperty(el, "duration", {
      get: () => 125,
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  });

  // Advance currentTime via timeupdate
  await video.evaluate((el) => {
    Object.defineProperty(el, "currentTime", {
      get: () => 65,
      configurable: true,
    });
    el.dispatchEvent(new Event("timeupdate"));
  });

  await expect(
    component.locator('[data-testid="mediaPlayer-time"]'),
  ).toContainText("1:05 / 2:05");
});

// -- Audio-only layout (playVideo: false) --

test("audio-only: controls always visible while playing (no hover needed)", async ({
  mount,
  page,
}) => {
  // Intercept the media request to prevent network errors that would
  // set loadError and hide controls (see #72).
  // Serve a minimal valid WAV so the video element doesn't fire onerror
  // (which would set loadError and hide controls — see #72).
  // Use .wav for the URL extension to match the served content-type —
  // firefox is stricter than chromium / webkit about extension/MIME
  // alignment and refuses to load otherwise, triggering the
  // loadError path (#417).
  await page.route("**/test.wav", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      // Minimal valid WAV: 44-byte PCM header + 2 bytes of silent
      // sample data. Firefox rejects header-only WAVs with a
      // 0-byte data chunk and flips the MediaPlayer into its
      // loadError state, which hides controls (#417).
      body: Buffer.from(
        "UklGRiYAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQIAAAAAAA==",
        "base64",
      ),
    }),
  );

  const component = await mount(
    <MockMediaPlayer
      url="https://example.com/test.wav"
      name="test"
      playVideo={false}
      controls={{ playPause: true, seek: true }}
    />,
  );
  const player = component.locator('[data-testid="mediaPlayer"]');
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Move mouse away and simulate play
  await player.evaluate((el) =>
    el.dispatchEvent(
      new MouseEvent("mouseout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    ),
  );
  await video.evaluate((el) => el.dispatchEvent(new Event("play")));

  // Controls should be visible without hovering (no video to obscure)
  await expect(
    component.locator('[data-testid="mediaPlayer-controls"]'),
  ).toBeVisible();
});

test("audio-only: no video viewport element", async ({ mount, page }) => {
  // Serve a minimal valid WAV so the video element doesn't fire onerror
  // (which would set loadError and hide controls — see #72).
  await page.route("**/test.mp3", (route) =>
    route.fulfill({
      contentType: "audio/wav",
      body: Buffer.from(
        "UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=",
        "base64",
      ),
    }),
  );

  const component = await mount(
    <MockMediaPlayer
      url="https://example.com/test.mp3"
      name="test"
      playVideo={false}
      controls={{ playPause: true }}
    />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-viewport"]'),
  ).not.toBeAttached();
});

// -- playback: "once" --

test("playback once: attempts autoplay on mount", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" playback="once" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Set up the mock so .play() resolves (autoplay succeeds)
  await setupVideoMock(video);

  // The component should have attempted to play
  const saveLog = component.locator('[data-testid="save-log"]');
  await expect
    .poll(async () => {
      const text = await saveLog.textContent();
      return text ?? "";
    })
    .toMatch(/"type":"play"/);
});

test("playback once: shows play button when autoplay is blocked", async ({
  mount,
  page,
}) => {
  // Block the video from loading so no real loadedmetadata fires
  await page.route("**/blocked.mp4", (route) => route.abort());

  const component = await mount(
    <MockMediaPlayer url="/blocked.mp4" name="test" playback="once" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Override .play() to reject, set duration, fire loadedmetadata — all in one
  // evaluate so the autoplay effect fires with the rejection in place.
  await video.evaluate((el) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).play = () =>
      Promise.reject(new DOMException("NotAllowedError"));
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  });

  // Fallback play button should appear
  await expect(
    component.locator('[data-testid="mediaPlayer-playOnce"]'),
  ).toBeVisible();
});

test("playback once: play button disappears after click", async ({
  mount,
  page,
}) => {
  await page.route("**/blocked.mp4", (route) => route.abort());

  const component = await mount(
    <MockMediaPlayer url="/blocked.mp4" name="test" playback="once" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // First .play() rejects (autoplay blocked), subsequent calls succeed
  await video.evaluate((el) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = el as any;
    v.__callCount = 0;
    v.play = () => {
      v.__callCount++;
      if (v.__callCount === 1) {
        return Promise.reject(new DOMException("NotAllowedError"));
      }
      el.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  });

  const playBtn = component.locator('[data-testid="mediaPlayer-playOnce"]');
  await expect(playBtn).toBeVisible();

  // Click the button — second .play() call succeeds
  await playBtn.click();

  // Button should disappear
  await expect(playBtn).not.toBeAttached();
});

test("playback once: no VCR controls shown", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="test" playback="once" />,
  );
  await expect(
    component.locator('[data-testid="mediaPlayer-controls"]'),
  ).not.toBeAttached();
  await expect(
    component.locator('[data-testid="mediaPlayer-playPause"]'),
  ).not.toBeAttached();
});

test("default playback is 'once' when no controls or syncToStageTime", async ({
  mount,
  page,
}) => {
  // No playback, no controls, no syncToStageTime — should behave like "once"
  await page.route("**/blocked.mp4", (route) => route.abort());

  const component = await mount(
    <MockMediaPlayer url="/blocked.mp4" name="test" />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');

  // Reject .play(), set duration, fire loadedmetadata — all in one evaluate
  await video.evaluate((el) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any).play = () =>
      Promise.reject(new DOMException("NotAllowedError"));
    Object.defineProperty(el, "duration", {
      get: () => 60,
      configurable: true,
    });
    el.dispatchEvent(new Event("loadedmetadata"));
  });

  // Should show the play-once button (proving "once" is the default)
  await expect(
    component.locator('[data-testid="mediaPlayer-playOnce"]'),
  ).toBeVisible();
});

// ----------- UI polish: container focus ring -----------
//
// The MediaPlayer container is `tabIndex={0}` so keyboard shortcuts
// (Space play/pause, J/L scrub, K toggle, etc.) become live once
// focused. Pre-polish: no replacement for the browser default
// outline — platform-dependent (Chromium blue, Safari light,
// Firefox dotted) and visually inconsistent with the Timeline
// container's `:focus` ring. Polish: useId-scoped `:focus` ring
// matching the Timeline pattern. Fires on both Tab and click so
// the affordance is identical across input modalities.

test("polish: container shows focus ring on keyboard focus (Tab)", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="ring_kbd" />,
  );
  const mp = component.locator('[data-testid="mediaPlayer"]');
  const baseline = await mp.evaluate((el) => getComputedStyle(el).boxShadow);
  await page.keyboard.press("Tab");
  await expect(mp).toBeFocused();
  await expect
    .poll(() => mp.evaluate((el) => getComputedStyle(el).boxShadow), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});

test("polish: container shows focus ring on mouse / programmatic focus too", async ({
  mount,
}) => {
  // Uses `:focus` (not `:focus-visible`) for the same reason the
  // Timeline does: keyboard shortcuts go live whether you got
  // there by click or by Tab, so the affordance has to match.
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="ring_mouse" />,
  );
  const mp = component.locator('[data-testid="mediaPlayer"]');
  const baseline = await mp.evaluate((el) => getComputedStyle(el).boxShadow);
  await mp.focus();
  await expect(mp).toBeFocused();
  await expect
    .poll(() => mp.evaluate((el) => getComputedStyle(el).boxShadow), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});

test("polish: focus ring stays when an interior control takes focus (focus-within)", async ({
  mount,
}) => {
  // The MediaPlayer uses `:focus-within` rather than `:focus` so
  // the ring persists while a descendant (play button, scrubber,
  // step button, etc.) has focus. Without this, the ring would
  // flicker out the moment the user clicks a control — but the
  // user is still "in" the MediaPlayer, just delegating to a
  // sub-control, so the affordance should stay.
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="ring_within"
      controls={{ playPause: true }}
    />,
  );
  // Trigger loadedmetadata so the controls render.
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => {
      Object.defineProperty(el, "duration", {
        get: () => 60,
        configurable: true,
      });
      el.dispatchEvent(new Event("loadedmetadata"));
    });
  const mp = component.locator('[data-testid="mediaPlayer"]');

  // Focus the container first; capture the ring's box-shadow.
  await mp.focus();
  const withContainerFocus = await mp.evaluate(
    (el) => getComputedStyle(el).boxShadow,
  );
  expect(withContainerFocus).not.toBe("none");

  // Now move focus into a descendant button. The container's
  // :focus is gone but :focus-within is still active, so the ring
  // should remain.
  const playBtn = component.locator('[data-testid="mediaPlayer-playPause"]');
  await expect(playBtn).toBeVisible();
  await playBtn.focus();
  await expect(playBtn).toBeFocused();
  const withDescendantFocus = await mp.evaluate(
    (el) => getComputedStyle(el).boxShadow,
  );
  expect(withDescendantFocus).toBe(withContainerFocus);
});

test("polish: container has scoped focus class (visible to consumers)", async ({
  mount,
}) => {
  // The useId-scoped class is part of the public DOM contract for
  // tests / debug tooling. Lock in the prefix so a future refactor
  // doesn't silently rename it.
  const component = await mount(
    <MockMediaPlayer url="/sample-video.mp4" name="ring_class" />,
  );
  const className = await component
    .locator('[data-testid="mediaPlayer"]')
    .evaluate((el) => el.className);
  expect(className).toContain("stagebook-mediaplayer-");
});

// -- #300: focus survives controls auto-hide --

test("focus moves to container when the focused control unmounts on mouse-leave", async ({
  mount,
  page,
}) => {
  // Repro: user toggles play/pause via keyboard so the button is the
  // active element, then the mouse leaves the player. The controls
  // overlay unmounts while playing, the focused button goes with it,
  // and a follow-up Space keypress lands on <body> and scrolls the
  // page instead of pausing the video. The fix watches for that
  // exact transition (controls visible → hidden with activeElement
  // orphaned to <body>) and refocuses the container, which is always
  // mounted and tabbable.
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ playPause: true }}
    />,
  );
  const mp = component.locator('[data-testid="mediaPlayer"]');
  const playBtn = component.locator('[data-testid="mediaPlayer-playPause"]');

  // 1. Hover the player (real mouse — React's onMouseLeave is driven
  //    from delegated mouseout, so a synthetic dispatch wouldn't fire
  //    it). Then focus the play button as if reached by keyboard.
  await mp.hover();
  await playBtn.focus();
  await expect(playBtn).toBeFocused();

  // 2. Start playback by dispatching the video's play event directly.
  //    The MockMediaPlayer wires onPlay through, flipping isPaused=false.
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("play")));

  // 3. Move the mouse off the player. With isPaused=false and
  //    isHovered=false, controlsVisible flips false and the controls
  //    overlay unmounts — taking the focused play/pause button with it.
  await page.mouse.move(0, 0);

  // Controls really did unmount (sanity check).
  await expect(playBtn).not.toBeAttached();

  // 4. The container should now hold focus — not <body>. The keydown
  //    handler is attached here, so Space will still pause the video.
  await expect(mp).toBeFocused();
});

test("focus is left alone when activeElement is somewhere else entirely", async ({
  mount,
  page,
}) => {
  // The rescue should ONLY fire when focus orphaned to <body>. If the
  // user deliberately moved focus elsewhere (tabbed to another input,
  // clicked a different control), we must not yank it back.
  const component = await mount(
    <div>
      <MockMediaPlayer
        url={FIXTURE_VIDEO}
        name="test"
        controls={{ playPause: true }}
      />
      <input data-testid="other-input" />
    </div>,
  );
  const mp = component.locator('[data-testid="mediaPlayer"]');
  const playBtn = component.locator('[data-testid="mediaPlayer-playPause"]');
  const other = component.locator('[data-testid="other-input"]');

  await mp.hover();
  await playBtn.focus();
  await component
    .locator('[data-testid="mediaPlayer-video"]')
    .evaluate((el) => el.dispatchEvent(new Event("play")));

  // User moves focus to the other input BEFORE controls hide.
  await other.focus();
  await expect(other).toBeFocused();

  // Now trigger controls hide via real mouse-leave.
  await page.mouse.move(0, 0);

  // Focus should stay on the other input, not get stolen.
  await expect(other).toBeFocused();
});
