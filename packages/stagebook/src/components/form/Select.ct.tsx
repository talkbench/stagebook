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
    // It uses an internal sentinel value (not "") so it can't collide
    // with a researcher-authored option whose key is "".
    const placeholderValue = "__stagebook_select_placeholder__";
    await expect(component.locator("select")).toHaveValue(placeholderValue);
    // And it's disabled — researchers can't pick the placeholder as a
    // real answer.
    await expect(
      component.locator(`option[value="${placeholderValue}"]`),
    ).toHaveAttribute("disabled", "");
  });

  test("placeholder sentinel doesn't collide with empty-string option key", async ({
    mount,
  }) => {
    // A response line like `- ` (just the dash) parses to an empty
    // option string. Using "" as the placeholder value would have
    // made it impossible to select the empty option. Sentinel value
    // sidesteps this entirely.
    const optsWithEmptyKey = [
      { key: "", value: "(no answer)" },
      { key: "yes", value: "Yes" },
      { key: "no", value: "No" },
    ];
    const component = await mount(
      <Select
        options={optsWithEmptyKey}
        onChange={() => {}}
        placeholder="Pick…"
      />,
    );
    // Both the placeholder and the empty-key option exist with
    // distinct values — no collision.
    await expect(component.locator("option")).toHaveCount(4);
    await expect(component.locator('option[value=""]')).toHaveCount(1);
    await expect(component.locator('option[value=""]')).toContainText(
      "(no answer)",
    );
  });

  test("changing selection fires onChange with the chosen key", async ({
    mount,
  }) => {
    const component = await mount(<MockSelect options={options} />);
    // No tracked value initially. The browser visibly defaults to the
    // first option (standard <select> behavior); MockSelect's
    // `selected-value` div is empty until the user actually changes
    // the selection. Callers that want the visible-vs-saved state to
    // line up should either pass an initial `value` or use a
    // placeholder. (See also the dropdown-prompt auto-save in
    // Prompt.tsx, which handles this for the dropdown prompt case.)
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

  // ----------- UI polish (#370) -----------

  test("focus ring appears on keyboard focus and disappears on blur", async ({
    mount,
    page,
  }) => {
    // The focus ring lives in the component's `<style>` block (a
    // class-scoped `:focus-visible` rule), so we assert on computed
    // `boxShadow` rather than inline style.
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const select = component.locator("select");

    // Tab into the page — first focusable element is the <select>.
    await page.keyboard.press("Tab");
    await expect(select).toBeFocused();
    const shadowFocused = await select.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(shadowFocused).not.toBe("none");

    // Blur — ring should go away.
    await select.evaluate((el) => (el as HTMLElement).blur());
    // Poll for the 120ms box-shadow transition.
    await expect
      .poll(
        () => select.evaluate((el) => window.getComputedStyle(el).boxShadow),
        { timeout: 1500 },
      )
      .toBe("none");
  });

  // Note: mouse-click on a <select> DOES trigger :focus-visible in
  // Chromium (the open dropdown is keyboard-navigable), unlike the
  // input-based Radio/Checkbox cases. That's correct browser behavior
  // for a combobox-style trigger, so we don't assert the
  // mouse-click-doesn't-ring case for Select.
  //
  // Hover affordance is intentionally omitted on the trigger. The
  // caret arrow makes interactivity obvious; shadcn/Radix don't add
  // a separate hover style here either. Whole-row hover only makes
  // sense for the radio/checkbox option-row case where the entire
  // row is a click target without an explicit affordance.

  test("trigger meets touch-target sizing (≥36px tall)", async ({ mount }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const box = await component.locator("select").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test("focused-then-blurred trigger doesn't leave a stuck border color (no #367-style bleed)", async ({
    mount,
  }) => {
    // Regression guard for the shorthand-vs-longhand border bug that
    // bit RadioGroup (#367) — the same pattern was latent on Select
    // because base style used `border` shorthand and the focus state
    // overrides `borderColor` (longhand). Compare a never-touched
    // Select's border to one that's been focused then blurred.
    const component = await mount(
      <div>
        <Select options={options} onChange={() => {}} data-testid="touched" />
        <Select options={options} onChange={() => {}} data-testid="untouched" />
      </div>,
    );
    const touched = component.locator('[data-testid="touched"] select');
    const untouched = component.locator('[data-testid="untouched"] select');

    await touched.focus();
    await touched.blur();

    const touchedBorder = await touched.evaluate(
      (el) => window.getComputedStyle(el).borderColor,
    );
    const untouchedBorder = await untouched.evaluate(
      (el) => window.getComputedStyle(el).borderColor,
    );
    expect(touchedBorder).toBe(untouchedBorder);
  });

  // -- Font (#399) — symmetric with the TextArea tests --

  test("select font matches the surrounding page (not the browser UA default)", async ({
    mount,
  }) => {
    // Mirror of the TextArea regression test. Native <select> picks
    // up a browser UA-default font when font-family isn't set, which
    // drifts cross-browser. The inline style in Select.tsx pins the
    // same --stagebook-font cascade as TextArea.
    const component = await mount(
      <Select options={options} value="a" onChange={() => undefined} />,
    );
    const select = component.locator("select");
    const fontFamily = await select.evaluate(
      (el) => window.getComputedStyle(el).fontFamily,
    );
    const bodyFontFamily = await component.evaluate(
      () => window.getComputedStyle(document.body).fontFamily,
    );
    expect(fontFamily).toBe(bodyFontFamily);
    expect(fontFamily.toLowerCase()).not.toMatch(/mono|courier/);
  });

  test("select font respects --stagebook-font override", async ({ mount }) => {
    const component = await mount(
      <div style={{ ["--stagebook-font" as never]: "Helvetica, sans-serif" }}>
        <Select options={options} value="a" onChange={() => undefined} />
      </div>,
    );
    const select = component.locator("select");
    const fontFamily = await select.evaluate(
      (el) => window.getComputedStyle(el).fontFamily,
    );
    expect(fontFamily).toMatch(/Helvetica/);
  });
});
