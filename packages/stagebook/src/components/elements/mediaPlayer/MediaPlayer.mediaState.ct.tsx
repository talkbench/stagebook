import { test, expect, type Locator } from "@playwright/experimental-ct-react";
import { MockMediaPlayer } from "../../testing/MockMediaPlayer.js";
import { GroupRecordingHarness } from "../../testing/GroupRecordingHarness.js";
import type { VideoPlaybackRecord } from "../../../schemas/mediaPlayerRecord.js";

async function records(
  component: Locator,
  testId = "save-log",
  key = "mediaPlayer_clip",
): Promise<VideoPlaybackRecord[]> {
  const log = JSON.parse(
    (await component.getByTestId(testId).textContent()) ?? "[]",
  ) as { key: string; value: VideoPlaybackRecord }[];
  return log.filter((entry) => entry.key === key).map((entry) => entry.value);
}

async function ready(component: Locator) {
  const video = component.getByTestId("mediaPlayer-video");
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  return video;
}

test("real playback records native mute and volume settings on the existing play save", async ({
  mount,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="clip"
      playback="manual"
      autoplay={false}
      playAudio={false}
      controls={{ playPause: true }}
    />,
  );
  const video = await ready(component);
  await video.evaluate((element: HTMLVideoElement) => {
    element.volume = 0.35;
  });
  expect(await records(component)).toHaveLength(0);
  await component.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await records(component)).length).toBe(1);
  expect((await records(component))[0].firstPlay).toMatchObject({
    type: "play",
    muted: true,
    volume: 0.35,
  });
  await component.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await records(component)).length).toBe(2);
});

test("native volume slider changes coalesce and wait for the existing pause save", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockMediaPlayer
      url="/sample-video.mp4"
      name="clip"
      playback="manual"
      autoplay={false}
      controls={{ playPause: true }}
    />,
  );
  const video = await ready(component);
  await component.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await records(component)).length).toBe(1);
  const first = (await records(component))[0];
  const firstSerialized = JSON.stringify(first);
  await video.evaluate(async (element: HTMLVideoElement) => {
    element.muted = true;
    for (const value of [0.9, 0.7, 0.5, 0.4, 0.25]) {
      element.volume = value;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  });
  // Settling changes only in-memory telemetry; native volume events are real.
  await page.waitForTimeout(600);
  expect(await records(component)).toHaveLength(1);
  await component.getByTestId("mediaPlayer-playPause").click();
  await expect.poll(async () => (await records(component)).length).toBe(2);
  const saved = await records(component);
  const changes = saved[1].events.filter(
    (event) => event.type === "volumechange",
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ muted: true, volume: 0.25 });
  expect(saved[1].events.at(-1)?.type).toBe("pause");
  expect(JSON.stringify(saved[0])).toBe(firstSerialized);
});

test("a real channel mute is observed without adding a host save", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <GroupRecordingHarness count={1} positions={[5]} skipProbe />,
  );
  await component.getByRole("button", { name: "Start session" }).click();
  await ready(component);
  await component
    .getByRole("button", { name: "Play recording", exact: true })
    .click();
  const read = () => records(component, "group-saves", "mediaPlayer_recording");
  await expect
    .poll(async () => (await read()).at(-1)?.events.at(-1)?.type)
    .toBe("play");
  const before = await read();
  // Graph initialization can report previously unknown channel settings.
  // The participant's mute adds one observation beyond that saved baseline.
  const initialChanges = before
    .at(-1)!
    .events.filter((event) => event.type === "volumechange").length;
  await component.getByTestId("track-mute").click();
  await page.waitForTimeout(600);
  expect(await read()).toHaveLength(before.length);
  await component
    .getByRole("button", { name: "Pause recording", exact: true })
    .click();
  await expect.poll(async () => (await read()).length).toBe(before.length + 1);
  const saved = (await read()).at(-1)!;
  const changes = saved.events.filter((event) => event.type === "volumechange");
  expect(changes).toHaveLength(initialChanges + 1);
  expect(changes.at(-1)).toMatchObject({ channelMuted: [true] });
  expect(saved.events.at(-1)?.type).toBe("pause");
  expect((await read()).slice(0, before.length)).toEqual(before);
});
