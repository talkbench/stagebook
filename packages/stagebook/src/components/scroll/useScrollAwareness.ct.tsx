import { test, expect } from "@playwright/experimental-ct-react";
import { Harness } from "./useScrollAwareness.testHarness";

const CONTAINER_HEIGHT = 200;

// `scrollHeight` after each render lets tests wait deterministically for
// the MutationObserver+rAF tick to land before the next click.

test.describe("useScrollAwareness", () => {
  test("indicator fires on a second overflow growth (after init warmup)", async ({
    mount,
  }) => {
    // The hook's first observed growth is treated as "initialization"
    // and silently captures `prevScrollHeight`; the indicator only fires
    // on subsequent growths.
    const component = await mount(
      <Harness containerHeight={CONTAINER_HEIGHT} />,
    );
    const indicator = component.locator('[data-testid="indicator-state"]');
    const heightMirror = component.locator('[data-testid="scroll-height"]');

    await component.locator('[data-testid="overflow-1"]').click();
    await expect(heightMirror).toHaveText("720"); // 30 × 24
    await expect(indicator).toHaveText("hidden");

    await component.locator('[data-testid="overflow-2"]').click();
    await expect(heightMirror).toHaveText("1440"); // 60 × 24
    await expect(indicator).toHaveText("visible");
  });

  test("indicator dismisses when later content shrinks back to fit (#291)", async ({
    mount,
  }) => {
    // Regression for #291: after a stage that overflows fires the
    // indicator, transitioning to a stage whose content fits should
    // dismiss it. The previous logic only dismissed on user-scroll,
    // so the indicator stayed sticky between stages.
    const component = await mount(
      <Harness containerHeight={CONTAINER_HEIGHT} />,
    );
    const indicator = component.locator('[data-testid="indicator-state"]');
    const heightMirror = component.locator('[data-testid="scroll-height"]');

    await component.locator('[data-testid="overflow-1"]').click();
    await expect(heightMirror).toHaveText("720");
    await component.locator('[data-testid="overflow-2"]').click();
    await expect(indicator).toHaveText("visible");

    // "Stage transition" — content shrinks below the viewport height.
    await component.locator('[data-testid="shrink-fits"]').click();
    await expect(heightMirror).toHaveText("200"); // back to clientHeight
    await expect(indicator).toHaveText("hidden");
  });
});
