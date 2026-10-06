import { test, expect } from "@playwright/experimental-ct-react";
import { ReferenceReadHarness } from "./testing/ReferenceReadHarness";

test("group Display retains a missing seat and its condition updates after the answer", async ({
  mount,
}) => {
  const component = await mount(<ReferenceReadHarness />);
  const quote = component.locator(
    'blockquote[data-reference="everyone.prompt.answer"]',
  );
  expect(await quote.textContent()).toBe("First\n\nThird");
  await expect(quote).toHaveCSS("white-space", "pre-wrap");
  await expect(
    component.getByRole("button", { name: "Everyone answered" }),
  ).toHaveCount(0);
  await component.getByRole("button", { name: "Answer middle seat" }).click();
  await expect(
    component.getByRole("button", { name: "Everyone answered" }),
  ).toBeVisible();
  expect(await quote.textContent()).toBe("First\nSecond\nThird");
});
