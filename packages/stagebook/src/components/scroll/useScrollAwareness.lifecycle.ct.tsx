import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";
import { ScrollLifecycleHarness } from "./ScrollLifecycleHarness.js";

async function pauseClock(page: Page) {
  await page.clock.install({ time: new Date("2026-10-16T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-16T12:00:01Z"));
}

async function reveal(component: Locator, page: Page, elapsed: number) {
  await component.getByRole("button", { name: "Warm up", exact: true }).click();
  await page.clock.runFor(32);
  const scroller = component.getByTestId("scroller");
  await scroller.evaluate((el) => {
    el.scrollTo({ top: 520, behavior: "instant" });
    el.dispatchEvent(new Event("scroll"));
  });
  await component
    .getByRole("button", { name: "Reveal Complete", exact: true })
    .click();
  await page.clock.runFor(elapsed);
  return scroller;
}

// Controlled clock advancement exercises the animation window; it does not
// wait for a moving target to settle or retry a participant's activation.
for (const [phase, elapsed] of [
  ["pending", 32],
  ["active", 200],
] as const) {
  test(`external reset cancels a ${phase} peek`, async ({ mount, page }) => {
    await pauseClock(page);
    const component = await mount(<ScrollLifecycleHarness />);
    const scroller = await reveal(component, page, elapsed);
    await scroller.evaluate((el) =>
      el.scrollTo({ top: 0, behavior: "instant" }),
    );
    await page.clock.runFor(1000);
    await expect(scroller).toHaveJSProperty("scrollTop", 0);
  });

  test(`stage change cancels a ${phase} peek, including with CSS smooth scrolling`, async ({
    mount,
    page,
  }) => {
    await pauseClock(page);
    const component = await mount(<ScrollLifecycleHarness smooth />);
    const scroller = await reveal(component, page, elapsed);
    await component.update(<ScrollLifecycleHarness smooth resetKey="second" />);
    await expect(scroller).toHaveJSProperty("scrollTop", 0);
    await page.clock.runFor(1000);
    await expect(scroller).toHaveJSProperty("scrollTop", 0);
  });

  test(`cleanup cancels a ${phase} peek`, async ({ mount, page }) => {
    await pauseClock(page);
    const component = await mount(<ScrollLifecycleHarness />);
    const scroller = await reveal(component, page, elapsed);
    await component.update(<ScrollLifecycleHarness observing={false} />);
    const before = await scroller.evaluate((el) => el.scrollTop);
    await page.clock.runFor(1000);
    await expect(scroller).toHaveJSProperty("scrollTop", before);
  });

  test(`one pointer activation submits while a peek is ${phase}`, async ({
    mount,
    page,
  }) => {
    await pauseClock(page);
    const component = await mount(<ScrollLifecycleHarness />);
    await reveal(component, page, elapsed);
    const button = component.getByRole("button", {
      name: "Complete",
      exact: true,
    });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) throw new Error("Complete must be laid out");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.clock.runFor(400);
    await page.mouse.up();
    await expect(component.getByTestId("saves")).toHaveText("1");
    await expect(component.getByTestId("submits")).toHaveText("1");
  });
}

test("keyboard activation submits once during a peek", async ({
  mount,
  page,
}) => {
  await pauseClock(page);
  const component = await mount(<ScrollLifecycleHarness />);
  await reveal(component, page, 200);
  await component
    .getByRole("button", { name: "Complete", exact: true })
    .press("Enter");
  await page.clock.runFor(1000);
  await expect(component.getByTestId("saves")).toHaveText("1");
  await expect(component.getByTestId("submits")).toHaveText("1");
});

test("ordinary peek still moves toward new content without interaction", async ({
  mount,
  page,
}) => {
  await pauseClock(page);
  const component = await mount(<ScrollLifecycleHarness />);
  const scroller = await reveal(component, page, 32);
  await page.clock.runFor(1000);
  await expect(scroller).toHaveJSProperty("scrollTop", 670);
});

test("input before the mutation frame prevents a late peek", async ({
  mount,
  page,
}) => {
  await pauseClock(page);
  const component = await mount(<ScrollLifecycleHarness />);
  const scroller = await reveal(component, page, 0);
  await scroller.press("Shift");
  await page.clock.runFor(1000);
  await expect(scroller).toHaveJSProperty("scrollTop", 520);
  await expect(component.getByTestId("indicator")).toHaveText("true");
});

test("ordinary input does not announce new content when nothing grew", async ({
  mount,
  page,
}) => {
  await pauseClock(page);
  const component = await mount(<ScrollLifecycleHarness />);
  await component.getByRole("button", { name: "Warm up", exact: true }).click();
  await page.clock.runFor(32);
  await expect(component.getByTestId("indicator")).toHaveText("false");
  await component.getByTestId("scroller").click({ position: { x: 20, y: 20 } });
  await page.clock.runFor(1000);
  await expect(component.getByTestId("indicator")).toHaveText("false");
});

test("content growth cannot supersede an external reset in the same frame", async ({
  mount,
  page,
}) => {
  await pauseClock(page);
  const component = await mount(<ScrollLifecycleHarness />);
  const scroller = await reveal(component, page, 32);
  await scroller.evaluate((el) => {
    // The host reset runs before the mutation check in the next frame; the
    // browser's scroll event need not arrive before that check.
    requestAnimationFrame(() => el.scrollTo({ top: 0, behavior: "instant" }));
    const content = document.createElement("div");
    content.style.height = "300px";
    el.append(content);
  });
  await page.clock.runFor(1000);
  await expect(scroller).toHaveJSProperty("scrollTop", 0);
});
