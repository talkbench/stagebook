import { test, expect } from "@playwright/experimental-ct-react";
import { NumericPromptHarness } from "../testing/NumericPromptHarness.js";

for (const locale of ["en", "he"]) {
  test(`numeric Prompt names, describes and saves a number through real references in ${locale}`, async ({
    mount,
  }) => {
    const component = await mount(<NumericPromptHarness locale={locale} />);
    const field = component.getByRole("textbox", { name: "Your estimate" });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute("aria-required", "true");
    await expect(field).toHaveAccessibleDescription(/\$.*per year/);
    const marker = component.getByTestId("required-marker");
    await expect(marker).toHaveText(locale === "he" ? "נדרש" : "Required");
    const atLeast = component.getByRole("button", {
      name: "At least eighteen",
    });
    const valid = component.getByRole("button", { name: "Valid answer" });
    await expect(atLeast).toHaveCount(0);
    await expect(valid).toHaveCount(0);
    await field.pressSequentially("25");
    await field.blur();
    await expect(component.getByTestId("numeric-record")).toContainText(
      '"value":25',
    );
    await expect(component.getByTestId("numeric-record")).toContainText(
      '"isValid":false',
    );
    await expect(atLeast).toBeEnabled();
    await expect(valid).toHaveCount(0);
    await field.fill("20");
    await field.blur();
    await expect(valid).toBeEnabled();
    await field.fill("3-4");
    await field.blur();
    await expect(atLeast).toHaveCount(0);
    await expect(component.getByTestId("numeric-record")).not.toContainText(
      '"value":',
    );
    await field.fill("");
    await field.blur();
    await expect(component.getByTestId("numeric-record")).toContainText(
      '"entry":""',
    );
    await expect(component.getByTestId("numeric-record")).toContainText(
      '"isValid":false',
    );
    await expect(
      component.locator('[aria-invalid], [aria-live], [role="alert"]'),
    ).toHaveCount(0);
    await expect(marker).toHaveText(locale === "he" ? "נדרש" : "Required");
  });
}

for (const initialEntry of ["007", "5."]) {
  test(`Element restores raw numeric ${initialEntry} on reload`, async ({
    mount,
  }) => {
    const component = await mount(
      <NumericPromptHarness
        initialEntry={initialEntry}
        savedFormat={{ decimal: ".", grouping: "," }}
      />,
    );
    await expect(component.getByRole("textbox")).toHaveValue(initialEntry);
    await component.getByRole("button", { name: "Reload question" }).click();
    await expect(component.getByRole("textbox")).toHaveValue(initialEntry);
    if (initialEntry === "5.")
      await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
        "data-state",
        "problem",
      );
  });
}

test("saved format survives Element reload and no-edit blur under a changed provider override", async ({
  mount,
}) => {
  const comma = { decimal: ",", grouping: "." };
  const dot = { decimal: ".", grouping: "," };
  const component = await mount(
    <NumericPromptHarness
      initialEntry="1,5"
      savedFormat={comma}
      numberFormat={dot}
    />,
  );
  const field = component.getByRole("textbox");
  await expect(field).toHaveValue("1,5");
  await field.focus();
  await field.blur();
  await expect(component.getByTestId("numeric-record")).toContainText(
    '"value":1.5',
  );
  await expect(component.getByTestId("numeric-record")).toContainText(
    '"numberFormat":{"decimal":",","grouping":"."}',
  );
  await component.getByRole("button", { name: "Reload question" }).click();
  await expect(field).toHaveValue("1,5");
  await field.fill("19.5");
  await field.blur();
  await expect(component.getByTestId("numeric-record")).toContainText(
    '"value":19.5',
  );
  await expect(component.getByTestId("numeric-record")).toContainText(
    '"numberFormat":{"decimal":".","grouping":","}',
  );
});
