import { test, expect } from "@playwright/experimental-ct-react";
import { Loading } from "./Loading";
import { LocaleProvider } from "../testing/LocaleProvider";

test("Loading switches between spin and static text with reduced motion (#642)", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const component = await mount(<Loading />);
  const spinner = component.locator("svg");
  const text = component.getByText("Loading", { exact: true });
  await expect(spinner).toHaveCSS("animation-name", "stagebook-spin");
  await expect(spinner).toHaveCSS("animation-duration", "0.75s");
  await expect(text).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(spinner).toHaveCSS("animation-name", "none");
  await expect(spinner).toHaveCSS("transform", "none");
  await expect(text).toBeVisible();
  await expect(spinner).toHaveAttribute("aria-label", "Loading");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(spinner).toHaveCSS("animation-name", "stagebook-spin");
  await expect(text).toBeHidden();
});

test("Loading's static text uses the locale catalog on first render (#642)", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount(
    <LocaleProvider locale="he">
      <Loading />
    </LocaleProvider>,
  );
  await expect(component.getByText("טוען", { exact: true })).toBeVisible();
  await expect(component.locator("svg")).toHaveAttribute("aria-label", "טוען");
  await expect(component.locator("svg")).toHaveCSS("animation-name", "none");
});
