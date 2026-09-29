import { test, expect } from "@playwright/experimental-ct-react";
import { PromptValidityHarness } from "../testing/PromptValidityHarness.js";
import { LocaleProvider } from "../testing/LocaleProvider.js";
import { Prompt } from "./Prompt.js";

for (const required of [false, true]) {
  test(`both isValid idioms follow text commits (required=${required})`, async ({
    mount,
  }) => {
    const component = await mount(
      <PromptValidityHarness required={required} />,
    );
    const answered = component.getByRole("button", {
      name: "Answered and valid",
    });
    const optional = component.getByRole("button", { name: "Optional valid" });
    const field = component.getByRole("textbox");
    await expect(answered).toHaveCount(0);
    await expect(optional).toBeVisible();
    await expect(component.getByTestId("required-marker")).toHaveCount(
      required ? 1 : 0,
    );
    await field.focus();
    await field.blur();
    await expect(answered).toHaveCount(required ? 0 : 1);
    await expect(optional).toHaveCount(required ? 0 : 1);
    await field.fill("ab");
    await field.blur();
    await expect(answered).toHaveCount(0);
    await expect(optional).toHaveCount(0);
    await field.fill("abc");
    await field.blur();
    await expect(answered).toBeVisible();
    await expect(optional).toBeVisible();
    await field.fill("");
    await field.blur();
    await expect(answered).toHaveCount(required ? 0 : 1);
    await expect(optional).toHaveCount(required ? 0 : 1);
  });

  test(`both isValid idioms follow checkbox selection and clearing (required=${required})`, async ({
    mount,
  }) => {
    const component = await mount(
      <PromptValidityHarness kind="checkbox" required={required} />,
    );
    const answered = component.getByRole("button", {
      name: "Answered and valid",
    });
    const optional = component.getByRole("button", { name: "Optional valid" });
    await expect(answered).toHaveCount(0);
    await expect(optional).toBeVisible();
    await component.getByRole("checkbox", { name: "Alpha" }).check();
    await expect(answered).toBeVisible();
    await expect(optional).toBeVisible();
    await component.getByRole("checkbox", { name: "Alpha" }).uncheck();
    await expect(answered).toHaveCount(required ? 0 : 1);
    await expect(optional).toHaveCount(required ? 0 : 1);
  });
}

for (const operator of ["all", "any"] as const) {
  test(`two prompts combine under ${operator} through the host store`, async ({
    mount,
  }) => {
    const component = await mount(
      <PromptValidityHarness two required operator={operator} />,
    );
    const answered = component.getByRole("button", {
      name: "Answered and valid",
    });
    const optional = component.getByRole("button", { name: "Optional valid" });
    const fields = component.getByRole("textbox");
    await expect(answered).toHaveCount(0);
    await expect(optional).toBeVisible();
    await fields.nth(0).fill("abc");
    await fields.nth(0).blur();
    await expect(answered).toHaveCount(operator === "all" ? 0 : 1);
    await fields.nth(1).fill("a");
    await fields.nth(1).blur();
    await expect(optional).toHaveCount(operator === "all" ? 0 : 1);
    await fields.nth(1).fill("abc");
    await fields.nth(1).blur();
    await expect(answered).toBeVisible();
    await expect(optional).toBeVisible();
  });
}

test("a condition-hidden prompt blocks the answered gate and permits the optional idiom", async ({
  mount,
}) => {
  const component = await mount(<PromptValidityHarness hidden />);
  await expect(component.getByRole("textbox")).toHaveCount(0);
  await expect(
    component.getByRole("button", { name: "Answered and valid" }),
  ).toHaveCount(0);
  await expect(
    component.getByRole("button", { name: "Optional valid" }),
  ).toBeVisible();
});

test("required Hebrew marker stays start-aligned and unchanged after answering and clearing", async ({
  mount,
}) => {
  const component = await mount(<PromptValidityHarness required locale="he" />);
  const marker = component.getByTestId("required-marker");
  const field = component.getByRole("textbox");
  await expect(marker).toHaveText("נדרש");
  await expect(marker).toHaveCSS("direction", "rtl");
  await expect(marker).toHaveCSS("text-align", "start");
  await expect(field).toHaveAttribute("aria-required", "true");
  expect(
    await marker.evaluate((element) => {
      const body = element.previousElementSibling;
      const control = element.nextElementSibling?.querySelector("textarea");
      return (
        body?.querySelector("p")?.textContent === "Question first" && !!control
      );
    }),
  ).toBe(true);
  for (const value of ["a", "abc", ""]) {
    await field.fill(value);
    await field.blur();
    await expect(marker).toHaveText("נדרש");
    await expect(
      component.locator(
        '[aria-invalid], [role="alert"], [data-testid="error-callout"]',
      ),
    ).toHaveCount(0);
    await expect(marker).not.toHaveAttribute("aria-live");
    await expect(component.getByTestId("char-counter")).not.toHaveAttribute(
      "aria-live",
    );
    await expect(marker).toHaveCSS("color", "rgb(98, 105, 119)");
  }
});

test("required radio/select use aria-required; checkbox group describes the static marker", async ({
  mount,
}) => {
  const component = await mount(
    <LocaleProvider locale="en">
      <div>
        <Prompt
          metadata={{ name: "radio", type: "multipleChoice", required: true }}
          name="radio"
          body="Radio"
          responseItems={["A", "B"]}
          value={undefined}
          save={() => {}}
        />
        <Prompt
          metadata={{
            name: "checks",
            type: "multipleChoice",
            select: "multiple",
            required: true,
          }}
          name="checks"
          body="Checks"
          responseItems={["A", "B"]}
          value={undefined}
          save={() => {}}
        />
        <Prompt
          metadata={{
            name: "select",
            type: "dropdown",
            placeholder: "Choose",
            required: true,
          }}
          name="select"
          body="Select"
          responseItems={["A", "B"]}
          value={undefined}
          save={() => {}}
        />
      </div>
    </LocaleProvider>,
  );
  await expect(component.getByTestId("required-marker")).toHaveCount(3);
  await expect(component.getByRole("radiogroup")).toHaveAttribute(
    "aria-required",
    "true",
  );
  await expect(component.getByRole("combobox")).toHaveAttribute(
    "aria-required",
    "true",
  );
  const group = component.getByRole("group");
  await expect(group).not.toHaveAttribute("aria-required");
  expect(
    await group.evaluate(
      (element) =>
        document.getElementById(element.getAttribute("aria-describedby")!)
          ?.textContent,
    ),
  ).toBe("Required");
});
