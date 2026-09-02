import { test, expect, type Locator } from "@playwright/experimental-ct-react";
import { MockWaveformTimeline } from "../../testing/MockWaveformTimeline.js";

// Interleaved min/max peaks for 8 buckets: a loud middle, quiet edges.
const LOUD_MIDDLE = [
  -0.05, 0.05, -0.1, 0.1, -0.8, 0.8, -0.9, 0.9, -0.85, 0.85, -0.6, 0.6, -0.1,
  0.1, -0.05, 0.05,
];

// Sentinel-only peaks (min=1, max=-1): allocated but nothing captured yet.
const EMPTY_PEAKS = Array.from({ length: 16 }, (_, i) =>
  i % 2 === 0 ? 1 : -1,
);

const PLAYHEAD = '[data-testid="waveform-timeline-playhead"]';

/**
 * Pixel census of the waveform canvas. Bars are fully opaque; the track band
 * behind them is translucent (alpha 0.15); untouched pixels are transparent.
 * A test asserting "no bars" must also see the band, or a canvas that was
 * never drawn on would pass for the wrong reason.
 */
function pixelCensus(
  canvas: Locator,
): Promise<{ opaque: number; translucent: number }> {
  return canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext("2d");
    if (!ctx) return { opaque: -1, translucent: -1 };
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let opaque = 0;
    let translucent = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 255) opaque += 1;
      else if (data[i] > 0) translucent += 1;
    }
    return { opaque, translucent };
  });
}

function opaquePixels(canvas: Locator): Promise<number> {
  return pixelCensus(canvas).then(({ opaque }) => opaque);
}

function playheadLeft(playhead: Locator): Promise<number> {
  return playhead.evaluate((el) => parseFloat((el as HTMLElement).style.left));
}

test("renders an image role carrying the given label", async ({ mount }) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Recording amplitude timeline"
      duration={8}
      currentTime={null}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  const timeline = component.getByRole("img", {
    name: "Recording amplitude timeline",
  });
  await expect(timeline).toBeAttached();
  await expect(
    timeline.locator('[data-testid="waveform-canvas"]'),
  ).toBeAttached();
});

test("hides the playhead when currentTime is null", async ({ mount }) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={null}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  await expect(component.locator(PLAYHEAD)).toHaveCount(0);
});

test("hides the playhead when the duration is not positive", async ({
  mount,
}) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={0}
      currentTime={2}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  await expect(component.locator(PLAYHEAD)).toHaveCount(0);
});

test("positions the playhead at currentTime / duration of the measured width", async ({
  mount,
}) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={2}
      width={400}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  const timeline = component.locator('[data-testid="waveform-timeline"]');
  const playhead = component.locator(PLAYHEAD);
  await expect(playhead).toBeAttached();
  const contentWidth = await timeline.evaluate((el) => el.clientWidth);
  expect(contentWidth).toBeGreaterThan(300);
  expect(await playheadLeft(playhead)).toBeCloseTo(contentWidth * 0.25, 1);

  await component.update(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={6}
      width={400}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  await expect
    .poll(() => playheadLeft(playhead))
    .toBeCloseTo(contentWidth * 0.75, 1);
});

test("clamps the playhead inside the track past the end", async ({ mount }) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={9.5}
      width={400}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  const timeline = component.locator('[data-testid="waveform-timeline"]');
  const contentWidth = await timeline.evaluate((el) => el.clientWidth);
  const left = await playheadLeft(component.locator(PLAYHEAD));
  expect(left).toBeCloseTo(contentWidth, 1);
});

test("paints the playhead with the --stagebook-playhead token", async ({
  mount,
}) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={4}
      playheadColor="rgb(1, 2, 3)"
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  await expect(component.locator(PLAYHEAD)).toHaveCSS(
    "background-color",
    "rgb(1, 2, 3)",
  );
});

test("redraws the waveform when peaks arrive under a bumped peaksVersion", async ({
  mount,
}) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={null}
      mockPeaks={EMPTY_PEAKS}
    />,
  );
  const canvas = component.locator('[data-testid="waveform-canvas"]');
  await expect(canvas).toBeAttached();
  // Sentinel buckets draw nothing but the translucent track band — the
  // band is the positive control that the canvas was drawn at all.
  await expect.poll(() => pixelCensus(canvas)).toMatchObject({ opaque: 0 });
  expect((await pixelCensus(canvas)).translucent).toBeGreaterThan(0);

  await component.update(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={null}
      mockPeaks={LOUD_MIDDLE}
    />,
  );
  await expect.poll(() => opaquePixels(canvas)).toBeGreaterThan(0);
});

test("renders the empty state (no peaks) without a waveform", async ({
  mount,
}) => {
  const component = await mount(
    <MockWaveformTimeline
      label="Timeline"
      duration={8}
      currentTime={null}
      mockPeaks={null}
    />,
  );
  const canvas = component.locator('[data-testid="waveform-canvas"]');
  await expect(canvas).toBeAttached();
  // No bars, but the track band is drawn: the empty state is a visible
  // track, not a blank canvas.
  await expect.poll(() => pixelCensus(canvas)).toMatchObject({ opaque: 0 });
  expect((await pixelCensus(canvas)).translucent).toBeGreaterThan(0);
});
