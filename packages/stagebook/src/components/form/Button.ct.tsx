import { test, expect } from "@playwright/experimental-ct-react";
import { Button, type ButtonProps } from "./Button";
import { RefreshGlyph } from "../testing/RefreshGlyph";
import { Select } from "./Select";

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

// ----------- Icon-only use (#621 / #622) -----------
//
// `RefreshGlyph` lives in testing/ because Playwright CT can only mount
// components it can import. It is `aria-hidden` with a `currentColor`
// fill — the shape a consumer's decorative glyph should take.

const selectOptions = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
];

test("aria-label names a button whose children are not text (#621)", async ({
  mount,
}) => {
  const component = await mount(
    <Button aria-label="Refresh devices">
      <RefreshGlyph />
    </Button>,
  );
  // getByRole filters by accessible name — this resolves only if the
  // aria-label reached the <button>. Without it the button's name is the
  // empty string and the locator matches nothing.
  await expect(
    component.getByRole("button", { name: "Refresh devices" }),
  ).toBeVisible();
});

test("title is forwarded to the <button> as the native tooltip (#621)", async ({
  mount,
}) => {
  const component = await mount(
    <Button aria-label="Refresh devices" title="Refresh devices">
      <RefreshGlyph />
    </Button>,
  );
  await expect(component.getByRole("button")).toHaveAttribute(
    "title",
    "Refresh devices",
  );
});

test("neither attribute appears when neither prop is passed", async ({
  mount,
}) => {
  // Forwarded verbatim, so an absent prop is an absent attribute — the
  // text button's DOM is unchanged by #621. (An empty `aria-label` is
  // ignored by the accessible-name computation, so this is about not
  // emitting a spurious attribute, not about the name.)
  const component = await mount(<Button>Continue</Button>);
  const button = component.getByRole("button", { name: "Continue" });
  await expect(button).toBeVisible();
  await expect(button).not.toHaveAttribute("aria-label");
  await expect(button).not.toHaveAttribute("title");
});

test("a text button keeps its text geometry (icon styles are opt-in)", async ({
  mount,
}) => {
  // Guards the conditional spread: were the icon geometry applied
  // unconditionally, "Continue" would be crushed into a square and every
  // other test here would stay green — axe doesn't flag overflow.
  const component = await mount(<Button>Continue</Button>);
  const button = component.getByRole("button");
  await expect(button).toHaveCSS("padding", "8px 16px");
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(box!.height);
});

test("icon variant is square and level with a Select in the same row (#622)", async ({
  mount,
}) => {
  // The box is a Select's — line-height, padding, border and row-height
  // floor — so when the consumer aligns to the control, the two sit level.
  // Measured against a real Select rather than a literal so a drift in
  // either component's metrics fails here.
  const component = await mount(
    <div
      style={{ display: "flex", alignItems: "flex-end", gap: 8, width: 320 }}
    >
      <div style={{ flex: 1 }}>
        <Select options={selectOptions} onChange={() => {}} />
      </div>
      <Button icon aria-label="Refresh devices" primary={false}>
        <RefreshGlyph />
      </Button>
    </div>,
  );
  const select = await component.locator("select").boundingBox();
  const button = await component.getByRole("button").boundingBox();
  expect(select).not.toBeNull();
  expect(button).not.toBeNull();
  expect(button!.width).toBeCloseTo(button!.height, 0);
  expect(button!.height).toBeCloseTo(select!.height, 0);
  // Comfortably above the 24×24 floor of WCAG 2.5.8.
  expect(button!.width).toBeGreaterThanOrEqual(36);
});

test("icon variant grows with --stagebook-row-min-height, alongside the Select", async ({
  mount,
}) => {
  // The token is the floor both share. A host that raises it for touch
  // gets a taller Select and an icon button that stays square and level —
  // a hard-coded box would pass the default-size test and fail here.
  const component = await mount(
    <div
      style={{
        ["--stagebook-row-min-height" as never]: "3rem",
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        width: 320,
      }}
    >
      <div style={{ flex: 1 }}>
        <Select options={selectOptions} onChange={() => {}} />
      </div>
      <Button icon aria-label="Refresh devices" primary={false}>
        <RefreshGlyph />
      </Button>
    </div>,
  );
  const select = await component.locator("select").boundingBox();
  const button = await component.getByRole("button").boundingBox();
  expect(select).not.toBeNull();
  expect(button).not.toBeNull();
  expect(button!.width).toBeCloseTo(48, 0);
  expect(button!.height).toBeCloseTo(48, 0);
  expect(select!.height).toBeCloseTo(48, 0);
});

test("icon variant stays square with a narrow text glyph", async ({
  mount,
}) => {
  // A one-character child ("+", "?", "×") is a legitimate glyph. Without a
  // fixed inline size it would render as a tall, narrow pill.
  const component = await mount(
    <Button icon aria-label="Zoom in" primary={false}>
      +
    </Button>,
  );
  const box = await component.getByRole("button").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeCloseTo(box!.height, 0);
  expect(box!.width).toBeGreaterThanOrEqual(36);
});

test("icon variant does not shrink inside a flex row", async ({ mount }) => {
  // The consumer's layout (talkbench/runner#862): a full-width Select and
  // the icon button in one flex row. A <button> with an explicit width but
  // flex-shrink: 1 would be squeezed toward its glyph's min-content width
  // once the select takes 100%.
  const component = await mount(
    <div style={{ display: "flex", width: 240 }}>
      <div style={{ width: "100%" }} />
      <Button icon aria-label="Refresh devices" primary={false}>
        <RefreshGlyph />
      </Button>
    </div>,
  );
  const box = await component.getByRole("button").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(36);
  expect(box!.width).toBeCloseTo(box!.height, 0);
});

test("icon variant centers the glyph", async ({ mount }) => {
  const component = await mount(
    <Button icon aria-label="Refresh devices" primary={false}>
      <RefreshGlyph />
    </Button>,
  );
  const button = await component.getByRole("button").boundingBox();
  const glyph = await component.getByTestId("glyph").boundingBox();
  expect(button).not.toBeNull();
  expect(glyph).not.toBeNull();
  const left = glyph!.x - button!.x;
  const right = button!.x + button!.width - (glyph!.x + glyph!.width);
  const top = glyph!.y - button!.y;
  const bottom = button!.y + button!.height - (glyph!.y + glyph!.height);
  expect(left).toBeCloseTo(right, 0);
  expect(top).toBeCloseTo(bottom, 0);
  // The glyph actually has room: not overflowing the box.
  expect(left).toBeGreaterThanOrEqual(0);
  expect(top).toBeGreaterThanOrEqual(0);
});

test("icon variant keeps the secondary variant's fill and glyph colour", async ({
  mount,
}) => {
  // Same tokens as the text button. The glyph is drawn in currentColor,
  // so its fill resolves to the same value — that is the colour the 3:1
  // check (1.4.11) is against, and axe's contrast rule doesn't see SVG
  // fills, so it is pinned here.
  const component = await mount(
    <Button icon aria-label="Refresh devices" primary={false}>
      <RefreshGlyph />
    </Button>,
  );
  const button = component.getByRole("button");
  await expect(button).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(button).toHaveCSS("color", "rgb(55, 65, 81)");
  await expect(button).toHaveAttribute("data-variant", "secondary");
  await expect(component.getByTestId("glyph").locator("path")).toHaveCSS(
    "fill",
    "rgb(55, 65, 81)",
  );
});

test("icon variant keeps the primary variant's fill and glyph colour", async ({
  mount,
}) => {
  const component = await mount(
    <Button icon aria-label="Send">
      <RefreshGlyph />
    </Button>,
  );
  const button = component.getByRole("button");
  await expect(button).toHaveCSS("background-color", "rgb(37, 99, 235)");
  await expect(button).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(button).toHaveAttribute("data-variant", "primary");
  await expect(component.getByTestId("glyph").locator("path")).toHaveCSS(
    "fill",
    "rgb(255, 255, 255)",
  );
});

test("icon variant shares the text button's disabled treatment", async ({
  mount,
}) => {
  const component = await mount(
    <Button icon aria-label="Refresh devices" primary={false} disabled>
      <RefreshGlyph />
    </Button>,
  );
  const button = component.getByRole("button");
  await expect(button).toBeDisabled();
  await expect(button).toHaveCSS("pointer-events", "none");
  const opacity = await button.evaluate((el) =>
    parseFloat(window.getComputedStyle(el).opacity),
  );
  expect(opacity).toBeLessThan(1);
});

test("icon variant shows the focus halo on keyboard focus", async ({
  mount,
  page,
}) => {
  // There is no text underline or colour shift to lean on for an icon-only
  // control, so the ring is the whole indicator. The focus gate holds the
  // exact halo geometry; this pins that the rule reaches the variant.
  const component = await mount(
    <Button icon aria-label="Refresh devices" primary={false}>
      <RefreshGlyph />
    </Button>,
  );
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

// The type refuses the first two (`icon: true` requires `aria-label`,
// pinned by Button.types.test.ts); the runtime check is for JS consumers,
// who never see the type. The third — an empty string — the type accepts
// but the accessible-name computation ignores, so the button would be
// nameless all the same. `title` alone is the case the docs rule out: a
// browser will fall back to it for the name, but touch and screen-reader
// users never get it, so Stagebook does not count it. The check reports
// rather than throws: a nameless button is a defect, not a reason to take
// the stage down. Cast past the type to reach the runtime path.
const namelessCases: [string, Record<string, unknown>][] = [
  ["no aria-label", { icon: true, primary: false }],
  ["only a title", { icon: true, primary: false, title: "Refresh devices" }],
  ["an empty aria-label", { icon: true, primary: false, "aria-label": "" }],
];
for (const [label, props] of namelessCases) {
  test(`icon variant with ${label} reports an error`, async ({
    mount,
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await mount(
      <Button {...(props as unknown as ButtonProps)}>
        <RefreshGlyph />
      </Button>,
    );
    await expect
      .poll(() => errors.some((e) => /aria-label/.test(e)))
      .toBe(true);
  });
}

test("a named icon button reports nothing", async ({ mount, page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await mount(
    <Button icon aria-label="Refresh devices" primary={false}>
      <RefreshGlyph />
    </Button>,
  );
  // Give any effect a tick to fire before asserting silence.
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});
