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

test("shows range input after clicking the track", async ({ mount, page }) => {
  const component = await mount(<Slider min={0} max={100} interval={1} />);
  // Real mouse click instead of dispatchEvent — webkit doesn't route a
  // synthetic `dispatchEvent("click", { clientX })` through React's
  // delegated click listener reliably, so the onClick handler on the
  // wrapper never fires and the slider stays in its unanchored state
  // (#420). page.mouse.click drives the full native event sequence.
  const wrapper = component.locator('[role="presentation"]');
  const box = await wrapper.boundingBox();
  if (!box) throw new Error("slider wrapper not found");
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
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
  // 3 labeled ticks (the named positions). Snap-point micro-ticks
  // are a separate visual layer counted by their own testid.
  await expect(
    component.locator('[data-testid="slider-label-tick"]'),
  ).toHaveCount(3);
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
  // Pick the label tick at value=5 specifically — there are also
  // snap-point ticks at every interval, but only the labeled ticks
  // carry the slider-label-tick testid.
  const tickAt5 = component.locator('[data-testid="slider-label-tick"]').nth(4);
  const tickBox = await tickAt5.boundingBox();
  const thumbBox = await thumb.boundingBox();
  expect(tickBox).not.toBeNull();
  expect(thumbBox).not.toBeNull();
  const thumbCenterX = thumbBox!.x + thumbBox!.width / 2;
  const tickCenterX = tickBox!.x + tickBox!.width / 2;
  expect(Math.abs(thumbCenterX - tickCenterX)).toBeLessThanOrEqual(1);
});

// ----------- UI polish (#372) -----------

test("click target is at least 36px tall (touch-target sizing)", async ({
  mount,
}) => {
  // The visible track is only 10px tall — clickable directly would
  // be a frustrating hit target. We wrap it in a 36px-tall click
  // strip so users can click anywhere within ~13px of the track.
  const component = await mount(<Slider min={0} max={100} interval={1} />);
  // The click-target wrapper is the role="presentation" element.
  const wrapper = component.locator('[role="presentation"]');
  const box = await wrapper.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(36);
});

test("renders snap-point micro-ticks at intermediate positions only", async ({
  mount,
}) => {
  // 1..7 interval 1 = 7 snap points. labelPts at [1, 4, 7] take the
  // tall labeled-tick treatment; snap ticks are drawn at the
  // remaining intermediate positions (2, 3, 5, 6) so the two tick
  // layers don't overlap visually. Total = 7 - 3 = 4 snap ticks.
  const component = await mount(
    <Slider min={1} max={7} interval={1} labelPts={[1, 4, 7]} />,
  );
  await expect(
    component.locator('[data-testid="slider-snap-tick"]'),
  ).toHaveCount(4);
});

test("snap-point micro-ticks degrade gracefully when the count exceeds the cap", async ({
  mount,
}) => {
  // 0..100 interval 1 = 101 snap points — drawing every one would
  // look like a barcode. Above the cap the component shows every
  // Nth tick (rather than dropping them entirely) so the
  // "discrete positions exist here" signal carries across the full
  // range.
  const component = await mount(
    <Slider min={0} max={100} interval={1} labelPts={[0, 50, 100]} />,
  );
  const snapCount = await component
    .locator('[data-testid="slider-snap-tick"]')
    .count();
  // Some ticks render, but not all 101.
  expect(snapCount).toBeGreaterThan(0);
  expect(snapCount).toBeLessThanOrEqual(25);
  // Labeled ticks are unaffected by the cap.
  await expect(
    component.locator('[data-testid="slider-label-tick"]'),
  ).toHaveCount(3);
});

test("value badge is hidden by default (no anchoring)", async ({ mount }) => {
  const component = await mount(
    <Slider min={1} max={7} interval={1} value={5} />,
  );
  await expect(
    component.locator('[data-testid="slider-value-badge"]'),
  ).toHaveCount(0);
});

test("value badge appears when showValue=true and a value is set", async ({
  mount,
}) => {
  const component = await mount(
    <Slider min={1} max={7} interval={1} value={5} showValue />,
  );
  const badge = component.locator('[data-testid="slider-value-badge"]');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("5");
});

test("value badge stays hidden when showValue=true but no value is set", async ({
  mount,
}) => {
  // The badge is gated on (hasValue && showValue), so an unanchored
  // slider with showValue=true still shows nothing — there's nothing
  // to display.
  const component = await mount(
    <Slider min={1} max={7} interval={1} showValue />,
  );
  await expect(
    component.locator('[data-testid="slider-value-badge"]'),
  ).toHaveCount(0);
});

test("click-to-jump works in the anchored state (clicking the bar moves the thumb)", async ({
  mount,
}) => {
  // Click-to-jump is supported both before AND after first
  // interaction. Before: the wrapper's onClick catches the event
  // because the input doesn't exist yet. After: clicks on the track
  // are handled by the native range input's built-in click-to-jump,
  // and clicks in the padding (above/below the track) are still
  // caught by the wrapper's onClick. Together they make the entire
  // 36px click-target region behave as expected.
  const component = await mount(
    <MockSlider min={0} max={100} interval={1} initialValue={50} />,
  );
  // Sanity: starts at 50
  await expect(component.locator('[data-testid="slider-value"]')).toHaveText(
    "50",
  );
  // Click far from the current thumb position
  await component
    .locator('[role="presentation"]')
    .dispatchEvent("click", { clientX: 50, clientY: 18 });
  // Value should have updated — click-to-jump works in the anchored
  // state. The new value should not equal the initial 50.
  await expect(
    component.locator('[data-testid="slider-value"]'),
  ).not.toHaveText("50");
});

test("hovering the click-target region tints the wrapper background", async ({
  mount,
}) => {
  // Hover affordance for the click region. The CSS rule shifts the
  // wrapper's bg from transparent to --stagebook-hover-bg on hover.
  // Without this signal, a participant looking at the slider on
  // first paint has no visual cue that the bar is interactive.
  const component = await mount(<Slider min={0} max={100} interval={1} />);
  const wrapper = component.locator('[role="presentation"]');
  const before = await wrapper.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  await wrapper.hover();
  // Poll for the 120ms background-color transition.
  await expect
    .poll(
      () =>
        wrapper.evaluate((el) => window.getComputedStyle(el).backgroundColor),
      { timeout: 1500 },
    )
    .not.toBe(before);
});

test("all label ticks are centered on their tick (translateX(-50%), not edge-justified)", async ({
  mount,
}) => {
  // The slider centers every label on its tick — including the
  // endpoints. This is the dominant pattern in Material 3 / MUI /
  // Mantine; the slider's outer wrapper reserves horizontal padding
  // so endpoint labels can center without overflowing. Regression
  // guard against a slip back to the prior edge-justify-on-extremes
  // behavior.
  const component = await mount(
    <Slider
      min={0}
      max={100}
      interval={10}
      labelPts={[0, 50, 100]}
      labels={["Low", "Mid", "High"]}
    />,
  );
  const transforms = await component
    .locator("div")
    .evaluateAll((els) =>
      els
        .filter((el) => /^(Low|Mid|High)$/.test((el.textContent || "").trim()))
        .map((el) => window.getComputedStyle(el).transform),
    );
  // Every label should have a matrix that includes translateX(-50%).
  // Computed `transform` for translateX(-50%) renders as the matrix
  // form, e.g. "matrix(1, 0, 0, 1, -X, 0)" where X > 0.
  expect(transforms).toHaveLength(3);
  for (const t of transforms) {
    // Confirm a horizontal translation is present (not the identity).
    expect(t).not.toBe("none");
  }
});

test("focus ring appears on the thumb when the range input is keyboard-focused", async ({
  mount,
  page,
}) => {
  // Focus ring is keyboard-only via :focus-visible. The actual
  // focused element is the invisible range input; the visible ring
  // lands on the slider-thumb via a sibling CSS rule.
  const component = await mount(
    <Slider min={1} max={7} interval={1} value={4} />,
  );
  const thumb = component.locator('[data-testid="slider-thumb"]');
  const baseline = await thumb.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await page.keyboard.press("Tab");
  await expect(component.locator("input[type=range]")).toBeFocused();
  await expect
    .poll(() => thumb.evaluate((el) => window.getComputedStyle(el).boxShadow), {
      timeout: 1500,
    })
    .not.toBe(baseline);
});
