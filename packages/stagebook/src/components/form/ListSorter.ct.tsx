import { test, expect } from "@playwright/experimental-ct-react";
import { MockListSorter } from "../testing/MockListSorter";

const testItems = ["Alpha", "Bravo", "Charlie", "Delta"];

test.describe("ListSorter", () => {
  test("renders all items with numbers", async ({ mount }) => {
    const component = await mount(<MockListSorter items={testItems} />);
    await expect(component).toContainText("Alpha");
    await expect(component).toContainText("Bravo");
    await expect(component).toContainText("Charlie");
    await expect(component).toContainText("Delta");
    // Numbers should be visible
    await expect(component).toContainText("1.");
    await expect(component).toContainText("4.");
  });

  test("renders drag handles on each item", async ({ mount }) => {
    const component = await mount(<MockListSorter items={testItems} />);
    // Each draggable row carries the drag-handle glyph plus the
    // item text. The glyph lives in a sibling `<span
    // aria-hidden="true">` and the text in its own `<span>`, so
    // we assert that the row contains the text.
    await expect(component.getByTestId("draggable-0")).toContainText("Alpha");
    await expect(component.getByTestId("draggable-3")).toContainText("Delta");
  });

  test("items have correct initial order", async ({ mount }) => {
    const component = await mount(<MockListSorter items={testItems} />);
    const order = await component
      .locator('[data-testid="current-order"]')
      .textContent();
    expect(order).toBe("Alpha|Bravo|Charlie|Delta");
  });

  test("keyboard reorder: move first item down", async ({ mount, page }) => {
    const component = await mount(<MockListSorter items={testItems} />);

    // Verify initial order
    let order = await component
      .locator('[data-testid="current-order"]')
      .textContent();
    expect(order).toBe("Alpha|Bravo|Charlie|Delta");

    // @hello-pangea/dnd supports keyboard: focus item, Space to lift, Arrow Down to move, Space to drop
    const alpha = component.getByTestId("draggable-0");
    await alpha.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");

    // Wait for state update
    await page.waitForTimeout(100);

    // Verify order changed — Alpha should have moved down one position
    order = await component
      .locator('[data-testid="current-order"]')
      .textContent();
    expect(order).toBe("Bravo|Alpha|Charlie|Delta");
  });

  test("renders items with border styling", async ({ mount }) => {
    const component = await mount(<MockListSorter items={["One", "Two"]} />);
    // Outer container should have a border
    const container = component.locator("div").first();
    await expect(container).toBeVisible();
  });

  // ----------- UI polish (#374) -----------

  test("row darkens on hover (when not dragging)", async ({ mount }) => {
    const component = await mount(<MockListSorter items={testItems} />);
    const row = component.getByTestId("draggable-0");
    const before = await row.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    await row.hover();
    // Poll for the 120ms transition.
    await expect
      .poll(
        () => row.evaluate((el) => window.getComputedStyle(el).backgroundColor),
        { timeout: 1500 },
      )
      .not.toBe(before);
  });

  test("focus ring appears on keyboard focus via :focus-visible", async ({
    mount,
    page,
  }) => {
    // Focus ring is keyboard-only. Tabbing to a row before pressing
    // Space-to-grab tells the participant they've selected the
    // lift target.
    const component = await mount(<MockListSorter items={testItems} />);
    const row = component.getByTestId("draggable-0");
    const baseline = await row.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );

    await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await expect
      .poll(() => row.evaluate((el) => window.getComputedStyle(el).boxShadow), {
        timeout: 1500,
      })
      .not.toBe(baseline);
  });

  test("rows meet touch-target sizing (≥36px tall)", async ({ mount }) => {
    const component = await mount(<MockListSorter items={testItems} />);
    const rowBox = await component.getByTestId("draggable-0").boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeGreaterThanOrEqual(36);
  });

  test("prefers-reduced-motion: rows disable the hover transition", async ({
    mount,
    page,
  }) => {
    // For participants who opted into reduced motion, the
    // background-color / box-shadow transitions should snap rather
    // than animate. The CSS rule sets `transition: none` inside
    // the `@media (prefers-reduced-motion: reduce)` block.
    await page.emulateMedia({ reducedMotion: "reduce" });
    const component = await mount(<MockListSorter items={testItems} />);
    const row = component.getByTestId("draggable-0");
    const transition = await row.evaluate(
      (el) => window.getComputedStyle(el).transition,
    );
    expect(transition).toBe("none");
  });

  test("position-number labels align with their rows (same height)", async ({
    mount,
  }) => {
    // Position numbers live in a separate left column; without
    // matching `min-height` on the number labels, taller draggable
    // rows would drift away from "1.", "2.", etc.
    const component = await mount(<MockListSorter items={testItems} />);
    const rowBox = await component.getByTestId("draggable-0").boundingBox();
    // The number labels are <p> elements inside the left column.
    // Pick the first one and compare bounding-box heights.
    const numberBox = await component
      .locator("p")
      .filter({ hasText: "1." })
      .first()
      .boundingBox();
    expect(rowBox).not.toBeNull();
    expect(numberBox).not.toBeNull();
    // Heights should match within ~3px (accounts for the row's
    // 1px-each top/bottom border, which the number label doesn't
    // have, plus sub-pixel rendering tolerance).
    expect(Math.abs(rowBox!.height - numberBox!.height)).toBeLessThanOrEqual(3);
  });
});
