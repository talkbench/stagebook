import {
  test,
  expect,
  type MountResult,
} from "@playwright/experimental-ct-react";
import { GroupRecordingHarness } from "../testing/GroupRecordingHarness.js";
import { invalidMappings } from "../../audioProbe/testing/invalidMappings.js";

test.setTimeout(60_000);
test("hidden waveforms preserve ordinary mono playback level", async ({
  mount,
}) => {
  const c = await mount(
    <GroupRecordingHarness count={1} ordinary skipProbe showWaveform={false} />,
  );
  await c.getByRole("button", { name: "Start session" }).click();
  await c.getByRole("button", { name: "Play recording", exact: true }).click();
  // Sine amplitude 1/16 -> DFT power A²/4. Running the two-channel
  // waveform mix here by mistake halves amplitude (quarters this power).
  await expect
    .poll(async () => (await measure(c)).powers[0])
    .toBeGreaterThan(0.0006);
  await expect(c.getByTestId("group-errors")).toHaveText("[]");
});
for (const [index, mapping] of invalidMappings.entries()) {
  // Undefined declares ordinary media at the renderer; hosts catch omitted
  // group sidecars with checkChannelLayout, and the count backstop covers >2.
  if (mapping === undefined) continue;
  test(`malformed mapping ${index} is refused without Timeline writes`, async ({
    mount,
  }) => {
    const c = await mount(
      <GroupRecordingHarness skipProbe mappingOverride={mapping} />,
    );
    await c.getByRole("button", { name: "Start session" }).click();
    await expect(c.getByTestId("mediaPlayer-channel-error")).toBeVisible();
    await expect(c.getByTestId("mediaPlayer-video")).toHaveCount(0);
    await expect(c.getByTestId("timeline")).toHaveCount(0);
    await expect(c.getByTestId("group-errors")).not.toHaveText("[]");
    await expect(c.getByTestId("group-saves")).toHaveText("[]");
  });
}

test("refusal uses the host locale without exposing participant positions", async ({
  mount,
}) => {
  const c = await mount(<GroupRecordingHarness skipProbe locale="he" />);
  await c.getByRole("button", { name: "Start session" }).click();
  await expect(c.getByTestId("mediaPlayer-channel-error")).toContainText(
    "צוות המחקר",
  );
  await expect(c.getByTestId("mediaPlayer-channel-error")).toHaveAttribute(
    "dir",
    "rtl",
  );
});
type Measurement = {
  peaks: number[];
  powers: number[];
  tracks: { position: number }[];
};
async function measure(component: MountResult): Promise<Measurement> {
  await component
    .getByRole("button", { name: "Measure audio", exact: true })
    .click();
  return JSON.parse(
    (await component.getByTestId("audio-measurement").textContent())!,
  ) as Measurement;
}

test("real breakout audio, per-speaker mute, position selections and restoration", async ({
  mount,
  browserName,
  page,
}) => {
  const c = await mount(<GroupRecordingHarness />);
  await c.getByRole("button", { name: "Start session" }).click();
  await expect(c.getByTestId("session-probe")).not.toBeEmpty({
    timeout: 35_000,
  });
  if (browserName === "webkit" && process.platform === "darwin") {
    await expect(c.getByTestId("mediaPlayer-channel-error")).toBeVisible();
    await expect(c.getByTestId("timeline")).toHaveCount(0);
    return;
  }
  await expect(c.getByTestId("track-label")).toHaveText(["Track 1", "Track 2"]);
  await c.getByRole("button", { name: "Play recording", exact: true }).click();
  await expect
    .poll(async () => (await measure(c)).peaks.filter((v) => v > 0.03).length)
    .toBe(2);
  const before = await measure(c);
  expect(before.tracks.map((t) => t.position)).toEqual([0, 5]);
  // File channel 1 has twice channel 0's amplitude. Position 0 is source 1.
  expect(before.peaks[0]).toBeCloseTo(0.125, 1);
  expect(before.peaks[1]).toBeCloseTo(0.0625, 1);
  await c.getByTestId("track-mute").nth(1).click();
  await expect
    .poll(async () => {
      const m = await measure(c);
      return m.powers[0] / m.powers[1];
    })
    .toBeLessThan(0.01);
  await c.getByRole("button", { name: "Pause recording", exact: true }).click();
  const box = await c.getByTestId("selection-overlay").boundingBox();
  if (!box) throw new Error("Missing selection overlay");
  await page.mouse.click(box.x + box.width / 2, box.y + 72);
  await expect
    .poll(async () => {
      const saves = JSON.parse(
        (await c.getByTestId("group-saves").textContent())!,
      ) as { key: string; value: unknown }[];
      return saves.filter((s) => s.key === "timeline_marks").at(-1)?.value;
    })
    .toEqual([{ time: expect.any(Number), position: 5 }]);
  await c.getByRole("button", { name: "Reload recording" }).click();
  await expect(c.getByTestId("point-0")).toBeVisible();
  const point = await c.getByTestId("point-0").boundingBox();
  const restoredBox = await c.getByTestId("selection-overlay").boundingBox();
  expect(point!.y - restoredBox!.y).toBeGreaterThanOrEqual(48);
  expect(point!.y - restoredBox!.y).toBeLessThan(96);
  await expect(c.getByTestId("group-errors")).toHaveText("[]");
});

test("one session uses its own calibration at 3, 6 and 8 channels", async ({
  mount,
  browserName,
}) => {
  const c = await mount(<GroupRecordingHarness count={3} />);
  await c.getByRole("button", { name: "Start session" }).click();
  await expect(c.getByTestId("session-probe")).not.toBeEmpty({
    timeout: 35_000,
  });
  if (browserName === "webkit" && process.platform === "darwin") {
    await expect(c.getByTestId("mediaPlayer-channel-error")).toBeVisible();
    return;
  }
  for (const count of [3, 6, 8]) {
    await c.getByRole("button", { name: `Load ${count} channels` }).click();
    await expect(c.getByTestId("track-label")).toHaveCount(count);
    await c
      .getByRole("button", { name: "Play recording", exact: true })
      .click();
    await expect
      .poll(async () => (await measure(c)).peaks.filter((v) => v > 0.03).length)
      .toBe(count);
    const result = await measure(c);
    for (let row = 0; row < count; row++) {
      expect(result.peaks[row]).toBeCloseTo((count - row) / 16, 1);
    }
  }
});

test("solo participant works without calibration", async ({ mount }) => {
  const c = await mount(
    <GroupRecordingHarness count={1} positions={[5]} skipProbe />,
  );
  await c.getByRole("button", { name: "Start session" }).click();
  await expect(c.getByTestId("track-label")).toHaveText(["Track 1"]);
  await c.getByRole("button", { name: "Play recording", exact: true }).click();
  await expect
    .poll(async () => (await measure(c)).peaks[0])
    .toBeGreaterThan(0.03);
  await expect(c.getByTestId("group-errors")).toHaveText("[]");
});

test("missing calibration refuses before rendering and reports through host hook", async ({
  mount,
}) => {
  const c = await mount(<GroupRecordingHarness skipProbe />);
  await c.getByRole("button", { name: "Start session" }).click();
  await expect(c.getByTestId("mediaPlayer-channel-error")).toBeVisible();
  await expect(c.getByTestId("mediaPlayer-video")).toHaveCount(0);
  await expect(c.getByTestId("timeline")).toHaveCount(0);
  await expect(c.getByTestId("group-errors")).toContainText('"code":"probe"');
  await expect(c.getByTestId("group-saves")).toHaveText("[]");
});

test("unmapped multichannel audio is refused even with hidden waveforms", async ({
  mount,
  browserName,
}) => {
  // macOS WebKit plays the 2-channel AAC mix; the host must catch this case.
  test.skip(
    browserName === "webkit" && process.platform === "darwin",
    "Fallback mix is indistinguishable from ordinary stereo by count",
  );
  const c = await mount(
    <GroupRecordingHarness count={3} ordinary skipProbe showWaveform={false} />,
  );
  await c.getByRole("button", { name: "Start session" }).click();
  await c.getByRole("button", { name: "Play recording", exact: true }).click();
  await expect(c.getByTestId("mediaPlayer-channel-error")).toBeVisible();
  await expect(c.getByTestId("timeline")).toHaveCount(0);
  await expect(c.getByTestId("group-errors")).toContainText('"code":"count"');
  await expect(c.getByTestId("group-saves")).not.toContainText(
    "timeline_marks",
  );
});
