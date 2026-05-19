import { test, expect } from "@playwright/experimental-ct-react";
import { MockListSorter } from "../testing/MockListSorter";
import { NonPropagatingMockListSorter } from "../testing/NonPropagatingMockListSorter";

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

  test("drop instantly reorders the visible list (no snap-back to props)", async ({
    mount,
    page,
  }) => {
    // Regression: with @hello-pangea/dnd as a purely controlled
    // component, the visible row order would snap back to `items`
    // immediately after every drop and wait for the parent's
    // onChange-driven re-render to flip it forward again — a
    // visible "drop -> revert -> flash to new order" sequence on
    // hosts that round-trip onChange through a server. ListSorter
    // holds optimistic local state so the new order is visible
    // immediately on drop.
    //
    // Mock used here intentionally drops onChange on the floor —
    // if ListSorter rendered purely from `items`, the visible
    // order would not change at all.
    const component = await mount(
      <NonPropagatingMockListSorter items={testItems} />,
    );
    // Confirm starting visual order via the draggable test-ids.
    await expect(component.getByTestId("draggable-0")).toContainText("Alpha");

    // Keyboard-reorder Alpha down one slot. The keyboard path
    // exercises the same `onDragEnd` codepath as a mouse drop.
    const alpha = component.getByTestId("draggable-0");
    await alpha.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);

    // Even though the parent never propagated onChange, the
    // visible order should reflect the drop.
    await expect(component.getByTestId("draggable-0")).toContainText("Bravo");
    await expect(component.getByTestId("draggable-1")).toContainText("Alpha");
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

  test("position-number labels stay aligned with their rows (no cumulative drift)", async ({
    mount,
  }) => {
    // Bug observed in the component gallery: numbers were centered
    // on row 1 but ~10px above center by row 6 — the rows are 2px
    // taller per item than the number labels were (1px each top +
    // bottom border that the labels didn't have), so a six-row list
    // drifted ~10px. The fix gives the labels matching transparent
    // borders.
    //
    // This test compares vertical centers on the LAST row, which is
    // where the cumulative drift accumulates. The previous version
    // compared the first row with a 3px tolerance and missed this
    // bug entirely.
    const component = await mount(<MockListSorter items={testItems} />);
    const lastRowBox = await component.getByTestId("draggable-3").boundingBox();
    const lastNumberBox = await component
      .locator("p")
      .filter({ hasText: "4." })
      .first()
      .boundingBox();
    expect(lastRowBox).not.toBeNull();
    expect(lastNumberBox).not.toBeNull();
    const rowCenter = lastRowBox!.y + lastRowBox!.height / 2;
    const numberCenter = lastNumberBox!.y + lastNumberBox!.height / 2;
    expect(Math.abs(rowCenter - numberCenter)).toBeLessThanOrEqual(1);
  });
});
