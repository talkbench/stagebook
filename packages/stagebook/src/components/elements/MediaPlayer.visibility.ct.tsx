import { test, expect } from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../testing/MockMediaPlayer.js";
import type { VideoPlaybackRecord } from "../../schemas/mediaPlayerRecord.js";

test("native playback resumes visibility accounting after a buffered seek", async ({
  mount,
  page,
}) => {
  // Control only the telemetry clock/page-state reading. Playback, decoding,
  // seeking, and their native events remain real browser behavior.
  await page.evaluate(() => {
    document.documentElement.dataset.visibilityClock = "0";
    Object.defineProperty(performance, "now", {
      configurable: true,
      value: () => Number(document.documentElement.dataset.visibilityClock),
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
  });
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="visibility"
      playAudio={false}
      playback="manual"
      controls={{ playPause: true, seek: true }}
    />,
  );
  const video = component.getByTestId("mediaPlayer-video");
  const readSaves = async () =>
    JSON.parse(
      (await component.getByTestId("save-log").textContent()) ?? "[]",
    ) as Array<{ value: VideoPlaybackRecord }>;
  await video.evaluate(async (element: HTMLVideoElement) => {
    await element.play();
  });
  await expect.poll(async () => (await readSaves()).length).toBe(1);
  // Safari may preload metadata only until playback is requested.
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) =>
        element.buffered.length > 0
          ? element.buffered.end(element.buffered.length - 1)
          : 0,
      ),
    )
    .toBeGreaterThan(3);
  await video.evaluate((element: HTMLVideoElement) => {
    let seeking = false;
    let seekedPosition: number | null = null;
    const events: Array<{
      type: string;
      readyState: number;
      seeking: boolean;
    }> = [];
    element.dataset.seekEvents = "[]";
    for (const type of [
      "seeking",
      "seeked",
      "waiting",
      "canplay",
      "playing",
      "timeupdate",
    ]) {
      element.addEventListener(type, () => {
        if (type === "seeking") seeking = true;
        if (type === "seeked") seekedPosition = element.currentTime;
        if (
          type === "timeupdate" &&
          seekedPosition !== null &&
          !element.seeking &&
          element.currentTime > seekedPosition
        )
          element.dataset.advancedAfterSeek = "true";
        if (seeking) {
          events.push({
            type,
            readyState: element.readyState,
            seeking: element.seeking,
          });
          element.dataset.seekEvents = JSON.stringify(events);
        }
      });
    }
    // Isolate the backend's seek lifecycle from Stagebook's transport logging.
    element.currentTime = 2;
  });
  await expect
    .poll(() => video.getAttribute("data-seek-events"))
    .toContain("seeked");
  // WebKit can resume without playing/canplay. Wait for the native timeupdate
  // observation of advancing media, not only a getter between queued events.
  await expect
    .poll(() => video.getAttribute("data-advanced-after-seek"))
    .toBe("true");
  expect((await readSaves()).length).toBe(1);
  await page.evaluate(() => {
    document.documentElement.dataset.visibilityClock = "5000";
  });
  await video.evaluate((element: HTMLVideoElement) => element.pause());
  await expect.poll(async () => (await readSaves()).length).toBe(2);
  const record = (await readSaves()).at(-1)!.value;
  expect(
    record.hiddenPlaybackSeconds,
    await video.getAttribute("data-seek-events"),
  ).toBe(5);
  expect(record.visibilityChangesDuringPlayback).toBe(0);
});
