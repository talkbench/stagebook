import { test, expect } from "@playwright/experimental-ct-react";
import { RadioGroup } from "./RadioGroup";
import { MockRadioGroup } from "../testing/MockRadioGroup";

const options = [
  { key: "a", value: "Option A" },
  { key: "b", value: "Option B" },
  { key: "c", value: "Option C" },
];

test.describe("RadioGroup", () => {
  test("renders all options", async ({ mount }) => {
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );
    await expect(component.locator("label")).toHaveCount(3);
    await expect(component).toContainText("Option A");
    await expect(component).toContainText("Option B");
    await expect(component).toContainText("Option C");
  });

  test("shows selected option as checked", async ({ mount }) => {
    const component = await mount(
      <RadioGroup options={options} value="b" onChange={() => {}} />,
    );
    await expect(component.locator('input[value="b"]')).toBeChecked();
    await expect(component.locator('input[value="a"]')).not.toBeChecked();
  });

  test("renders label when provided", async ({ mount }) => {
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} label="Pick one" />,
    );
    await expect(component).toContainText("Pick one");
  });

  test("clicking an option updates selection", async ({ mount }) => {
    const component = await mount(<MockRadioGroup options={options} />);
    // Nothing selected initially
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("");

    // Click Option B
    await component.getByText("Option B").click();
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("b");

    // Click Option A — should switch
    await component.getByText("Option A").click();
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("a");
  });

  test("selecting one deselects others", async ({ mount }) => {
    const component = await mount(
      <MockRadioGroup options={options} initialValue="a" />,
    );
    await expect(component.locator('input[value="a"]')).toBeChecked();

    await component.getByText("Option C").click();
    await expect(component.locator('input[value="c"]')).toBeChecked();
    await expect(component.locator('input[value="a"]')).not.toBeChecked();
    await expect(component.locator('input[value="b"]')).not.toBeChecked();
  });

  // Issue #213: radio visual styling moved from styles.css to inline
  // styles so the radio renders with a visible dot + primary-color fill
  // on hosts that don't import stagebook/styles.
  test("unchecked radio has inline base styling (surface bg, bordered)", async ({
    mount,
  }) => {
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );
    const { appearance, borderRadius, backgroundColor } = await component
      .locator('input[value="a"]')
      .evaluate((el) => ({
        appearance: (el as HTMLElement).style.appearance,
        borderRadius: (el as HTMLElement).style.borderRadius,
        backgroundColor: (el as HTMLElement).style.backgroundColor,
      }));
    expect(appearance).toBe("none");
    // 9999px = "fully rounded" — the radio shape
    expect(borderRadius).toBe("9999px");
    expect(backgroundColor).toContain("--stagebook-surface");
  });

  test("checked radio has inline primary fill + dot SVG", async ({ mount }) => {
    const component = await mount(
      <RadioGroup options={options} value="b" onChange={() => {}} />,
    );
    const { backgroundColor, backgroundImage } = await component
      .locator('input[value="b"]')
      .evaluate((el) => ({
        backgroundColor: (el as HTMLElement).style.backgroundColor,
        backgroundImage: (el as HTMLElement).style.backgroundImage,
      }));
    expect(backgroundColor).toContain("--stagebook-primary");
    expect(backgroundImage).toContain("data:image/svg+xml");
  });

  test("previously-checked radio reverts to gray border after deselection (no color bleed)", async ({
    mount,
  }) => {
    // Regression: when one radio was selected and then another was
    // clicked, the previously-selected radio's border stayed black
    // (browser default for appearance:none inputs) instead of
    // reverting to the gray default. Root cause: mixing the `border`
    // shorthand in base style with a `borderColor` longhand override
    // in the checked style — React's inline-style diff cleared the
    // longhand on deselect, blowing away the shorthand's expansion.
    // Fix: use border longhands consistently in base style.
    const component = await mount(
      <MockRadioGroup options={options} initialValue="a" />,
    );

    // Sanity: A starts checked
    await expect(component.locator('input[value="a"]')).toBeChecked();

    // Click B to deselect A
    await component.getByText("Option B").click();
    await expect(component.locator('input[value="b"]')).toBeChecked();
    await expect(component.locator('input[value="a"]')).not.toBeChecked();

    // The previously-checked A and never-clicked C should have the
    // same gray border. Pre-fix: A had rgb(0, 0, 0), C had rgb(209,
    // 213, 219).
    const aBorder = await component
      .locator('input[value="a"]')
      .evaluate((el) => window.getComputedStyle(el).borderColor);
    const cBorder = await component
      .locator('input[value="c"]')
      .evaluate((el) => window.getComputedStyle(el).borderColor);
    expect(aBorder).toBe(cBorder);
  });

  test("focus ring appears on keyboard focus via :focus-visible", async ({
    mount,
    page,
  }) => {
    // Focus ring is keyboard-only — `:focus-visible` rather than
    // `:focus` so a mouse click doesn't leave a lingering ring on the
    // just-clicked option. The ring is delivered via the component's
    // own `<style>` block (pseudo-classes can't be expressed inline),
    // so we assert on computed `boxShadow` rather than inline style.
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );

    // Tab into the page — first Tab lands on the first focusable
    // element inside the mount root, which is the first radio.
    await page.keyboard.press("Tab");
    const focused = component.locator('input[value="a"]');
    await expect(focused).toBeFocused();
    const shadowOnKeyboardFocus = await focused.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    // Should contain a non-`none` box-shadow (the focus ring).
    expect(shadowOnKeyboardFocus).not.toBe("none");
  });

  test("mouse click does not leave a focus ring on the clicked radio (:focus-visible)", async ({
    mount,
  }) => {
    // Companion to the keyboard-focus test: mouse clicks should not
    // trigger `:focus-visible`, so the focus ring stays hidden even
    // though the input is the active element.
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );
    const inputA = component.locator('input[value="a"]');
    await inputA.click();

    const shadow = await inputA.evaluate(
      (el) => window.getComputedStyle(el).boxShadow,
    );
    expect(shadow).toBe("none");
  });

  test("option row gets a hover background fill (#350 whole-row hover)", async ({
    mount,
  }) => {
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );
    const row = component.locator('[data-testid="option"]').first();

    const before = await row.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor,
    );
    await row.hover();
    // `expect.poll` retries until the polled value satisfies the
    // matcher (or the timeout hits). Needed because the hover state
    // is gated on a 120ms `background-color` transition; reading
    // getComputedStyle synchronously after `hover()` can catch the
    // transition mid-flight or before it starts depending on warm-up.
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
    // Guard against a regression where someone sets a fixed
    // `height: 2.25rem` on the row instead of `minHeight`. With
    // minHeight the row grows to fit a wrapping label; with a fixed
    // height the label would visually overflow and the hover-fill
    // background wouldn't cover the wrapped lines.
    const longOptions = [
      {
        key: "a",
        value:
          "A deliberately long option label that should wrap across multiple lines when constrained to a narrow column so we can verify the row grows to fit",
      },
      { key: "b", value: "Short" },
    ];
    const component = await mount(
      <div style={{ width: "240px" }}>
        <RadioGroup options={longOptions} onChange={() => {}} />
      </div>,
    );
    const longRow = component.locator('[data-testid="option"]').first();
    const box = await longRow.boundingBox();
    expect(box).not.toBeNull();
    // A single 36px row can't fit ~26 words at 240px wide; expect at
    // least two lines worth (≥ ~50px).
    expect(box!.height).toBeGreaterThan(50);
  });

  test("options container has role=radiogroup and is labelled by the legend", async ({
    mount,
  }) => {
    const component = await mount(
      <RadioGroup
        options={options}
        onChange={() => {}}
        label="Pick your favorite"
      />,
    );
    const group = component.locator('[role="radiogroup"]');
    await expect(group).toBeVisible();
    // The aria-labelledby points at the legend label
    const labelledById = await group.getAttribute("aria-labelledby");
    expect(labelledById).not.toBeNull();
    const legend = component.locator(`#${labelledById!}`);
    await expect(legend).toHaveText("Pick your favorite");
  });

  test("row meets touch-target sizing (≥36px tall)", async ({ mount }) => {
    // 36px (2.25rem) — balances HIG's 44px recommendation against
    // vertical density on long Likert-style scales.
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
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
    // The point of moving these styles inline: survive hosts that reset
    // `input { appearance: auto; background: ...; border: ... }` without
    // !important. Inline styles win on specificity.
    const resetCSS = `
      input[type="radio"] {
        appearance: auto;
        border: 2px solid red;
        background: yellow;
        border-radius: 0;
      }
    `;
    const component = await mount(
      <div>
        <style dangerouslySetInnerHTML={{ __html: resetCSS }} />
        <RadioGroup options={options} value="a" onChange={() => {}} />
      </div>,
    );
    const { appearance, borderRadius } = await component
      .locator('input[value="a"]')
      .evaluate((el) => {
        const cs = getComputedStyle(el);
        return { appearance: cs.appearance, borderRadius: cs.borderRadius };
      });
    expect(appearance).toBe("none");
    // 9999px typically resolves to the half-height in computed pixels —
    // but the key thing is that the reset's `0` didn't win.
    expect(borderRadius).not.toBe("0px");
  });
});

test.describe("RadioGroup: label validity, null value, reduced motion", () => {
  test("group label carries no dangling for/id reference (#595)", async ({
    mount,
  }) => {
    // The group label names the radiogroup through aria-labelledby. A
    // `for` attribute pointing at an id nothing carries is invalid HTML
    // and focuses nothing when the label is clicked.
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} label="Pick one" />,
    );
    const dangling = await component.evaluate((root) =>
      Array.from(root.querySelectorAll("label[for]"))
        .map((l) => l.getAttribute("for") ?? "")
        .filter((id) => !document.getElementById(id)),
    );
    expect(dangling).toEqual([]);
  });

  test("value={null} renders nothing checked and stays controlled (#606)", async ({
    mount,
  }) => {
    // JS consumers can pass null before async data arrives. `checked`
    // must stay a boolean so the input never flips to uncontrolled and
    // a pick the parent ignored never sticks.
    const component = await mount(
      <RadioGroup
        options={options}
        value={null as unknown as string}
        onChange={() => {}}
      />,
    );
    const b = component.locator('input[value="b"]');
    await expect(b).not.toBeChecked();
    await b.click();
    await expect(b).not.toBeChecked();
  });

  test("prefers-reduced-motion: the row's hover transition is off (#630)", async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const component = await mount(
      <RadioGroup options={options} onChange={() => {}} />,
    );
    const row = component.locator('[data-testid="option"]').first();
    await expect(row).toHaveCSS("transition-duration", "0s");
  });
});
