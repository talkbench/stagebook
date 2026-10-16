import { test, expect } from "@playwright/experimental-ct-react";
import { PointerScrollHarness } from "./PointerScrollHarness.js";

for (const [phase, elapsed] of [
  ["pending", 32],
  ["active", 200],
] as const) {
  test(`pointer down cancels the ${phase} peek before one Complete activation`, async ({
    mount,
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-16T12:00:01Z"));
    const component = await mount(<PointerScrollHarness />);

    // Absorb the initial load before engaging with the long page.
    await component.update(<PointerScrollHarness phase="warm" />);
    await page.clock.runFor(32);
    const scroller = component.getByTestId("scroller");
    await scroller.evaluate((el) => {
      el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
      el.dispatchEvent(new Event("scroll"));
    });
    const button = component.getByRole("button", {
      name: "Complete",
      exact: true,
    });
    // Focus before growth: a focusin event must not cancel the tested peek.
    await button.focus();
    await expect(button).toBeFocused();
    const beforeGrowth = await scroller.evaluate((el) => el.scrollTop);

    await component.update(<PointerScrollHarness phase="grown" />);
    await page.clock.runFor(elapsed);
    await expect(button).toBeFocused();
    const beforePointer = await scroller.evaluate((el) => el.scrollTop);
    if (phase === "active") expect(beforePointer).toBeGreaterThan(beforeGrowth);
    else expect(beforePointer).toBe(beforeGrowth);

    // No scrolling or focus setup after growth. One native down/up spans the
    // animation window at fixed coordinates on the already-visible button.
    const box = await button.boundingBox();
    const viewport = await scroller.boundingBox();
    if (!box || !viewport) throw new Error("Complete must be laid out");
    expect(box.y).toBeGreaterThanOrEqual(viewport.y);
    expect(box.y + box.height).toBeLessThanOrEqual(
      viewport.y + viewport.height,
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.clock.runFor(400);
    await page.mouse.up();

    await expect(scroller).toHaveJSProperty("scrollTop", beforePointer);
    await expect(component.getByTestId("saves")).toHaveText("1");
    await expect(component.getByTestId("submits")).toHaveText("1");
  });
}
