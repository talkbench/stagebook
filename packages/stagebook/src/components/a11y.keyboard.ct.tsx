// Step-4 verification for the a11y audit (#20): does ListSorter's drag-to-reorder
// have a working keyboard alternative (WCAG 2.5.7 Dragging Movements)?
// @hello-pangea/dnd ships a keyboard sensor (focus a row → Space to lift →
// arrows to move → Space to drop); this proves it actually works in our config.
import { test, expect } from "@playwright/experimental-ct-react";
import { MockListSorter } from "./testing/MockListSorter";

test("ListSorter is reorderable by keyboard alone (WCAG 2.5.7)", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <MockListSorter items={["Alpha", "Bravo", "Charlie", "Delta"]} />,
  );
  const order = component.locator('[data-testid="current-order"]');
  await expect(order).toHaveText("Alpha|Bravo|Charlie|Delta");

  // Focus the first draggable row and drive the @hello-pangea/dnd keyboard
  // sensor: Space lifts, ArrowDown moves one slot, Space drops.
  await component.getByTestId("draggable-0").focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await page.waitForTimeout(150);

  // Alpha should have moved from slot 1 to slot 2.
  await expect(order).toHaveText("Bravo|Alpha|Charlie|Delta");
});
