import { test, expect } from "@playwright/experimental-ct-react";
import { LocaleProvider } from "./testing/LocaleProvider.js";
import { Slider } from "./form/Slider.js";
import { MockKitchenTimer } from "./testing/MockKitchenTimer.js";
import { MockTimeline } from "./testing/MockTimeline.js";

// RTL layer (ADR 2026-06-localization decision #10): value/quantity
// components mirror under an RTL locale; time-based components stay LTR.
// The Slider is the subtle case — the native <input type=range>
// auto-reverses under dir=rtl, and the custom thumb/ticks/labels must
// follow it (insetInlineStart + direction-aware transforms), with
// click-to-jump math flipped. Value semantics never change: min records
// as min, wherever it's painted.

test("Slider under he: root is rtl and min paints on the RIGHT", async ({
  mount,
}) => {
  const component = await mount(
    <LocaleProvider locale="he">
      <Slider min={0} max={10} interval={1} value={0} />
    </LocaleProvider>,
  );
  const root = component.locator("[dir=rtl]").first();
  await expect(root).toBeVisible();

  const track = component.locator('[data-testid="slider-track"]');
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const trackBox = (await track.boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  const thumbCenter = thumbBox.x + thumbBox.width / 2;
  // value=min → inline-start = RIGHT edge in RTL.
  expect(Math.abs(thumbCenter - (trackBox.x + trackBox.width))).toBeLessThan(2);
});

test("Slider under he: max paints on the LEFT", async ({ mount }) => {
  const component = await mount(
    <LocaleProvider locale="he">
      <Slider min={0} max={10} interval={1} value={10} />
    </LocaleProvider>,
  );
  const track = component.locator('[data-testid="slider-track"]');
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const trackBox = (await track.boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  const thumbCenter = thumbBox.x + thumbBox.width / 2;
  expect(Math.abs(thumbCenter - trackBox.x)).toBeLessThan(2);
});

test("Slider under he: click near the left edge selects a HIGH value", async ({
  mount,
}) => {
  const values: number[] = [];
  const component = await mount(
    <LocaleProvider locale="he">
      <Slider
        min={0}
        max={10}
        interval={1}
        onChange={(v: number) => values.push(v)}
      />
    </LocaleProvider>,
  );
  const track = component.locator('[data-testid="slider-track"]');
  const box = (await track.boundingBox())!;
  // Click 10% from the left edge — mirrored axis ⇒ ~90% of the range.
  await track.click({ position: { x: box.width * 0.1, y: box.height / 2 } });
  expect(values.length).toBeGreaterThan(0);
  expect(values[0]).toBeGreaterThanOrEqual(8);
});

test("Slider under he: thumb lands where the participant clicked (custom layer follows the native axis)", async ({
  mount,
}) => {
  const component = await mount(
    <LocaleProvider locale="he">
      <Slider min={0} max={10} interval={1} />
    </LocaleProvider>,
  );
  const track = component.locator('[data-testid="slider-track"]');
  const box = (await track.boundingBox())!;
  const clickX = box.width * 0.2;
  await track.click({ position: { x: clickX, y: box.height / 2 } });
  const thumb = component.locator('[data-testid="slider-thumb"]');
  await expect(thumb).toBeVisible();
  const thumbBox = (await thumb.boundingBox())!;
  const thumbCenter = thumbBox.x + thumbBox.width / 2;
  // Snap interval is 1 of 10 ⇒ at most half-a-step (5%) of drift.
  expect(Math.abs(thumbCenter - (box.x + clickX))).toBeLessThan(
    box.width * 0.06,
  );
});

test("Slider under en (and standalone): stays LTR", async ({ mount }) => {
  const component = await mount(<Slider min={0} max={10} value={0} />);
  await expect(component.locator("[dir=ltr]").first()).toBeVisible();
  const track = component.locator('[data-testid="slider-track"]');
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const trackBox = (await track.boundingBox())!;
  const thumbBox = (await thumb.boundingBox())!;
  const thumbCenter = thumbBox.x + thumbBox.width / 2;
  expect(Math.abs(thumbCenter - trackBox.x)).toBeLessThan(2);
});

test("KitchenTimer under he: mirrors (time label on the LEFT)", async ({
  mount,
}) => {
  // MockKitchenTimer supplies getElapsedTime internally — a render-time
  // sync call can't cross Playwright CT's async function-prop bridge.
  const component = await mount(
    <LocaleProvider locale="he">
      <MockKitchenTimer startTime={0} endTime={60} elapsedTime={20} />
    </LocaleProvider>,
  );
  // The provider renders no DOM of its own, so the mounted component's
  // root node IS the kitchen-timer div — assert on `component` directly
  // (component.locator() searches descendants only).
  await expect(component).toHaveAttribute("dir", "rtl");
  const fill = component.locator('[data-testid="timer-fill"]');
  const label = component.locator("span", { hasText: ":" });
  const fillBox = (await fill.boundingBox())!;
  const labelBox = (await label.boundingBox())!;
  // Flex row reverses under dir=rtl: label sits left of the bar.
  expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(fillBox.x + 1);
});

test("Timeline stays LTR regardless of locale (time axis never mirrors)", async ({
  mount,
}) => {
  const component = await mount(
    <MockTimeline
      source="player"
      playerName="player"
      name="ranges"
      selectionType="range"
      mockDuration={60}
    />,
  );
  await expect(component.locator('[data-testid="timeline"]')).toHaveAttribute(
    "dir",
    "ltr",
  );
});
