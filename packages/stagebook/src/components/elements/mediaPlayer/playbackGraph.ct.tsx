/**
 * MediaPlayer's playback routing, rendered offline in real browsers (#663).
 *
 * Participant channels are discrete, not speaker positions: every one must
 * reach both ears at every channel count, and muting one must remove only
 * that participant.
 */
import { test, expect } from "@playwright/experimental-ct-react";
import {
  PlaybackGraphHarness,
  type PlaybackGraphMeasurement,
} from "../../testing/PlaybackGraphHarness.js";

const COUNTS = [2, 3, 4, 5, 6, 7, 8];

// Float32 rendering of sums of tenths.
const PRECISION = 5;

test("every channel reaches both ears at its 1/N share, and mute removes only that share", async ({
  mount,
}) => {
  const component = await mount(<PlaybackGraphHarness counts={COUNTS} />);
  const output = component.getByTestId("graph-result");
  await expect(output).not.toBeEmpty();
  const measured = JSON.parse(
    (await output.textContent()) ?? "",
  ) as PlaybackGraphMeasurement[];

  expect(measured.map((m) => m.channels)).toEqual(COUNTS);
  for (const { channels, levels, all, muted } of measured) {
    const sum = levels.reduce((a, b) => a + b, 0);
    const at = `${channels} channels`;
    expect(all.left, `${at}, left`).toBeCloseTo(sum / channels, PRECISION);
    expect(all.right, `${at}, right`).toBeCloseTo(sum / channels, PRECISION);
    for (const [j, ears] of muted.entries()) {
      const expected = (sum - levels[j]) / channels;
      const where = `${at}, channel ${j} muted`;
      expect(ears.left, `${where}, left`).toBeCloseTo(expected, PRECISION);
      expect(ears.right, `${where}, right`).toBeCloseTo(expected, PRECISION);
    }
  }
});
