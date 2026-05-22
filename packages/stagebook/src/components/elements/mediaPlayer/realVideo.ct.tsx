/**
 * Real-video integration tests for MediaPlayer.
 *
 * These tests load an actual MP4 file via the Vite dev server (which DOES
 * advertise Accept-Ranges: bytes) and exercise seek/step behavior end-to-end.
 *
 * They cover the full pipeline: browser fetch → decode → seek → timeupdate,
 * which is the layer where the bug from issue #32 actually lives.
 */
import { test, expect } from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../../testing/MockMediaPlayer.js";

// Served by Vite from /public — see playwright-ct.config.ts.
const FIXTURE_VIDEO = "/sample-video.mp4";

test("real video: loadedmetadata fires and duration is set", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ playPause: true, seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  const duration = await video.evaluate((el: HTMLVideoElement) => el.duration);
  expect(duration).toBeGreaterThan(0);
  expect(Number.isFinite(duration)).toBe(true);
});

test("real video: clicking seekForward advances currentTime by 1s", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  // Wait for metadata
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);

  await component.locator('[data-testid="mediaPlayer-seekForward"]').click();
  // Wait for the seek to settle (browser fires seeked event)
  await expect
    .poll(async () =>
      video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime)),
    )
    .toBe(1);
});

test("real video: clicking seekForward twice then seekBack returns to 1s", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ seek: true }}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);

  await component.locator('[data-testid="mediaPlayer-seekForward"]').click();
  await expect
    .poll(async () =>
      video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime)),
    )
    .toBe(1);

  await component.locator('[data-testid="mediaPlayer-seekForward"]').click();
  await expect
    .poll(async () =>
      video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime)),
    )
    .toBe(2);

  await component.locator('[data-testid="mediaPlayer-seekBack"]').click();
  await expect
    .poll(async () =>
      video.evaluate((el: HTMLVideoElement) => Math.round(el.currentTime)),
    )
    .toBe(1);
});

test("real video: stepForward advances by stepDuration", async ({ mount }) => {
  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ step: true }}
      stepDuration={0.5}
    />,
  );
  const video = component.locator('[data-testid="mediaPlayer-video"]');
  await expect
    .poll(async () => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThanOrEqual(1);

  await component.locator('[data-testid="mediaPlayer-stepForward"]').click();
  await expect
    .poll(async () =>
      video.evaluate((el: HTMLVideoElement) => el.currentTime > 0),
    )
    .toBe(true);
});

// -- Server-side range-request misconfiguration ----------------------------
//
// Reproduces the bug from issue #32: when the asset server returns 200 OK with
// the full body and NO Accept-Ranges header, browsers reject any seek by
// silently snapping currentTime back to 0. Stagebook's seek() correctly assigns
// currentTime; the browser undoes it. Stagebook should detect this and warn so
// integrators don't waste time debugging the wrong layer.

// -- Load failure fallback --------------------------------------------------

test("renders an error placeholder when the video fails to load", async ({
  mount,
}) => {
  // Point at a URL that will 404 — Vite serves nothing under /missing/.
  const component = await mount(
    <MockMediaPlayer
      url="/missing/no-such-video.mp4"
      name="test"
      controls={{ playPause: true, seek: true }}
    />,
  );
  const error = component.locator('[data-testid="mediaPlayer-error"]');
  await expect(error).toBeVisible();
  await expect(error).toContainText("Video unavailable");
  // Controls should be hidden when load fails
  await expect(
    component.locator('[data-testid="mediaPlayer-controls"]'),
  ).toHaveCount(0);
});

test("audio-only renders an error placeholder when the audio fails to load", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/missing/no-such-audio.mp4"
      name="test"
      playVideo={false}
      controls={{ playPause: true, seek: true }}
    />,
  );
  const error = component.locator('[data-testid="mediaPlayer-error"]');
  await expect(error).toBeVisible();
  await expect(error).toContainText("Audio unavailable");
});

test("stagebook surfaces the problem when server doesn't advertise Accept-Ranges", async ({
  mount,
  page,
}) => {
  // Intercept the fixture and strip Accept-Ranges from the response.
  // Stagebook surfaces the problem to the researcher via two paths:
  //
  // 1. **Pre-flight HEAD warning** (#424): on mount, MediaPlayer
  //    issues a HEAD on the URL and inspects the response's
  //    `Accept-Ranges` header. Missing or "none" → console warning.
  //    This is the authoritative signal and fires across every
  //    engine since it reads headers directly.
  //
  // 2. **loadedmetadata-derived warning** (#32): a fallback for cases
  //    where the HEAD couldn't be read (CORS, network failure, server
  //    doesn't support HEAD). Checks `v.seekable` after metadata
  //    loads; fires on Chrome which reports seekable.length=0.
  //
  // Plus, on macOS Safari the video element refuses to load entirely
  // without Accept-Ranges → user sees the "Video unavailable" error
  // overlay. The test accepts either the warning OR the error overlay
  // — both communicate the problem.
  //
  // Closes #424.
  await page.route("**/sample-video.mp4", async (route) => {
    const response = await route.fetch();
    const body = await response.body();
    const headers = { ...response.headers() };
    delete headers["accept-ranges"];
    delete headers["content-range"];
    await route.fulfill({
      status: 200,
      headers,
      body,
    });
  });

  const warnings: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "warning") warnings.push(msg.text());
  });

  const component = await mount(
    <MockMediaPlayer
      url={FIXTURE_VIDEO}
      name="test"
      controls={{ seek: true }}
    />,
  );

  const errorEl = component.locator('[data-testid="mediaPlayer-error"]');

  // Either the chromium-path warning fires OR the webkit/firefox-path
  // error overlay appears. Polling lets whichever engine surface its
  // signal first; we don't care which — just that the researcher sees
  // a clear indicator.
  await expect
    .poll(
      async () => {
        const sawWarning = warnings.some((m) => m.includes("Accept-Ranges"));
        const sawError = await errorEl.isVisible().catch(() => false);
        return sawWarning || sawError;
      },
      { timeout: 5000 },
    )
    .toBe(true);
});
