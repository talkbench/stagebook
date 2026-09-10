import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator, Page } from "@playwright/test";
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

  test("forwards ariaLabelledBy so the select is named by external content", async ({
    mount,
  }) => {
    // Mirrors the RadioGroup/CheckboxGroup aria-labelledby tests: the
    // accessible name can live in existing visible content (e.g. a
    // prompt body) rather than a duplicate visible <label>. This is
    // the path Prompt's dropdown variant uses (#545). Guards the
    // component's own public API so a refactor dropping the forward
    // fails here, not only in the Prompt integration test.
    const component = await mount(
      <div>
        <div id="ext-label">Which Hogwarts house?</div>
        <Select
          options={options}
          onChange={() => {}}
          ariaLabelledBy="ext-label"
        />
      </div>,
    );
    // getByRole filters by accessible name — this only matches if
    // aria-labelledby resolves to the visible text.
    await expect(
      component.getByRole("combobox", { name: "Which Hogwarts house?" }),
    ).toBeVisible();
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
    await expect(component.locator("select")).toHaveAttribute(
      "data-testid",
      "myPicker",
    );
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
    await expect(component.locator("select")).toHaveAttribute(
      "data-testid",
      "customId",
    );
  });

  test("data-testid resolves to the <select>, so Playwright can drive it", async ({
    mount,
  }) => {
    // The testid names the interactive element, not the layout box
    // around it (#601). `selectOption()` requires a real <select> and
    // `inputValue()` a form control, so with the testid on the
    // wrapping <div> the idiomatic call throws instead of selecting —
    // and every consumer has to remember to append a descendant
    // ` select`. Matches Button, which puts the caller's testid on
    // the <button> itself.
    //
    // Asserted with the non-retrying `inputValue()` rather than the
    // house `toHaveValue()` on purpose: it is the second of the two
    // calls this placement unblocks, and the one talkbench/runner#737
    // reads directly. `selectOption` has already awaited the change.
    const component = await mount(
      <MockSelect options={options} data-testid="micPicker" />,
    );
    const picker = component.getByTestId("micPicker");

    await picker.selectOption("b");
    expect(await picker.inputValue()).toBe("b");
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
    // `select[data-testid=…]`, not `getByTestId(…)`: the element-
    // qualified form is self-guarding. A bare testid lookup would
    // resolve to the wrapper if the testid ever moved back, and
    // focus()/blur() on a non-focusable <div> is a silent no-op — two
    // untouched wrappers report the same border and this passes
    // having exercised no <select> at all.
    const touched = component.locator('select[data-testid="touched"]');
    const untouched = component.locator('select[data-testid="untouched"]');

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

// ----------- disabled (#620) -----------

test.describe("Select: disabled", () => {
  test("renders <select disabled> when set, and selectOption() is refused", async ({
    mount,
  }) => {
    let changes = 0;
    const component = await mount(
      <Select
        options={options}
        onChange={() => {
          changes += 1;
        }}
        label="Camera"
        disabled
      />,
    );
    const select = component.locator("select");
    await expect(select).toBeDisabled();
    // Playwright's actionability check waits for an enabled control, so
    // on a disabled <select> the call times out instead of selecting —
    // the same refusal a participant gets.
    await expect(select.selectOption("b", { timeout: 500 })).rejects.toThrow();
    expect(changes).toBe(0);
  });

  test("is enabled by default", async ({ mount }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} label="Camera" />,
    );
    await expect(component.locator("select")).toBeEnabled();
  });

  test("an empty, disabled picker still shows its placeholder as the state message", async ({
    mount,
    page,
  }) => {
    // The consumer's shape (talkbench/runner#862): the picker always
    // renders, and in a no-device state its only option is the disabled
    // placeholder carrying the state copy. `disabled` is what makes that
    // read as "waiting" rather than "a working control that happens to be
    // empty" — the select can't take focus or open.
    const component = await mount(
      <Select
        options={[]}
        onChange={() => {}}
        label="Camera"
        placeholder="No camera found."
        disabled
      />,
    );
    const select = component.locator("select");
    await expect(select).toBeDisabled();
    await expect(select).toHaveValue("__stagebook_select_placeholder__");
    await expect(component).toContainText("No camera found.");
    await expect(component.locator("option")).toHaveCount(1);
    // Held still: a disabled <select> is not in the tab order either.
    await page.keyboard.press("Tab");
    await expect(select).not.toBeFocused();
  });

  test("disabled greys the control and mutes its label", async ({ mount }) => {
    const component = await mount(
      <div>
        <Select
          options={options}
          onChange={() => {}}
          label="Camera"
          id="off"
          disabled
        />
        <Select
          options={options}
          onChange={() => {}}
          label="Microphone"
          id="on"
        />
      </div>,
    );
    const off = component.locator("select#off");
    const on = component.locator("select#on");
    await expect(off).toHaveCSS("cursor", "not-allowed");
    await expect(on).toHaveCSS("cursor", "pointer");
    const offOpacity = await off.evaluate((el) =>
      parseFloat(window.getComputedStyle(el).opacity),
    );
    expect(offOpacity).toBeLessThan(1);
    expect(offOpacity).toBeGreaterThan(0);

    // The visible <label> takes the usual muted colour — the same token the
    // RadioGroup / CheckboxGroup captions and the TextArea count use — and
    // an enabled sibling keeps the text colour. Located by the `for`
    // association, so this also holds the label to its control.
    const offLabel = component.locator('label[for="off"]');
    const onLabel = component.locator('label[for="on"]');
    await expect(offLabel).toHaveCSS("color", "rgb(107, 114, 128)");
    await expect(onLabel).toHaveCSS("color", "rgb(31, 41, 55)");
  });
});

// ----------- picker (#627) -----------

// The options list. With `appearance: base-select` it is no longer the
// OS-drawn popup — offset over the control on macOS, dark under an incognito
// window, deaf to our tokens — but a top-layer popover in the page, anchored
// under the trigger and painted with the same palette. Engines without it
// (Firefox, until it ships) keep the native popup, so each test names which
// path it exercises; the fallback assertions guard what participants there
// still see.
test.describe("Select: picker (#627)", () => {
  const supportsBaseSelect = (page: Page) =>
    page.evaluate(() => CSS.supports("appearance", "base-select"));

  const isOpen = (select: Locator) =>
    select.evaluate((el) => el.matches(":open"));

  test("opts into the customizable select where the engine has it, and keeps appearance: none elsewhere", async ({
    mount,
    page,
  }) => {
    // Both branches are pinned. The fallback matters as much as the opt-in:
    // `appearance` can no longer live in the inline style, because an
    // inline `none` beats any class rule carrying `base-select`, and an
    // inline `base-select` is dropped as invalid by an engine without it —
    // leaving the UA `menulist` and a native arrow under our chevron.
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const supported = await supportsBaseSelect(page);
    await expect(component.locator("select")).toHaveCSS(
      "appearance",
      supported ? "base-select" : "none",
    );
    if (!supported) {
      // And the row rules stayed behind the @supports fence: the native
      // popup honours some <option> styling, so a flex row here would be
      // ours leaking onto the OS menu.
      await expect(component.locator("option").first()).not.toHaveCSS(
        "display",
        "flex",
      );
    }
  });

  test("survives a host's own select reset (#213)", async ({ mount, page }) => {
    // Inline, `appearance` was untouchable short of !important. As a class
    // rule it is written at doubled specificity, so a host reset such as
    // `.form select { appearance: auto }` — enough to beat a single class,
    // and it would put the native arrow back under our chevron — still
    // loses.
    const component = await mount(
      <div className="host">
        <style>{`.host select { appearance: auto; }`}</style>
        <Select options={options} onChange={() => {}} />
      </div>,
    );
    const supported = await supportsBaseSelect(page);
    await expect(component.locator("select")).toHaveCSS(
      "appearance",
      supported ? "base-select" : "none",
    );
  });

  test("keeps its own chevron on both paths and hides the engine's, so the icon isn't doubled", async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const select = component.locator("select");
    // The chevron is a background image on the trigger — the one part of
    // the control that renders identically on both paths.
    const background = await select.evaluate(
      (el) => getComputedStyle(el).backgroundImage,
    );
    expect(background).toContain("data:image/svg+xml");
    if (await supportsBaseSelect(page)) {
      // base-select draws its own disclosure icon through ::picker-icon.
      // Left alone, the trigger shows two arrows.
      const iconDisplay = await select.evaluate(
        (el) => getComputedStyle(el, "::picker-icon").display,
      );
      expect(iconDisplay).toBe("none");
    }
  });

  test("pins color-scheme: light on the control itself, so a host's dark scheme can't re-tint the native popup", async ({
    mount,
  }) => {
    // Belt and braces for the native path, and for hosts that never load
    // styles.css and so lack the :root pin (#535): a popup follows its
    // <select>'s scheme, so pinning the element pins the popup wherever the
    // OS still draws it. Under base-select the in-page picker inherits it
    // too, which keeps its scrollbar light.
    const component = await mount(
      <div style={{ colorScheme: "dark" }}>
        <Select options={options} onChange={() => {}} />
      </div>,
    );
    await expect(component.locator("select")).toHaveCSS(
      "color-scheme",
      "light",
    );
  });

  test("the open picker sits under the control and spans its width", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: drawn outside the page, so there is nothing to measure",
    );
    // This is the misalignment in the issue's screenshot, and exactly what
    // jsdom cannot see: the rows are real boxes only once the picker is
    // in-page DOM.
    const component = await mount(
      <Select options={options} value="b" onChange={() => {}} />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);

    const control = (await select.boundingBox())!;
    const rows = component.locator("option");
    const first = (await rows.first().boundingBox())!;
    const last = (await rows.last().boundingBox())!;

    // Anchored beneath: the first row starts at, or just under (the
    // picker's border and padding, plus a small gap that clears the
    // trigger's focus halo), the control's bottom edge — never over it.
    expect(first.y).toBeGreaterThanOrEqual(control.y + control.height);
    expect(first.y).toBeLessThanOrEqual(control.y + control.height + 12);
    // Left-aligned and spanning the control: a row runs from the trigger's
    // left edge to its right edge, inside the picker's border and padding.
    expect(first.x).toBeGreaterThanOrEqual(control.x);
    expect(first.x).toBeLessThanOrEqual(control.x + 8);
    expect(first.x + first.width).toBeLessThanOrEqual(
      control.x + control.width,
    );
    expect(first.x + first.width).toBeGreaterThanOrEqual(
      control.x + control.width - 8,
    );
    // And the rows stack into a column below it.
    expect(last.y).toBeGreaterThan(first.y);
    // The gap under the trigger is the picker's own margin, sized to clear
    // the trigger's 4px focus halo — not incidental border and padding.
    const gap = await select.evaluate((el) =>
      parseFloat(getComputedStyle(el, "::picker(select)").marginBlockStart),
    );
    expect(gap).toBeGreaterThanOrEqual(4);
  });

  test("flips above the trigger when there is no room below", async ({
    mount,
    page,
    browserName,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS places its own menu",
    );
    // WebKit's position-try fallback is geometry-sensitive at this size
    // (it flips with the page's default body margin and not without), so
    // it is Chromium that pins the behaviour; the docs say "may flip".
    test.skip(
      browserName === "webkit",
      "WebKit's position-try fallback does not flip dependably",
    );
    // The UA's position-try fallbacks: with the control near the bottom
    // of a short viewport the rows open upward.
    await page.setViewportSize({ width: 800, height: 260 });
    const component = await mount(
      <div>
        <div style={{ height: 180 }} />
        <Select options={options} value="a" onChange={() => {}} />
      </div>,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const control = (await select.boundingBox())!;
    const last = (await component.locator("option").last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(control.y);
    // The halo-clearing margin is on this side too: flipped, the picker's
    // bottom edge would otherwise sit on the trigger's top edge and paint
    // over the top of its focus halo.
    const gap = await select.evaluate((el) =>
      parseFloat(getComputedStyle(el, "::picker(select)").marginBlockEnd),
    );
    expect(gap).toBeGreaterThanOrEqual(4);
  });

  test("the picker follows the host's token overrides: row height, hover fill, surface", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS paints its own menu",
    );
    // styles.css and the inline fallbacks agree on every value, so a
    // picker that read the fallbacks and ignored the tokens would pass the
    // colour assertions elsewhere in this file. Retune three and check
    // they reach the rows.
    const component = await mount(
      <div
        style={
          {
            "--stagebook-row-min-height": "3rem",
            "--stagebook-hover-bg": "rgb(255, 0, 0)",
            "--stagebook-surface": "rgb(0, 255, 0)",
          } as React.CSSProperties
        }
      >
        <Select options={options} value="a" onChange={() => {}} />
      </div>,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const row = component.locator('option[value="c"]');
    expect((await row.boundingBox())!.height).toBe(48);
    await row.hover();
    await expect(row).toHaveCSS("background-color", "rgb(255, 0, 0)");
    expect(
      await select.evaluate(
        (el) => getComputedStyle(el, "::picker(select)").backgroundColor,
      ),
    ).toBe("rgb(0, 255, 0)");
  });

  test("picker rows meet touch-target sizing (≥36px tall) and take the hover fill", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS sizes and paints its own rows",
    );
    const component = await mount(
      <Select options={options} value="a" onChange={() => {}} />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);

    const row = component.locator('option[value="c"]');
    const box = (await row.boundingBox())!;
    // The same token RadioGroup / CheckboxGroup rows use, so the three
    // families agree on the host's lever for row height
    // (--stagebook-row-min-height). Exactly the token, not the token plus
    // padding: the row is border-box, so 2.25rem is the row a participant
    // sees and taps, and a single-line list stays as dense as a menu.
    expect(box.height).toBe(36);

    // Hover reads as "interactive" with the shared hover token (gray-100),
    // replacing the engine's currentColor tint.
    await row.hover();
    await expect(row).toHaveCSS("background-color", "rgb(243, 244, 246)");
  });

  test("picker paints with the surface, border and text tokens", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: painted by the OS, not by our tokens",
    );
    const component = await mount(
      <Select options={options} value="a" onChange={() => {}} />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const picker = await select.evaluate((el) => {
      const s = getComputedStyle(el, "::picker(select)");
      return {
        backgroundColor: s.backgroundColor,
        borderColor: s.borderTopColor,
        borderRadius: s.borderTopLeftRadius,
      };
    });
    expect(picker.backgroundColor).toBe("rgb(255, 255, 255)"); // --stagebook-surface
    expect(picker.borderColor).toBe("rgb(209, 213, 219)"); // --stagebook-border
    expect(picker.borderRadius).not.toBe("0px");
    // Row text is the full text colour, not the muted caption colour the
    // radio rows use: these rows are the answer set, not labels beside it.
    await expect(component.locator('option[value="b"]')).toHaveCSS(
      "color",
      "rgb(31, 41, 55)",
    );
  });

  test("the checked row alone shows the checkmark, in the accent", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS draws its own selection mark",
    );
    const component = await mount(
      <Select options={options} value="b" onChange={() => {}} />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const mark = (value: string) =>
      component.locator(`option[value="${value}"]`).evaluate((el) => {
        const s = getComputedStyle(el, "::checkmark");
        return { visibility: s.visibility, color: s.color };
      });
    expect(await mark("b")).toEqual({
      visibility: "visible",
      color: "rgb(37, 99, 235)", // --stagebook-primary
    });
    // The slot is reserved on every row (so text lines up), but the glyph
    // shows on the checked one only.
    expect((await mark("a")).visibility).toBe("hidden");
  });

  test("a disabled placeholder row is muted, not hidden", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS greys its own disabled rows",
    );
    const component = await mount(
      <Select options={options} onChange={() => {}} placeholder="Pick one…" />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const placeholder = component.locator(
      'option[value="__stagebook_select_placeholder__"]',
    );
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toHaveCSS("color", "rgb(107, 114, 128)"); // --stagebook-text-muted
    await expect(placeholder).toHaveCSS("cursor", "not-allowed");
    // And no hover fill on a row that cannot be chosen — the disabled rule
    // beats the hover rule by source order alone, so this pins the order.
    await placeholder.hover();
    await expect(placeholder).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    // The sentinel is "checked" in the DOM, but nothing has been chosen, so
    // the row carries no checkmark: a tick beside "Pick one…" would read
    // as a choice made.
    expect(
      await placeholder.evaluate(
        (el) => getComputedStyle(el, "::checkmark").visibility,
      ),
    ).toBe("hidden");
  });

  test("long labels wrap inside the picker, which stays the trigger's width", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS sizes its own menu",
    );
    // The UA only floors the picker at the trigger's width; left alone it
    // grows to fit the widest label and runs off the viewport. Pinned to
    // the trigger instead — the width the participant already read the
    // control at — with long labels wrapping into taller rows.
    const long =
      "A very long option label that goes on and on, well past the width of any sensible control";
    // No break opportunity at all — a device id, a URL — wraps too
    // (overflow-wrap: anywhere) rather than pushing the row past the edge.
    const unbroken = "x".repeat(90);
    const component = await mount(
      <div style={{ width: 320 }}>
        <Select
          options={[
            { key: "a", value: "Short" },
            { key: "b", value: long },
            { key: "c", value: unbroken },
          ]}
          value="a"
          onChange={() => {}}
        />
      </div>,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    const control = (await select.boundingBox())!;
    const short = (await component.locator('option[value="a"]').boundingBox())!;
    for (const key of ["b", "c"]) {
      const wrapped = (await component
        .locator(`option[value="${key}"]`)
        .boundingBox())!;
      expect(wrapped.x + wrapped.width).toBeLessThanOrEqual(
        control.x + control.width,
      );
      expect(wrapped.height).toBeGreaterThan(short.height);
    }
  });

  test("the trigger stays one line with a long selected label", async ({
    mount,
  }) => {
    // Both paths. The native trigger clips a long label to one line; the
    // base-select trigger is a flex box and would wrap and grow, which
    // breaks the row an icon Button is sized to share with it (#622).
    const long =
      "A very long option label that goes on and on, well past the width of any sensible control";
    const twoOptions = [
      { key: "a", value: "Short" },
      { key: "b", value: long },
    ];
    const component = await mount(
      <div style={{ width: 320 }}>
        <Select
          options={twoOptions}
          value="a"
          onChange={() => {}}
          data-testid="short"
        />
        <Select
          options={twoOptions}
          value="b"
          onChange={() => {}}
          data-testid="long"
        />
      </div>,
    );
    const shortBox = (await component.getByTestId("short").boundingBox())!;
    const longBox = (await component.getByTestId("long").boundingBox())!;
    expect(longBox.height).toBe(shortBox.height);
  });

  test("choosing a row selects it, fires onChange, and closes the picker", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: rows aren't in-page, so there is nothing to click",
    );
    const component = await mount(
      <MockSelect options={options} initialValue="a" />,
    );
    const select = component.locator("select");
    await select.click();
    await expect.poll(() => isOpen(select)).toBe(true);
    await component.locator('option[value="b"]').click();
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("b");
    await expect(select).toHaveValue("b");
    await expect.poll(() => isOpen(select)).toBe(false);
  });

  test("keyboard: Space opens, ArrowDown walks the rows with an accent focus ring, Enter commits", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: keyboard handling belongs to the OS menu",
    );
    // The reason to prefer base-select over a hand-rolled listbox: the
    // keyboard model is still the <select>'s. What is ours is the focus
    // treatment of the walked row — an inset ring in the accent, since the
    // shared outer halo would be clipped at the picker's scroll edge and
    // overlap the neighbouring rows.
    const component = await mount(
      <MockSelect options={options} initialValue="a" />,
    );
    const select = component.locator("select");
    await page.keyboard.press("Tab");
    await expect(select).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(() => isOpen(select)).toBe(true);
    // The picker opens with the checked row focused — a beat later under
    // load in WebKit — so wait for it before walking, or the ArrowDown can
    // land on the trigger instead.
    await expect(component.locator('option[value="a"]')).toBeFocused();

    await page.keyboard.press("ArrowDown");
    const focusedRow = component.locator("option:focus-visible");
    await expect(focusedRow).toHaveAttribute("value", "b");
    await expect(focusedRow).toHaveCSS("outline-style", "solid");
    await expect(focusedRow).toHaveCSS("outline-color", "rgb(37, 99, 235)");
    const outlineWidth = await focusedRow.evaluate((el) =>
      parseFloat(getComputedStyle(el).outlineWidth),
    );
    expect(outlineWidth).toBeGreaterThanOrEqual(2);
    // Inset — a negative offset — so the ring stays whole at the picker's
    // scroll edge instead of being clipped like the outer halo would be.
    const outlineOffset = await focusedRow.evaluate((el) =>
      parseFloat(getComputedStyle(el).outlineOffset),
    );
    expect(outlineOffset).toBeLessThan(0);
    // The walked row also takes the hover fill, so the ring sits on
    // hover-bg — the fill a11y.gate.ct.tsx reads the row's text and
    // checkmark against.
    await expect(focusedRow).toHaveCSS(
      "background-color",
      "rgb(243, 244, 246)",
    );

    await page.keyboard.press("Enter");
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("b");
    await expect.poll(() => isOpen(select)).toBe(false);
  });

  test("Escape closes the picker without committing, and focus returns to the trigger", async ({
    mount,
    page,
  }) => {
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: keyboard handling belongs to the OS menu",
    );
    const component = await mount(
      <MockSelect options={options} initialValue="a" />,
    );
    const select = component.locator("select");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect.poll(() => isOpen(select)).toBe(true);
    // The picker opens with the checked row focused — a beat later under
    // load in WebKit — so wait for it before walking, or the ArrowDown can
    // land on the trigger instead.
    await expect(component.locator('option[value="a"]')).toBeFocused();
    // Native roles survive the opt-in: the rows are options, by name.
    await expect(
      component.getByRole("option", { name: "Option B" }),
    ).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect.poll(() => isOpen(select)).toBe(false);
    // Walking to a row is not choosing it.
    await expect(select).toHaveValue("a");
    await expect(
      component.locator('[data-testid="selected-value"]'),
    ).toHaveText("a");
    await expect(select).toBeFocused();
  });

  test("the walked row's ring survives forced-colors", async ({
    mount,
    page,
    browserName,
  }) => {
    // Same reasoning and mechanics as focus.gate.ct.tsx: forced-colors
    // drops box-shadow and keeps outline, repainted from the system
    // palette. The row's ring is an outline for exactly this reason.
    test.skip(
      browserName === "webkit",
      "WebKit emulates the forced-colors media query but not its rendering",
    );
    test.skip(
      !(await supportsBaseSelect(page)),
      "native popup: the OS draws its own focus",
    );
    const component = await mount(
      <MockSelect options={options} initialValue="a" />,
    );
    const select = component.locator("select");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect.poll(() => isOpen(select)).toBe(true);
    // The picker opens with the checked row focused — a beat later under
    // load in WebKit — so wait for it before walking, or the ArrowDown can
    // land on the trigger instead.
    await expect(component.locator('option[value="a"]')).toBeFocused();
    await page.keyboard.press("ArrowDown");
    const row = component.locator("option:focus-visible");
    await expect(row).toHaveAttribute("value", "b");

    await page.emulateMedia({ forcedColors: "active" });
    const painted = () =>
      row.evaluate((el) => {
        const s = getComputedStyle(el);
        const parts =
          /^rgba?\(([^)]+)\)$/.exec(s.outlineColor)?.[1].split(",") ?? [];
        return {
          outlineStyle: s.outlineStyle,
          outlineWidth: parseFloat(s.outlineWidth),
          outlineColor: s.outlineColor,
          outlineAlpha: parts.length === 4 ? parseFloat(parts[3]) : 1,
        };
      });
    await expect
      .poll(async () => (await painted()).outlineStyle)
      .not.toBe("none");
    const now = await painted();
    expect(now.outlineWidth).toBeGreaterThanOrEqual(2);
    expect(
      now.outlineAlpha,
      `outline stayed transparent (${now.outlineColor})`,
    ).toBeGreaterThan(0);
  });
});

test.describe("Select: always-controlled (#606)", () => {
  // React gates controlled-ness on `value != null`, so the `value ?? …`
  // in the implementation is load-bearing: a default parameter only
  // fires for `undefined`, would let `value={null}` through, and leave
  // the element uncontrolled — at which point a pick the parent never
  // adopted sticks (the talkbench/runner#731 bug).
  test("value={null}: a pick the parent ignores does not stick", async ({
    mount,
  }) => {
    const component = await mount(
      <Select
        options={options}
        value={null as unknown as string}
        placeholder="Choose…"
        onChange={() => {}}
      />,
    );
    const select = component.locator("select");
    await select.selectOption("b");
    await expect(select).not.toHaveValue("b");
    // Restored to the controlled value: the disabled placeholder row.
    await expect(select.locator("option:checked")).toHaveText("Choose…");
  });

  test("value omitted: the other branch of `??` is controlled too", async ({
    mount,
  }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const select = component.locator("select");
    await select.selectOption("b");
    await expect(select).not.toHaveValue("b");
  });

  test("prefers-reduced-motion switches the trigger's focus transition off (#630)", async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <Select options={options} onChange={() => {}} />,
    );
    const select = component.locator("select");
    // Pinned in both directions: the 120ms fill is a baked-in instrument
    // constant, so deleting the transition can't pass as "fixing" the
    // reduced-motion override.
    await expect(select).toHaveCSS("transition-duration", "0.12s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(select).toHaveCSS("transition-duration", "0s");
  });
});
