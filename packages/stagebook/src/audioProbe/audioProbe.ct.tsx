/**
 * Channel-order probe, end to end in real browsers (#663).
 *
 * Every task starts from a real Playwright click — no autoplay flags — so
 * the browser's own gesture rules apply, as they will for a host calling the
 * probe from its start-session click. Fixtures are served by Vite from
 * /public/audio-probe (see generate.sh there).
 */
import {
  test,
  expect,
  type MountResult,
} from "@playwright/experimental-ct-react";
import { ProbeHarness, type ToneMeasurement } from "./testing/ProbeHarness.js";
import type { ChannelProbeResult } from "./probe.js";

const COUNTS = [2, 3, 4, 5, 6, 7, 8];

const media = (prefix: string) =>
  COUNTS.map((channels) => ({
    channels,
    url: `/audio-probe/${prefix}_${channels}ch.mp4`,
  }));

/** Fixtures probed in place of calibration assets; they have no hash. */
const fixtureAssets = (prefix: string) =>
  media(prefix).map((m) => ({
    ...m,
    artifactId: `${prefix}_${m.channels}ch`,
    sha256: "",
  }));

async function runTask<T>(
  component: MountResult,
  button: string,
  testId: string,
): Promise<T> {
  await component.getByRole("button", { name: button }).click();
  const output = component.getByTestId(testId);
  await expect(output).not.toBeEmpty({ timeout: 20_000 });
  const json = (await output.textContent()) ?? "";
  // Kept with the test's report, so a failure in CI shows what was measured.
  await test.info().attach(testId, {
    body: json,
    contentType: "application/json",
  });
  return JSON.parse(json) as T;
}

/**
 * Which source tone dominates each decoded channel, or null if any channel
 * is ambiguous (silent, or its strongest tone not 10x its next).
 */
function toneOrder(m: ToneMeasurement): number[] | null {
  if (!m.powers) return null;
  const order: number[] = [];
  for (const powers of m.powers) {
    const ranked = powers
      .map((p, source) => ({ p, source }))
      .sort((a, b) => b.p - a.p);
    if (ranked[0].p <= 0) return null;
    if (ranked.length > 1 && ranked[0].p < 10 * ranked[1].p) return null;
    order.push(ranked[0].source);
  }
  return order;
}

test.describe("channel-order probe", () => {
  test.setTimeout(60_000);

  test("Chromium and Firefox pass, and a passing verdict's mappings are the order tone recordings play in", async ({
    mount,
    browserName,
  }) => {
    const component = await mount(<ProbeHarness toneAssets={media("tone")} />);
    const probe = await runTask<ChannelProbeResult>(
      component,
      "Probe calibration assets",
      "shipped-result",
    );

    expect(Object.keys(probe.mappings).map(Number)).toEqual(COUNTS);
    for (const channels of COUNTS) {
      expect(probe.mappings[channels] === null, `${channels} channels`).toBe(
        probe.detail[channels].failure !== null,
      );
    }
    if (browserName !== "webkit") {
      for (const channels of COUNTS) {
        expect(
          probe.detail[channels].failure,
          `${channels} channels`,
        ).toBeNull();
      }
      expect(probe.verdict).toBe("pass");
    }
    // WebKit fails on macOS (see below). On Linux, without an audio device,
    // its captures are truncated and the verdict varies; whatever it is, a
    // pass has to be right.
    if (probe.verdict !== "pass") return;

    const tones = await runTask<ToneMeasurement[]>(
      component,
      "Measure tones",
      "tone-result",
    );
    for (const [i, channels] of COUNTS.entries()) {
      const measured = toneOrder(tones[i]);
      expect(measured, `tone order at ${channels} channels`).not.toBeNull();
      expect(probe.mappings[channels], `${channels} channels`).toEqual(
        measured,
      );
    }
  });

  test("WebKit on macOS fails at every count", async ({
    mount,
    browserName,
  }) => {
    test.skip(
      browserName !== "webkit" || process.platform !== "darwin",
      "WebKit on macOS only",
    );
    const component = await mount(<ProbeHarness />);
    const probe = await runTask<ChannelProbeResult>(
      component,
      "Probe calibration assets",
      "shipped-result",
    );
    // It plays the stereo AAC fallback in place of the Opus track: two
    // channels carrying the tone, no markers. Each asset plays to its end
    // and is rejected for what it carried, not for failing to play.
    expect(probe.verdict).toBe("fail");
    for (const channels of COUNTS) {
      const at = `${channels} channels`;
      expect(probe.mappings[channels], at).toBeNull();
      expect(probe.detail[channels].report, at).not.toBeNull();
      expect(probe.detail[channels].report?.inputChannels, at).toBe(2);
    }
  });

  test("a browser that mixes in the fallback track fails at every count", async ({
    mount,
    browserName,
  }) => {
    const component = await mount(
      <ProbeHarness probeAssets={fixtureAssets("sim_mixed")} />,
    );
    const probe = await runTask<ChannelProbeResult>(
      component,
      "Probe fixtures",
      "fixture-result",
    );
    expect(probe.verdict).toBe("fail");
    for (const channels of COUNTS) {
      expect(probe.mappings[channels], `${channels} channels`).toBeNull();
      // WebKit can't run this check: on macOS it can't play an Opus-only
      // MP4 at all, and on Linux its captures are truncated.
      if (browserName === "webkit") continue;
      expect(
        probe.detail[channels].failure?.reason,
        `${channels} channels`,
      ).toBe("extra-signal");
    }
  });
});
