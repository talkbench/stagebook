import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator } from "@playwright/test";
import { ScrollViewer } from "./testing/ScrollViewer.js";

test.use({ viewport: { width: 1280, height: 600 } });

async function scrollDown(main: Locator) {
  await main.evaluate((element) => {
    element.scrollTop = 400;
  });
  await expect(main).toHaveJSProperty("scrollTop", 400);
}

for (const route of ["next", "previous", "stage picker", "unit", "reset"]) {
  test(`Viewer starts at the top after ${route} navigation`, async ({
    mount,
  }) => {
    const component = await mount(<ScrollViewer />);
    const main = component.getByRole("main");
    const stagePicker = component.locator("header select").nth(1);
    await expect(main.getByRole("radio", { name: "Alpha" })).toBeAttached();

    if (route === "previous") {
      await component.getByRole("button", { name: "Next stage" }).click();
      await expect(stagePicker).toHaveValue("1");
    }
    await scrollDown(main);

    if (route === "next") {
      await component.getByRole("button", { name: "Next stage" }).click();
      await expect(stagePicker).toHaveValue("1");
    } else if (route === "previous") {
      await component.getByRole("button", { name: "Previous stage" }).click();
      await expect(stagePicker).toHaveValue("0");
    } else if (route === "stage picker") {
      await stagePicker.selectOption("1");
    } else if (route === "unit") {
      await component
        .getByRole("combobox", { name: "Part to preview" })
        .selectOption("treatment:1");
    } else {
      await component.getByRole("button", { name: "Clear all state" }).click();
      await component.getByRole("button", { name: "Confirm clear" }).click();
    }

    await expect(main).toHaveJSProperty("scrollTop", 0);
  });
}

test("Viewer preserves scroll during same-stage context and response updates", async ({
  mount,
}) => {
  const component = await mount(<ScrollViewer />);
  const main = component.getByRole("main");
  const answer = main.getByRole("radio", { name: "Alpha" });
  await expect(answer).toBeAttached();
  await scrollDown(main);

  await component.getByRole("combobox", { name: "Position" }).selectOption("1");
  await expect(main).toHaveJSProperty("scrollTop", 400);

  await answer.scrollIntoViewIfNeeded();
  const beforeAnswer = await main.evaluate((element) => element.scrollTop);
  expect(beforeAnswer).toBeGreaterThan(0);
  await answer.check();
  await expect(answer).toBeChecked();
  await expect(main).toHaveJSProperty("scrollTop", beforeAnswer);
});
