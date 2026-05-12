import { test, expect } from "@playwright/experimental-ct-react";
import { Slider } from "./Slider";
import { MockSlider } from "../testing/MockSlider";

test("renders without thumb initially (no anchoring)", async ({ mount }) => {
  const component = await mount(<Slider min={0} max={100} interval={1} />);
  // No range input should be in the DOM until user clicks
  await expect(component.locator('input[type="range"]')).toHaveCount(0);
  // Instruction text should be visible
  await expect(component).toContainText("Click the bar to select a value");
});

test("shows range input after clicking the track", async ({ mount }) => {
  const component = await mount(<Slider min={0} max={100} interval={1} />);
  // Dispatch a click event on the track (element may be thin/outside viewport)
  await component
    .locator('[role="presentation"]')
    .dispatchEvent("click", { clientX: 150, clientY: 5 });
  // Now the range input should be in the DOM
  await expect(component.locator('input[type="range"]')).toHaveCount(1);
  // Instruction text should be gone
  await expect(component).not.toContainText("Click the bar");
});

test("renders range input when pre-set value is provided", async ({
  mount,
}) => {
  const component = await mount(
    <Slider min={0} max={100} interval={1} value={50} />,
  );
  // Range input should be present with the value
  await expect(component.locator('input[type="range"]')).toHaveCount(1);
  await expect(component.locator('input[type="range"]')).toHaveValue("50");
});

test("renders labels at specified points", async ({ mount }) => {
  const component = await mount(
    <Slider
      min={0}
      max={100}
      interval={10}
      labelPts={[0, 50, 100]}
      labels={["Low", "Mid", "High"]}
    />,
  );
  await expect(component).toContainText("Low");
  await expect(component).toContainText("Mid");
  await expect(component).toContainText("High");
});

test("renders tick marks at label points", async ({ mount }) => {
  const component = await mount(
    <Slider
      min={0}
      max={100}
      interval={10}
      labelPts={[0, 50, 100]}
      labels={["Low", "Mid", "High"]}
    />,
  );
  // 3 tick marks inside the track (role="presentation" container)
  const track = component.locator('[role="presentation"]');
  await expect(track.locator("div")).toHaveCount(3);
});

test("clicking track sets value via onChange", async ({ mount }) => {
  const component = await mount(<MockSlider min={0} max={100} interval={1} />);
  // Initially no value
  await expect(component.locator('[data-testid="slider-value"]')).toHaveText(
    "undefined",
  );

  // Click the track
  await component
    .locator('[role="presentation"]')
    .dispatchEvent("click", { clientX: 150, clientY: 5 });

  // Value should now be set (some number between 0 and 100)
  const val = await component
    .locator('[data-testid="slider-value"]')
    .textContent();
  expect(val).not.toBe("undefined");
  const num = parseFloat(val!);
  expect(num).toBeGreaterThanOrEqual(0);
  expect(num).toBeLessThanOrEqual(100);
});

test("changing range input updates value", async ({ mount }) => {
  const component = await mount(
    <MockSlider min={0} max={100} interval={1} initialValue={50} />,
  );

  await expect(component.locator('[data-testid="slider-value"]')).toHaveText(
    "50",
  );

  // Change the range input value
  await component.locator('input[type="range"]').fill("75");

  await expect(component.locator('[data-testid="slider-value"]')).toHaveText(
    "75",
  );
});

// -- Thumb shape and alignment (#326) --

test("thumb is a square (round via border-radius) — not an oblong", async ({
  mount,
}) => {
  const component = await mount(
    <Slider min={0} max={100} interval={1} value={50} />,
  );
  const thumb = component.locator('[data-testid="slider-thumb"]');
  await expect(thumb).toHaveCount(1);
  // width === height for a true circle when border-radius is 50%
  const box = await thumb.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBe(box!.height);
  // And it's the expected 20×20
  expect(box!.width).toBe(20);
});

test("thumb is centered on the track at value=min", async ({ mount }) => {
  // At min, the thumb's horizontal center should be at the leftmost tick's
  // horizontal center — i.e., at 0% of the track, not 10px in.
  const component = await mount(
    <Slider min={1} max={7} interval={1} labelPts={[1, 7]} value={1} />,
  );
  const track = component.locator('[data-testid="slider-track"]');
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const trackBox = await track.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  const thumbCenterX = thumbBox!.x + thumbBox!.width / 2;
  // Thumb center should be at the track's left edge (within 1px tolerance
  // for sub-pixel rendering).
  expect(Math.abs(thumbCenterX - trackBox!.x)).toBeLessThanOrEqual(1);
});

test("thumb is centered on the track at value=max", async ({ mount }) => {
  const component = await mount(
    <Slider min={1} max={7} interval={1} labelPts={[1, 7]} value={7} />,
  );
  const track = component.locator('[data-testid="slider-track"]');
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const trackBox = await track.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  const thumbCenterX = thumbBox!.x + thumbBox!.width / 2;
  const trackRight = trackBox!.x + trackBox!.width;
  expect(Math.abs(thumbCenterX - trackRight)).toBeLessThanOrEqual(1);
});

test("thumb aligns with the tick at non-center values (value=5 on 1..7)", async ({
  mount,
}) => {
  // The bug: at value=5 on a 1..7 scale, the thumb was ~3px left of the
  // tick at 5 because the native range thumb's half-thumb-width offset
  // doesn't match the tick coordinate system.
  const component = await mount(
    <Slider
      min={1}
      max={7}
      interval={1}
      labelPts={[1, 2, 3, 4, 5, 6, 7]}
      value={5}
    />,
  );
  const thumb = component.locator('[data-testid="slider-thumb"]');
  // Ticks render in order before the thumb, so direct child index 4 is
  // the 5th tick (the one at value=5).
  const track = component.locator('[data-testid="slider-track"]');
  const tickAt5 = track.locator("> div").nth(4);
  const tickBox = await tickAt5.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(tickBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  const thumbCenterX = thumbBox!.x + thumbBox!.width / 2;
  const tickCenterX = tickBox!.x + tickBox!.width / 2;
  expect(Math.abs(thumbCenterX - tickCenterX)).toBeLessThanOrEqual(1);
});
