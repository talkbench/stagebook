import { test, expect } from "@playwright/experimental-ct-react";
import { CheckboxGroup } from "./CheckboxGroup";
import { MockCheckboxGroup } from "../testing/MockCheckboxGroup";

const options = [
  { key: "x", value: "Choice X" },
  { key: "y", value: "Choice Y" },
  { key: "z", value: "Choice Z" },
];

test.describe("CheckboxGroup", () => {
  test("renders all options", async ({ mount }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );
    await expect(component.locator('input[type="checkbox"]')).toHaveCount(3);
  });

  test("shows selected options as checked", async ({ mount }) => {
    const component = await mount(
      <CheckboxGroup
        options={options}
        value={["x", "z"]}
        onChange={() => {}}
      />,
    );
    await expect(component.locator('input[value="x"]')).toBeChecked();
    await expect(component.locator('input[value="y"]')).not.toBeChecked();
    await expect(component.locator('input[value="z"]')).toBeChecked();
  });

  test("clicking an unchecked option selects it", async ({ mount }) => {
    const component = await mount(<MockCheckboxGroup options={options} />);
    await expect(
      component.locator('[data-testid="selected-values"]'),
    ).toHaveText("");

    await component.getByText("Choice Y").click();
    await expect(
      component.locator('[data-testid="selected-values"]'),
    ).toHaveText("y");
  });

  test("clicking a checked option deselects it", async ({ mount }) => {
    const component = await mount(
      <MockCheckboxGroup options={options} initialValue={["x", "z"]} />,
    );
    await expect(
      component.locator('[data-testid="selected-values"]'),
    ).toHaveText("x|z");

    await component.getByText("Choice X").click();
    await expect(
      component.locator('[data-testid="selected-values"]'),
    ).toHaveText("z");
  });

  test("multiple selections accumulate", async ({ mount }) => {
    const component = await mount(<MockCheckboxGroup options={options} />);

    await component.getByText("Choice X").click();
    await component.getByText("Choice Z").click();
    await expect(
      component.locator('[data-testid="selected-values"]'),
    ).toHaveText("x|z");
  });

  // Issue #213: checkbox visual styling moved from styles.css to inline
  // so the checkbox renders with a visible check + primary-color fill on
  // hosts that don't import stagebook/styles.
  test("unchecked checkbox has inline base styling (surface bg, bordered)", async ({
    mount,
  }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );
    const { appearance, borderRadius, backgroundColor } = await component
      .locator('input[value="x"]')
      .evaluate((el) => ({
        appearance: (el as HTMLElement).style.appearance,
        borderRadius: (el as HTMLElement).style.borderRadius,
        backgroundColor: (el as HTMLElement).style.backgroundColor,
      }));
    expect(appearance).toBe("none");
    // Small rounded square (not radio's 9999px)
    expect(borderRadius).toBe("0.125rem");
    expect(backgroundColor).toContain("--stagebook-surface");
  });

  test("checked checkbox has inline primary fill + check SVG", async ({
    mount,
  }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={["x"]} onChange={() => {}} />,
    );
    const { backgroundColor, backgroundImage } = await component
      .locator('input[value="x"]')
      .evaluate((el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        backgroundImage: (el as HTMLElement).style.backgroundImage,
      }));
    expect(backgroundColor).toContain("--stagebook-primary");
    expect(backgroundImage).toContain("data:image/svg+xml");
  });

  test("previously-checked box reverts to gray border after deselection (no color bleed)", async ({
    mount,
  }) => {
    // Mirrors the RadioGroup regression test (#367) — the
    // shorthand-vs-longhand border bug applies identically to
    // CheckboxGroup. Toggling a checkbox off must not leave its
    // border stuck at the previous fill color.
    const component = await mount(
      <MockCheckboxGroup options={options} initialValue={["x"]} />,
    );

    // Sanity: X starts checked, Y is untouched
    await expect(component.locator('input[value="x"]')).toBeChecked();
    await expect(component.locator('input[value="y"]')).not.toBeChecked();

    // Click X to uncheck it
    await component.getByText("Choice X").click();
    await expect(component.locator('input[value="x"]')).not.toBeChecked();

    // X (just unchecked) and Y (never clicked) should have the same
    // gray border. Pre-fix this would have left X with rgb(0, 0, 0).
    const xBorder = await component
      .locator('input[value="x"]')
      .evaluate((el) => window.getComputedStyle(el).borderColor);
    const yBorder = await component
      .locator('input[value="y"]')
      .evaluate((el) => window.getComputedStyle(el).borderColor);
    expect(xBorder).toBe(yBorder);
  });

  test("focus ring appears on keyboard focus via :focus-visible", async ({
    mount,
    page,
  }) => {
    // Focus ring is keyboard-only — `:focus-visible` rather than
    // `:focus` so a mouse click doesn't leave a lingering ring on
    // the just-clicked option. The ring is delivered via the
    // component's `<style>` block, so we assert on computed
    // `boxShadow` rather than inline style.
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );

    await page.keyboard.press("Tab");
    const focused = component.locator('input[value="x"]');
    await expect(focused).toBeFocused();
    const shadow = await focused.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(shadow).not.toBe("none");
  });

  test("mouse click does not leave a focus ring on the clicked checkbox (:focus-visible)", async ({
    mount,
  }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );
    const input = component.locator('input[value="x"]');
    await input.click();

    const shadow = await input.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(shadow).toBe("none");
  });

  test("option row gets a hover background fill (#350 whole-row hover)", async ({
    mount,
  }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );
    const row = component.locator('[data-testid="option"]').first();

    const before = await row.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    await row.hover();
    // Poll to allow for the 120ms background-color transition.
    await expect
      .poll(
        () => row.evaluate((el) => window.getComputedStyle(el).backgroundColor),
        { timeout: 1500 },
      )
      .not.toBe(before);
  });

  test("long option labels wrap without losing hover-fill coverage", async ({
    mount,
  }) => {
    // Guard against a regression where someone sets `height` instead
    // of `minHeight` — a fixed height would clip a wrapping label and
    // the hover-fill would not cover the wrapped lines.
    const longOptions = [
      {
        key: "x",
        value:
          "A deliberately long option label that should wrap across multiple lines when constrained to a narrow column so we can verify the row grows to fit",
      },
      { key: "y", value: "Short" },
    ];
    const component = await mount(
      <div style={{ width: "240px" }}>
        <CheckboxGroup options={longOptions} value={[]} onChange={() => {}} />
      </div>,
    );
    const longRow = component.locator('[data-testid="option"]').first();
    const box = await longRow.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(50);
  });

  test("options container has role=group and is labelled by the legend", async ({
    mount,
  }) => {
    const component = await mount(
      <CheckboxGroup
        options={options}
        value={[]}
        onChange={() => {}}
        label="Pick all that apply"
      />,
    );
    // `role="group"` is the right ARIA role for a collection of
    // related checkboxes — there's no `role="checkboxgroup"`. The
    // `aria-labelledby` points at the legend label so AT announces
    // the group name when entering.
    const group = component.locator('[role="group"]');
    await expect(group).toBeVisible();
    const labelledById = await group.getAttribute("aria-labelledby");
    expect(labelledById).not.toBeNull();
    const legend = component.locator(`#${labelledById!}`);
    await expect(legend).toHaveText("Pick all that apply");
  });

  test("row meets touch-target sizing (≥36px tall)", async ({ mount }) => {
    const component = await mount(
      <CheckboxGroup options={options} value={[]} onChange={() => {}} />,
    );
    const rowBox = await component
      .locator('[data-testid="option"]')
      .first()
      .boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.height).toBeGreaterThanOrEqual(36);
  });

  test("inline styles survive an aggressive host CSS reset (issue #213)", async ({
    mount,
  }) => {
    const resetCSS = `
      input[type="checkbox"] {
        appearance: auto;
        border: 2px solid red;
        background: yellow;
        border-radius: 0;
      }
    `;
    const component = await mount(
      <div>
        <style dangerouslySetInnerHTML={{ __html: resetCSS }} />
        <CheckboxGroup options={options} value={["x"]} onChange={() => {}} />
      </div>,
    );
    const { appearance, borderRadius } = await component
      .locator('input[value="x"]')
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { appearance: cs.appearance, borderRadius: cs.borderRadius };
      });
    expect(appearance).toBe("none");
    expect(borderRadius).not.toBe("0px");
  });
});

test.describe("CheckboxGroup: label validity, null value, reduced motion", () => {
  test("group label carries no dangling for/id reference (#595)", async ({
    mount,
  }) => {
    // The group label names the group through aria-labelledby. A `for`
    // attribute pointing at an id nothing carries is invalid HTML and
    // focuses nothing when the label is clicked.
    const component = await mount(
      <CheckboxGroup options={options} onChange={() => {}} label="Pick some" />,
    );
    const dangling = await component.evaluate((root) =>
      Array.from(root.querySelectorAll("label[for]"))
        .map((l) => l.getAttribute("for") ?? "")
        .filter((id) => !document.getElementById(id)),
    );
    expect(dangling).toEqual([]);
  });

  test("value={null} renders nothing checked instead of throwing (#606)", async ({
    mount,
  }) => {
    // JS consumers can pass null before async data arrives. The default
    // parameter only covers `undefined`, so null must be guarded too.
    const component = await mount(
      <CheckboxGroup
        options={options}
        value={null as unknown as string[]}
        onChange={() => {}}
      />,
    );
    const boxes = component.locator('input[type="checkbox"]');
    await expect(boxes).toHaveCount(3);
    for (const box of await boxes.all()) {
      await expect(box).not.toBeChecked();
    }
  });

  test("prefers-reduced-motion: the row's hover transition is off (#630)", async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const component = await mount(
      <CheckboxGroup options={options} onChange={() => {}} />,
    );
    const row = component.locator('[data-testid="option"]').first();
    await expect(row).toHaveCSS("transition-duration", "0s");
  });
});
