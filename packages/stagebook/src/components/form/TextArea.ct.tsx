import { test, expect } from "@playwright/experimental-ct-react";
import { TextArea } from "./TextArea";
import { MockTextArea } from "../testing/MockTextArea";

// -- Basic rendering --

test("renders with placeholder text", async ({ mount }) => {
  const component = await mount(<TextArea defaultText="Type here..." />);
  await expect(component.locator("textarea")).toHaveAttribute(
    "placeholder",
    "Type here...",
  );
});

test("displays current value", async ({ mount }) => {
  const component = await mount(<TextArea value="Hello world" />);
  await expect(component.locator("textarea")).toHaveValue("Hello world");
});

test("textarea renders full width", async ({ mount }) => {
  const component = await mount(<TextArea value="" rows={3} />);
  const textarea = component.locator("textarea");
  await expect(textarea).toHaveCSS("width", /[4-9]\d\d|[1-9]\d{3}/);
  await expect(textarea).toHaveAttribute("rows", "3");
});

// -- Character counter: min only --

test("min only: shows required count in gray when under", async ({ mount }) => {
  const component = await mount(
    <MockTextArea value="Hi" showCharacterCount minLength={50} />,
  );
  await expect(component).toContainText("(2 / 50+ characters required)");
  // Gray color when under minimum
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(107, 114, 128)");
});

test("min only: shows green when at minimum", async ({ mount }) => {
  const component = await mount(
    <MockTextArea
      value="This is exactly fifty characters long, believe me!!"
      showCharacterCount
      minLength={50}
    />,
  );
  await expect(component).toContainText("50+ characters required");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(22, 163, 74)");
});

// -- Character counter: max only --

test("max only: shows count in gray when under", async ({ mount }) => {
  const component = await mount(
    <MockTextArea value="Hello" showCharacterCount maxLength={200} />,
  );
  await expect(component).toContainText("(5 / 200 characters max)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(107, 114, 128)");
});

test("max only: at max is steady gray, not error red (#333)", async ({
  mount,
}) => {
  // Sitting at maxLength is "you're at the upper limit", not an error.
  // The red signal was the pre-#333 behavior — now it's reserved for the
  // transient pulse animation on a rejected overflow keystroke.
  const component = await mount(
    <MockTextArea value="12345" showCharacterCount maxLength={5} />,
  );
  await expect(component).toContainText("(5 / 5 characters max)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(107, 114, 128)");
  await expect(counter).toHaveAttribute("data-state", "default");
});

// -- Character counter: min and max --

test("min+max: gray when under minimum", async ({ mount }) => {
  const component = await mount(
    <MockTextArea
      value="Hi"
      showCharacterCount
      minLength={10}
      maxLength={50}
    />,
  );
  await expect(component).toContainText("(2 / 10-50 characters)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(107, 114, 128)");
});

test("min+max: green when in range", async ({ mount }) => {
  const component = await mount(
    <MockTextArea
      value="Hello World!!"
      showCharacterCount
      minLength={10}
      maxLength={50}
    />,
  );
  await expect(component).toContainText("(13 / 10-50 characters)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(22, 163, 74)");
});

test("min+max: at maximum is valid green (#333)", async ({ mount }) => {
  // Previously this was red — but the valid range is [minLength, maxLength]
  // inclusive. Hitting exactly maxLength is the upper bound of valid.
  const component = await mount(
    <MockTextArea
      value="1234567890"
      showCharacterCount
      minLength={5}
      maxLength={10}
    />,
  );
  await expect(component).toContainText("(10 / 5-10 characters)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(22, 163, 74)");
  await expect(counter).toHaveAttribute("data-state", "valid");
});

test("min+max: exact-length input (e.g. birth year 4/4-4) is valid (#333)", async ({
  mount,
}) => {
  const component = await mount(
    <MockTextArea
      value="1990"
      showCharacterCount
      minLength={4}
      maxLength={4}
    />,
  );
  await expect(component).toContainText("(4 / 4-4 characters)");
  const counter = component.locator('[data-testid="char-counter"]');
  await expect(counter).toHaveCSS("color", "rgb(22, 163, 74)");
  await expect(counter).toHaveAttribute("data-state", "valid");
});

// -- Overflow pulse (#333) --

test("typing past maxLength triggers a transient overflow pulse", async ({
  mount,
}) => {
  // Pre-fill to exactly maxLength, then attempt to type one more
  // character. The textarea's value should stay at maxLength (rejected)
  // and the counter should flip to data-state="overflow" briefly.
  const component = await mount(
    <MockTextArea value="12345" showCharacterCount maxLength={5} />,
  );
  const textarea = component.locator("textarea");
  const counter = component.locator('[data-testid="char-counter"]');
  // Steady state at max is valid/default — not overflow.
  await expect(counter).toHaveAttribute("data-state", "default");
  // Attempt to type a 6th character. The change handler rejects it, sets
  // the overflow flag, and schedules a 300ms clear.
  await textarea.focus();
  await textarea.press("x");
  // Value is unchanged (still 5 chars), state flipped to "overflow".
  await expect(textarea).toHaveValue("12345");
  await expect(counter).toHaveAttribute("data-state", "overflow");
  // After ~300ms the flag clears.
  await expect(counter).toHaveAttribute("data-state", "default", {
    timeout: 1000,
  });
});

// -- No min/max --

test("no limits: shows plain character count", async ({ mount }) => {
  const component = await mount(
    <MockTextArea value="Hello" showCharacterCount />,
  );
  await expect(component).toContainText("(5 characters)");
});

// -- Counter hidden when not requested --

test("no counter when showCharacterCount is false", async ({ mount }) => {
  const component = await mount(<MockTextArea value="Hello" minLength={10} />);
  await expect(component).not.toContainText("characters");
  await expect(component).not.toContainText("chars");
});

// -- UI polish (#371) --

test("focus ring appears on keyboard focus via :focus-visible", async ({
  mount,
  page,
}) => {
  // Browsers apply `:focus-visible` to text inputs even on mouse
  // click (text fields are always keyboard-active per WHATWG), so we
  // can use Tab here for clarity but mouse click would also work.
  // The ring is delivered via the component's class-scoped `<style>`
  // block, so we assert on computed `boxShadow` rather than inline.
  const component = await mount(<TextArea />);
  const textarea = component.locator("textarea");

  // Baseline: elevation shadow only.
  const baseline = await textarea.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await page.keyboard.press("Tab");
  await expect(textarea).toBeFocused();
  // Poll for the 120ms box-shadow transition. The focused shadow
  // includes the focus-ring var, distinguishing it from the baseline.
  await expect
    .poll(
      () => textarea.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .not.toBe(baseline);
});

test("focus ring goes away on blur", async ({ mount, page }) => {
  const component = await mount(<TextArea />);
  const textarea = component.locator("textarea");

  const baseline = await textarea.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await page.keyboard.press("Tab");
  await expect(textarea).toBeFocused();
  // Confirm the ring is showing (different from baseline).
  await expect
    .poll(
      () => textarea.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .not.toBe(baseline);

  await textarea.evaluate((el) => (el as HTMLElement).blur());
  // After blur, the box-shadow should return to the baseline (the
  // elevation shadow alone).
  await expect
    .poll(
      () => textarea.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .toBe(baseline);
});

test("focus ring also appears on mouse click (text inputs are always keyboard-active for :focus-visible)", async ({
  mount,
}) => {
  // Symmetric to the keyboard-Tab test. Unlike Radio/Checkbox (where
  // mouse click should NOT show the ring), text inputs get
  // `:focus-visible` after mouse click in Chromium / Firefox /
  // Safari 15.4+ because they're always keyboard-active. Guards
  // against an accidental switch to `:focus-within` or React-state
  // tracking that would regress this.
  const component = await mount(<TextArea />);
  const textarea = component.locator("textarea");

  const baseline = await textarea.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );

  await textarea.click();
  await expect(textarea).toBeFocused();
  await expect
    .poll(
      () => textarea.evaluate((el) => window.getComputedStyle(el).boxShadow),
      { timeout: 1500 },
    )
    .not.toBe(baseline);
});

test("prefers-reduced-motion: pulse animation is replaced with a static red glow", async ({
  mount,
  page,
}) => {
  // Reduced-motion users still need the "you tried to type past max"
  // signal — they just shouldn't see the pulsing animation. The
  // CSS swap is: `animation: none` + static `box-shadow` so the
  // counter shows a non-animated red ring for the 300ms window.
  await page.emulateMedia({ reducedMotion: "reduce" });

  const component = await mount(
    <MockTextArea value="abcdefgh" showCharacterCount maxLength={10} />,
  );
  const textarea = component.locator("textarea");

  // Type two characters to hit max (10), then a third to trigger
  // overflow.
  await textarea.focus();
  await textarea.pressSequentially("ij");
  await textarea.press("k");

  const counter = component.locator('[data-testid="char-counter"]');
  // Animation should be 'none' under reduced-motion (the pulse was
  // 'stagebook-char-counter-pulse 300ms ease-out' otherwise).
  const animationName = await counter.evaluate(
    (el) => window.getComputedStyle(el).animationName,
  );
  expect(animationName).toBe("none");
  // And the static red glow stands in for the pulse.
  const boxShadow = await counter.evaluate(
    (el) => window.getComputedStyle(el).boxShadow,
  );
  expect(boxShadow).not.toBe("none");
});

test("focused-then-blurred textarea doesn't leave a stuck border color (no #367-style bleed)", async ({
  mount,
}) => {
  // Regression guard for the shorthand-vs-longhand border bug — same
  // pattern as the Radio/Checkbox/Select cases. Even though TextArea
  // doesn't currently override `borderColor` on focus, switching to
  // border longhands keeps future state-color additions safe.
  const component = await mount(
    <div>
      <TextArea id="touched" />
      <TextArea id="untouched" />
    </div>,
  );
  const touched = component.locator('textarea[id="touched"]');
  const untouched = component.locator('textarea[id="untouched"]');

  await touched.focus();
  await touched.blur();

  const touchedBorder = await touched.evaluate(
    (el) => window.getComputedStyle(el).borderColor,
  );
  const untouchedBorder = await untouched.evaluate(
    (el) => window.getComputedStyle(el).borderColor,
  );
  expect(touchedBorder).toBe(untouchedBorder);
});
