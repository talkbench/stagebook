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
