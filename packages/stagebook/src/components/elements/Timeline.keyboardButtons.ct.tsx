import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "playwright/test";
import { MockTimeline } from "../testing/MockTimeline.js";

async function tabTo(page: Page, target: Locator) {
  // Start from a known focus point; this suite tests native navigation from
  // the annotation surface to its buttons, not browser chrome's initial Tab.
  const timeline = page.getByTestId("timeline");
  await timeline.focus();
  await expect(timeline).toBeFocused();
  if (await target.evaluate((el) => el === document.activeElement)) return;
  // Wait for each transition; Firefox can otherwise still report the old
  // activeElement immediately after press("Tab").
  const stops = [
    page.getByTestId("timeline-zoom-in"),
    ...(await page.getByTestId("track-mute").all()),
    page.getByTestId("timeline-help-button"),
  ];
  for (const stop of stops) {
    await page.keyboard.press("Tab");
    await expect(stop).toBeFocused();
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Timeline button was not reachable by Tab");
}

for (const selectionType of ["point", "range"] as const) {
  for (const key of ["Enter", "Space"]) {
    for (const control of ["zoom", "help", "mute"] as const) {
      test(`${selectionType}: ${key} activates ${control} without annotating`, async ({
        mount,
        page,
      }) => {
        await mount(
          <MockTimeline
            source="player"
            playerName="player"
            name="annotations"
            selectionType={selectionType}
            multiSelect
            mockCurrentTime={10}
            mockChannelCount={1}
          />,
        );
        const timeline = page.getByTestId("timeline");
        const button = page.getByTestId(
          control === "zoom"
            ? "timeline-zoom-in"
            : control === "help"
              ? "timeline-help-button"
              : "track-mute",
        );
        await tabTo(page, button);
        await page.keyboard.press(key);
        if (control === "zoom") {
          await expect(timeline).toHaveAttribute("data-zoom-level", "2");
          await page.keyboard.press("Shift+Tab");
          await expect(page.getByTestId("timeline-zoom-out")).toBeFocused();
          await page.keyboard.press(key);
          await expect(timeline).toHaveAttribute("data-zoom-level", "1");
        } else if (control === "help") {
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
          await expect(button).toBeFocused();
        } else {
          await expect(button).toHaveAttribute("aria-pressed", "true");
          await expect(page.getByTestId("mute-state")).toHaveText("[true]");
          await page.keyboard.press(key);
          await expect(button).toHaveAttribute("aria-pressed", "false");
          await expect(page.getByTestId("mute-state")).toHaveText("[false]");
        }
        await expect(page.getByTestId("range-0")).toHaveCount(0);
        await expect(page.getByTestId("point-0")).toHaveCount(0);
        await expect(page.getByTestId("save-log")).toHaveText("[]");
      });
    }
  }

  test(`${selectionType}: Enter still annotates the focused timeline after using a button`, async ({
    mount,
    page,
  }) => {
    await mount(
      <MockTimeline
        source="player"
        playerName="player"
        name="annotations"
        selectionType={selectionType}
        mockCurrentTime={10}
      />,
    );
    await tabTo(page, page.getByTestId("timeline-zoom-in"));
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("timeline")).toHaveAttribute(
      "data-zoom-level",
      "2",
    );
    // Return through zoom-out to the annotation surface using real keyboard navigation.
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("timeline-zoom-out")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("timeline")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(`${selectionType}-0`)).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("save-log")).not.toHaveText("[]");
  });
}

test("focused button keys cannot edit an active annotation", async ({
  mount,
  page,
}) => {
  await mount(
    <MockTimeline
      source="player"
      playerName="player"
      name="annotations"
      selectionType="point"
      mockCurrentTime={10}
    />,
  );
  await tabTo(page, page.getByTestId("timeline"));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("point-0")).toBeAttached();
  // The selection renders before its save effect necessarily reaches the
  // host. Compare against the completed initial save, not a transient [].
  await expect(page.getByTestId("save-log")).not.toHaveText("[]");
  const saved = await page.getByTestId("save-log").textContent();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("timeline-zoom-in")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("point-0")).toBeAttached();
  await expect(page.getByTestId("save-log")).toHaveText(saved!);
});
