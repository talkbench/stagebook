import { test, expect } from "@playwright/experimental-ct-react";
import { Select } from "./Select";
import { MockSelect } from "../testing/MockSelect";

const options = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
  { key: "c", value: "Option C" },
];

test.describe("Select", () => {
  test("renders all options", async ({ mount }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    await expect(component.locator("option")).toHaveCount(3);
    await expect(component).toContainText("Option A");
    await expect(component).toContainText("Option B");
    await expect(component).toContainText("Option C");
  });

  test("shows selected option as the select's value", async ({ mount }) => {
    const component = await mount(
      <Select options={options} value="b" onChange={() => {}} />,
    );
    await expect(component.locator("select")).toHaveValue("b");
  });

  test("renders label when provided", async ({ mount }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} label="Pick one" />,
    );
    await expect(component).toContainText("Pick one");
  });

  test("renders placeholder as a leading disabled option", async ({
    mount,
  }) => {
    const component = await mount(
      <Select
        options={options}
        onChange={() => {}}
        placeholder="Choose a fruit…"
      />,
    );
    // 4 options total: 1 placeholder + 3 real options
    await expect(component.locator("option")).toHaveCount(4);
    await expect(component).toContainText("Choose a fruit…");
    // The placeholder is the implicit selection when no value is set.
    await expect(component.locator("select")).toHaveValue("");
    // And it's disabled — researchers can't pick the placeholder as a
    // real answer.
    await expect(component.locator('option[value=""]')).toHaveAttribute(
      "disabled",
      "",
    );
  });

  test("changing selection fires onChange with the chosen key", async ({
    mount,
  }) => {
    const component = await mount(<MockSelect options={options} />);
    // Nothing selected initially (no value, no placeholder).
    await component.locator("select").selectOption("b");
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("b");

    await component.locator("select").selectOption("a");
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("a");
  });

  test("disabled options render as disabled", async ({ mount }) => {
    const optsWithDisabled = [
      { key: "a", value: "Option A" },
      { key: "b", value: "Option B (unavailable)", disabled: true },
      { key: "c", value: "Option C" },
    ];
    const component = await mount(
      <Select options={optsWithDisabled} onChange={() => {}} />,
    );
    await expect(component.locator('option[value="b"]')).toHaveAttribute(
      "disabled",
      "",
    );
    await expect(component.locator('option[value="a"]')).not.toHaveAttribute(
      "disabled",
      "",
    );
  });

  test("hidden options are not rendered at all", async ({ mount }) => {
    // `hidden: true` is for runtime filtering — the option doesn't
    // appear in the dropdown. Distinct from `disabled` (visible but
    // not selectable).
    const optsWithHidden = [
      { key: "a", value: "Option A" },
      { key: "b", value: "Option B (hidden)", hidden: true },
      { key: "c", value: "Option C" },
    ];
    const component = await mount(
      <Select options={optsWithHidden} onChange={() => {}} />,
    );
    await expect(component.locator("option")).toHaveCount(2);
    await expect(component.locator('option[value="b"]')).toHaveCount(0);
  });

  test("data-testid falls back to id", async ({ mount }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} id="myPicker" />,
    );
    // Wrapper carries the data-testid; the root mounted component IS
    // the wrapper.
    await expect(component).toHaveAttribute("data-testid", "myPicker");
  });

  test("explicit data-testid overrides id", async ({ mount }) => {
    const component = await mount(
      <Select
        options={options}
        onChange={() => {}}
        id="myPicker"
        data-testid="customId"
      />,
    );
    await expect(component).toHaveAttribute("data-testid", "customId");
  });
});
