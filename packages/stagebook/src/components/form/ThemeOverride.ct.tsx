import { test, expect } from "@playwright/experimental-ct-react";
import { ThemedButton } from "../testing/ThemedButton";
import { ThemedKitchenTimer } from "../testing/ThemedKitchenTimer";
import { ThemedTextArea } from "../testing/ThemedTextArea";
import { SideBySideButtons } from "../testing/SideBySideButtons";

// Orange theme — deliberately very different from the default blue
// to make visual differences obvious in the Playwright UI
const orangeTheme = {
  "--stagebook-primary": "#ea580c", // orange-600
  "--stagebook-timer-fill": "#f97316", // orange-500
  "--stagebook-danger": "#dc2626", // red-600
  "--stagebook-border": "#fb923c", // orange-400
  "--stagebook-success": "#ea580c", // orange-600 (green → orange)
  "--stagebook-warning": "#f97316", // orange-500 (red → orange)
};

test.describe("CSS Variable Theme Override", () => {
  test("Button uses overridden primary color (blue → orange)", async ({
    mount,
  }) => {
    const component = await mount(
      <ThemedButton themeOverrides={orangeTheme}>Themed Button</ThemedButton>,
    );
    const button = component.locator("button");
    // #ea580c = rgb(234, 88, 12)
    await expect(button).toHaveCSS("background-color", "rgb(234, 88, 12)");
  });

  test("Button secondary uses overridden border color", async ({ mount }) => {
    const component = await mount(
      <ThemedButton themeOverrides={orangeTheme} primary={false}>
        Secondary
      </ThemedButton>,
    );
    const button = component.locator("button");
    // #fb923c = rgb(251, 146, 60)
    await expect(button).toHaveCSS("border-color", "rgb(251, 146, 60)");
  });

  test("KitchenTimer uses overridden fill color (blue → orange)", async ({
    mount,
  }) => {
    const component = await mount(
      <ThemedKitchenTimer
        startTime={0}
        endTime={60}
        elapsedTime={30}
        themeOverrides={orangeTheme}
      />,
    );
    const fill = component.locator('[data-testid="timer-fill"]');
    // #f97316 = rgb(249, 115, 22)
    await expect(fill).toHaveCSS("background-color", "rgb(249, 115, 22)");
  });

  test("KitchenTimer warning uses overridden danger color", async ({
    mount,
  }) => {
    const component = await mount(
      <ThemedKitchenTimer
        startTime={0}
        endTime={60}
        warnTimeRemaining={15}
        elapsedTime={50}
        themeOverrides={orangeTheme}
      />,
    );
    const fill = component.locator('[data-testid="timer-fill"]');
    // #dc2626 = rgb(220, 38, 38)
    await expect(fill).toHaveCSS("background-color", "rgb(220, 38, 38)");
  });

  test("TextArea counter uses overridden success color (green → orange)", async ({
    mount,
  }) => {
    const component = await mount(
      <ThemedTextArea
        value={"A".repeat(75)}
        showCharacterCount
        minLength={50}
        maxLength={200}
        themeOverrides={orangeTheme}
      />,
    );
    const counter = component.locator('[data-testid="char-counter"]');
    // #ea580c = rgb(234, 88, 12)
    await expect(counter).toHaveCSS("color", "rgb(234, 88, 12)");
  });

  test("TextArea counter uses overridden warning color during overflow pulse (#333)", async ({
    mount,
  }) => {
    // The warning color is no longer the steady state at maxLength —
    // post-#333 that's the valid/default state. The warning color now
    // appears only during the transient overflow-pulse box-shadow glow.
    // We exercise the override by triggering an overflow keystroke and
    // sampling the box-shadow color while data-state="overflow".
    const component = await mount(
      <ThemedTextArea
        value="12345"
        showCharacterCount
        maxLength={5}
        themeOverrides={orangeTheme}
      />,
    );
    const textarea = component.locator("textarea");
    const counter = component.locator('[data-testid="char-counter"]');
    await textarea.focus();
    await textarea.press("x");
    await expect(counter).toHaveAttribute("data-state", "overflow");
    // The pulse animates `box-shadow`; the keyframe's 0% frame uses the
    // themed --stagebook-warning variable. Sample box-shadow and confirm
    // the orange-override RGB is present.
    const shadow = await counter.evaluate(
      (el) => getComputedStyle(el).boxShadow,
    );
    // #f97316 = rgb(249, 115, 22); RGBA in box-shadow may render with
    // alpha channel. We assert any RGB() containing the override hue.
    expect(shadow).toMatch(/249,?\s*115,?\s*22/);
  });

  test("side-by-side: blue default vs orange override", async ({ mount }) => {
    const component = await mount(<SideBySideButtons />);
    await expect(component).toContainText("Default Blue");
    await expect(component).toContainText("Custom Orange");

    const buttons = component.locator("button");
    await expect(buttons).toHaveCount(2);

    // Check actual computed colors
    const defaultBg = await buttons
      .nth(0)
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const themedBg = await buttons
      .nth(1)
      .evaluate((el) => getComputedStyle(el).backgroundColor);

    // Log for debugging
    console.log("Default button bg:", defaultBg);
    console.log("Themed button bg:", themedBg);

    // They should be different colors
    expect(defaultBg).not.toBe(themedBg);
  });
});
