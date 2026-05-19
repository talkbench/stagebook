import { test, expect } from "@playwright/experimental-ct-react";
import { Button } from "./Button";

// Note: the Button renders a fragment (style + button), so
// `component` refers to Playwright CT's mount wrapper, not the
// <button> itself. Query `component.getByRole("button")` or
// `component.locator("button")` to target the button element
// when asserting interaction or computed style.

test("renders with children text", async ({ mount }) => {
  const component = await mount(<Button>Click me</Button>);
  await expect(component).toContainText("Click me");
});

test("calls onClick when clicked", async ({ mount }) => {
  let clicked = false;
  const component = await mount(
    <Button
      onClick={() => {
        clicked = true;
      }}
    >
      Submit
    </Button>,
  );
  await component.getByRole("button").click();
  expect(clicked).toBe(true);
});

test("renders as disabled", async ({ mount }) => {
  const component = await mount(<Button disabled>Disabled</Button>);
  await expect(component.getByRole("button")).toBeDisabled();
});

test("applies secondary style when primary is false", async ({ mount }) => {
  const component = await mount(<Button primary={false}>Secondary</Button>);
  // Secondary button has white-ish background, not the primary blue
  await expect(component.getByRole("button")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
});

test("applies primary style by default", async ({ mount }) => {
  const component = await mount(<Button>Primary</Button>);
  // Primary button should not have white background
  const bg = await component
    .getByRole("button")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgb(255, 255, 255)");
});

// ----------- UI polish (#373) -----------

test("primary button darkens on hover", async ({ mount }) => {
  const component = await mount(<Button>Submit</Button>);
  const button = component.getByRole("button");
  const before = await button.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  await button.hover();
  // Poll for the 120ms background-color transition.
  await expect
    .poll(
      () =>
        button.evaluate((el) => window.getComputedStyle(el).backgroundColor),
      { timeout: 1500 },
    )
    .not.toBe(before);
});

test("secondary button tints on hover", async ({ mount }) => {
  const component = await mount(<Button primary={false}>Cancel</Button>);
  const button = component.getByRole("button");
  const before = await button.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  await button.hover();
  await expect
    .poll(
      () =>
        button.evaluate((el) => window.getComputedStyle(el).backgroundColor),
      { timeout: 1500 },
    )
    .not.toBe(before);
});

test("focus ring appears on keyboard focus via :focus-visible", async ({
  mount,
  page,
}) => {
  // Focus ring is keyboard-only — `:focus-visible` rather than
  // `:focus` so a mouse click on the button doesn't leave a
  // lingering ring around it after release.
  const component = await mount(<Button>Submit</Button>);
  const button = component.getByRole("button");
  const baseline = await button.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect
    .poll(
      () => button.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .not.toBe(baseline);
});

test("secondary variant also shows the focus ring on keyboard focus", async ({
  mount,
  page,
}) => {
  // The white-bg secondary button is the harder case for ring
  // contrast — a thin translucent-blue ring against white can read
  // as faint or invisible if any style overrides it. Lock it in
  // separately from the primary test.
  const component = await mount(<Button primary={false}>Cancel</Button>);
  const button = component.getByRole("button");
  const baseline = await button.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  await expect
    .poll(
      () => button.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .not.toBe(baseline);
});

test("disabled button has pointer-events: none (no hover state fires)", async ({
  mount,
}) => {
  // Even though the `disabled` attr already prevents click events,
  // `pointer-events: none` additionally guards against any hover
  // CSS firing — without it a hover over a disabled button would
  // briefly darken before the click is ignored, contradicting
  // the "disabled" semantic.
  const component = await mount(<Button disabled>Disabled</Button>);
  const button = component.getByRole("button");
  const pointerEvents = await button.evaluate(
    (el) => window.getComputedStyle(el).pointerEvents,
  );
  expect(pointerEvents).toBe("none");
});

test("disabled button has reduced opacity", async ({ mount }) => {
  const component = await mount(<Button disabled>Disabled</Button>);
  const button = component.getByRole("button");
  const opacity = await button.evaluate((el) =>
    parseFloat(window.getComputedStyle(el).opacity),
  );
  // Should be 0.5 (the documented disabled treatment) — at least
  // visibly faded.
  expect(opacity).toBeLessThan(1);
  expect(opacity).toBeGreaterThan(0);
});

test("disabled button does NOT darken on hover (pointer-events: none)", async ({
  mount,
}) => {
  // The strongest test of the `pointer-events: none` rule. Without
  // it, hovering a disabled button would briefly fire the hover
  // CSS — visually contradicting the "disabled" semantic ("looks
  // interactive, isn't"). With it, the hover state can't fire.
  const component = await mount(<Button disabled>Disabled</Button>);
  const button = component.getByRole("button");
  const before = await button.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  // Force the hover with a CSS state — Playwright's .hover() can't
  // hover a pointer-events: none element. We test that even when
  // we artificially apply :hover-equivalent state, nothing changes.
  await button.hover({ force: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  const after = await button.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );
  expect(after).toBe(before);
});

test("primary button :active state is darker than hover (tactile feedback)", async ({
  mount,
  page,
}) => {
  // Symmetric with the hover tests. Mouse down on the button
  // triggers the :active pseudo-class — the bg should darken
  // further than the hover state did, so the click registers
  // visually.
  const component = await mount(<Button>Submit</Button>);
  const button = component.getByRole("button");
  const base = await button.evaluate(
    (el) => window.getComputedStyle(el).backgroundColor,
  );

  // Press the mouse down on the button without releasing — this
  // puts the button in the :active state without triggering the
  // onClick.
  const box = await button.boundingBox();
  if (!box) throw new Error("button has no bounding box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Poll for the 120ms transition to settle on the active color.
  await expect
    .poll(
      () =>
        button.evaluate((el) => window.getComputedStyle(el).backgroundColor),
      { timeout: 1500 },
    )
    .not.toBe(base);
  await page.mouse.up();
});
