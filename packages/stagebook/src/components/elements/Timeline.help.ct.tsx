import { test, expect } from "@playwright/experimental-ct-react";
import { MockTimeline } from "../testing/MockTimeline.js";
import { LocaleProvider } from "../testing/LocaleProvider.js";

const props = {
  source: "player",
  playerName: "player",
  name: "help",
  selectionType: "range" as const,
  mockWidth: "100%",
};

test("help button exposes expansion and its dialog relationship", async ({
  mount,
  page,
}) => {
  await mount(<MockTimeline {...props} />);
  const button = page.getByTestId("timeline-help-button");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toHaveAttribute("aria-haspopup", "dialog");
  await button.click();
  const dialog = page.getByRole("dialog", {
    name: "Timeline keyboard shortcuts",
  });
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(dialog).toHaveAttribute(
    "id",
    (await button.getAttribute("aria-controls"))!,
  );
  await button.click();
  await expect(dialog).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
});

test("opening help focuses its content; Escape returns to the trigger without annotating", async ({
  mount,
  page,
}) => {
  await mount(<MockTimeline {...props} />);
  const button = page.getByTestId("timeline-help-button");
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("]");
  await expect(page.getByTestId("save-log")).toHaveText("[]");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
});

for (const key of ["Tab", "Shift+Tab"]) {
  test(`${key} closes help and continues from the trigger in page order`, async ({
    mount,
    page,
  }) => {
    await mount(
      <div>
        <MockTimeline {...props} />
        <input aria-label="After timeline" />
      </div>,
    );
    await page.getByTestId("timeline-help-button").click();
    await expect(page.getByRole("dialog")).toBeFocused();
    if (key === "Tab") {
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Close keyboard shortcuts" }),
      ).toBeFocused();
    }
    await page.keyboard.press(key);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      key === "Tab"
        ? page.getByRole("textbox", { name: "After timeline" })
        : page.getByTestId("track-mute"),
    ).toBeFocused();
  });
}

test("outside click dismisses help without stealing the destination's focus", async ({
  mount,
  page,
}) => {
  await mount(
    <div>
      <MockTimeline {...props} />
      <input aria-label="After timeline" />
    </div>,
  );
  await page.getByTestId("timeline-help-button").click();
  await expect(page.getByRole("dialog")).toBeFocused();
  await page.getByRole("textbox", { name: "After timeline" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "After timeline" }),
  ).toBeFocused();
});

for (const locale of ["en", "he"]) {
  for (const size of [
    { width: 320, height: 720, font: "200%" },
    { width: 800, height: 200, font: "100%" },
  ]) {
    test(`${locale}: help reflows and keyboard-scrolls at ${size.width}x${size.height}, ${size.font} text`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize(size);
      await page.addStyleTag({
        content: `html { font-size: ${size.font} !important; }`,
      });
      await mount(
        <LocaleProvider locale={locale}>
          <MockTimeline {...props} />
        </LocaleProvider>,
      );
      await page.getByTestId("timeline-help-button").click();
      const dialog = page.getByRole("dialog");
      await expect
        .poll(async () =>
          dialog.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return (
              rect.left >= 4 &&
              rect.top >= 4 &&
              rect.right <= innerWidth - 4 &&
              rect.bottom <= innerHeight - 4 &&
              el.scrollWidth <= el.clientWidth
            );
          }),
        )
        .toBe(true);
      await expect(dialog).toBeFocused();
      await page.keyboard.press("End");
      await expect
        .poll(() => dialog.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await expect
        .poll(async () => {
          const outer = await dialog.boundingBox();
          const last = await dialog.locator("tr").last().boundingBox();
          return (
            !!outer && !!last && last.y + last.height <= outer.y + outer.height
          );
        })
        .toBe(true);
      if (testInfo.project.name === "chromium")
        await page.screenshot({ path: testInfo.outputPath("help.png") });
    });
  }
}

test("open help responds to viewport, text-size and locale changes", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const component = await mount(
    <LocaleProvider locale="en">
      <MockTimeline {...props} />
    </LocaleProvider>,
  );
  await page.getByTestId("timeline-help-button").click();
  await page.setViewportSize({ width: 320, height: 400 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await component.update(
    <LocaleProvider locale="he">
      <MockTimeline {...props} />
    </LocaleProvider>,
  );
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("dir", "rtl");
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 4 &&
          r.top >= 4 &&
          r.right <= innerWidth - 4 &&
          r.bottom <= innerHeight - 4 &&
          el.scrollWidth <= el.clientWidth
        );
      }),
    )
    .toBe(true);
  await expect(dialog).toBeFocused();
});

test("Close stays reachable after scrolling and restores the trigger", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 400 });
  await mount(<MockTimeline {...props} />);
  const trigger = page.getByTestId("timeline-help-button");
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await page.keyboard.press("End");
  const close = page.getByRole("button", { name: "Close keyboard shortcuts" });
  await expect(close).toBeInViewport();
  const box = await close.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toBeFocused();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
