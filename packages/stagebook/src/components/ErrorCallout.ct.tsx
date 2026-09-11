import { test, expect } from "@playwright/experimental-ct-react";
import { ErrorCallout } from "./ErrorCallout";
import { LocaleProvider } from "./testing/LocaleProvider";

test("standalone failure has alert semantics, a decorative icon and no empty disclosure", async ({
  mount,
  page,
}) => {
  await mount(<ErrorCallout>Invalid media URL</ErrorCallout>);
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText("Invalid media URL");
  await expect(alert.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(alert.locator("summary")).toHaveCount(0);
});

test("disclosure is keyboard operable, touch sized, and renders diagnostics as text", async ({
  mount,
  page,
}) => {
  const diagnostic = '<script>alert("example")</script>';
  await mount(
    <ErrorCallout title="Unable to load" details={diagnostic}>
      Please contact the study team.
    </ErrorCallout>,
  );
  const summary = page.locator("summary");
  const text = page.getByText(diagnostic, { exact: true });
  await expect(text).toBeHidden();
  await page.keyboard.press("Tab");
  await expect(summary).toBeFocused();
  const box = await summary.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter");
  await expect(text).toBeVisible();
  await expect(page.getByRole("alert").locator("script")).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(text).toBeHidden();
});

test("Hebrew provider supplies RTL and a localized disclosure", async ({
  mount,
  page,
}) => {
  await mount(
    <LocaleProvider locale="he">
      <ErrorCallout details="Network unavailable">השאלה לא נטענה</ErrorCallout>
    </LocaleProvider>,
  );
  const alert = page.getByRole("alert");
  await expect(alert).toHaveAttribute("dir", "rtl");
  await expect(alert.locator("summary")).toHaveText("פרטים טכניים");
  const icon = await alert.locator("svg").boundingBox();
  const summary = await alert.locator("summary").boundingBox();
  expect(icon!.x).toBeGreaterThan(summary!.x + summary!.width);
});

test("expanded long diagnostics reflow at 320px with enlarged text", async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await mount(
    <ErrorCallout
      title="This question couldn't load"
      details={`Error loading prompt https://example.test/${"long-path".repeat(30)}`}
    >
      Please contact the study team for help.
    </ErrorCallout>,
  );
  await page.locator("summary").click();
  await expect(page.getByRole("alert").locator("details p")).toBeVisible();
  const fits = await page
    .getByRole("alert")
    .evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(fits).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("standalone styling also works without the optional stylesheet", async ({
  mount,
  page,
}) => {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('link[rel="stylesheet"], style'))
      el.remove();
  });
  await mount(
    <ErrorCallout details="Network unavailable">
      This question couldn't load.
    </ErrorCallout>,
  );
  const alert = page.getByRole("alert");
  await expect(alert).toHaveCSS("color", "rgb(185, 28, 28)");
  await expect(alert).toHaveCSS("background-color", "rgb(254, 242, 242)");
  await expect(alert).toHaveCSS("border-top-color", "rgb(254, 202, 202)");
  await page.keyboard.press("Tab");
  await expect(page.locator("summary")).toBeFocused();
  await expect(page.locator("summary")).toHaveCSS("outline-style", "solid");
});
