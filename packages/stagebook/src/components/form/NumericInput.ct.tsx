import { test, expect } from "@playwright/experimental-ct-react";
import { NumericInput } from "./NumericInput.js";
import { TextArea } from "./TextArea.js";
import { LocaleProvider } from "../testing/LocaleProvider.js";

for (const refused of ["x", " ", "+", ","]) {
  test(`numeric field refuses ${JSON.stringify(refused)} without erasing selection`, async ({
    mount,
  }) => {
    const component = await mount(
      <NumericInput entry="35" ariaLabel="Estimate" />,
    );
    const field = component.getByRole("textbox");
    await field.selectText();
    await field.pressSequentially(refused);
    await expect(field).toHaveValue("35");
    expect(
      await field.evaluate((node: HTMLInputElement) => [
        node.selectionStart,
        node.selectionEnd,
      ]),
    ).toEqual([0, 2]);
    await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
      "data-pulsing",
      "true",
    );
  });
}

test("numeric refusal preserves a middle caret and the next digit lands there", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput entry="35" ariaLabel="Estimate" />,
  );
  const field = component.getByRole("textbox");
  await field.focus();
  await field.evaluate((node: HTMLInputElement) =>
    node.setSelectionRange(1, 1),
  );
  await field.pressSequentially("x4");
  await expect(field).toHaveValue("345");
  expect(
    await field.evaluate((node: HTMLInputElement) => node.selectionStart),
  ).toBe(2);
});

test("numeric punctuation is accepted regardless of whole-number or bound constraints", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput
      ariaLabel="Estimate"
      constraints={{ min: 1, max: 20, integer: true }}
    />,
  );
  const field = component.getByRole("textbox");
  await field.pressSequentially("-.5");
  await expect(field).toHaveValue("-.5");
  await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
    "data-state",
    "problem",
  );
});

test("numeric cap refuses a whole insertion and allows deletions from an over-cap restore", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput entry={"0".repeat(99)} ariaLabel="Estimate" />,
  );
  const field = component.getByRole("textbox");
  await field.focus();
  await field.press("End");
  await field.evaluate((node) =>
    node.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "12",
      }),
    ),
  );
  await expect(field).toHaveValue("0".repeat(99));
  await component.update(
    <NumericInput entry={"0".repeat(120)} ariaLabel="Estimate" />,
  );
  await field.focus();
  await field.press("End");
  await field.press("Backspace");
  await expect(field).toHaveValue("0".repeat(119));
  await field.pressSequentially("1");
  await expect(field).toHaveValue("0".repeat(119));
});

test("numeric feedback waits for appendable prefixes, becomes sticky on blur, and clears on own edit", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput ariaLabel="Age" constraints={{ min: 18, max: 99 }} />,
  );
  const field = component.getByRole("textbox");
  const feedback = component.getByTestId("numeric-feedback");
  await field.pressSequentially("3");
  await expect(feedback).toHaveAttribute("data-state", "neutral");
  await field.blur();
  await expect(feedback).toHaveAttribute("data-state", "problem");
  await expect(feedback).toContainText("3 is less than 18");
  await field.focus();
  await expect(feedback).toHaveAttribute("data-state", "problem");
  await field.pressSequentially("x");
  await expect(feedback).toHaveAttribute("data-state", "problem");
  await field.pressSequentially("5");
  await expect(feedback).toHaveAttribute("data-state", "valid");
  await expect(feedback).toContainText("✓");
  await field.fill("");
  await field.blur();
  await expect(feedback).toHaveAttribute("data-state", "neutral");
  await expect(
    component.locator('[aria-invalid], [role="alert"], [aria-live]'),
  ).toHaveCount(0);
});

test("numeric impossible values show immediately and become valid on deletion", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput
      ariaLabel="Estimate"
      constraints={{ min: 1, max: 20, integer: true }}
    />,
  );
  const field = component.getByRole("textbox");
  const feedback = component.getByTestId("numeric-feedback");
  await field.pressSequentially("25");
  await expect(feedback).toContainText("25 is more than 20");
  await field.press("Backspace");
  await expect(feedback).toHaveAttribute("data-state", "valid");
  await field.fill("1.5");
  await expect(feedback).toHaveAttribute("data-state", "problem");
  await field.fill("-");
  await expect(feedback).toHaveAttribute("data-state", "problem");
});

test("numeric restored unfinished entry shows a problem immediately", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput entry="5." ariaLabel="Estimate" />,
  );
  await expect(component.getByRole("textbox")).toHaveValue("5.");
  await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
    "data-state",
    "problem",
  );
});

test("numeric reduced-motion refusal shows a static warning glow", async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const component = await mount(<NumericInput ariaLabel="Estimate" />);
  await component.getByRole("textbox").pressSequentially("x");
  const feedback = component.getByTestId("numeric-feedback");
  await expect(feedback).toHaveCSS("animation-name", "none");
  await expect(feedback).toHaveCSS(
    "box-shadow",
    "rgb(180, 83, 9) 0px 0px 0px 4px",
  );
});

test("numeric input blocks enclosing form submission and disables autocomplete", async ({
  mount,
}) => {
  let submitted = 0;
  const component = await mount(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submitted++;
      }}
    >
      <NumericInput ariaLabel="Estimate" />
      <button type="submit">Continue</button>
    </form>,
  );
  const field = component.getByRole("textbox");
  await expect(field).toHaveAttribute("autocomplete", "off");
  await field.pressSequentially("12");
  await field.press("Enter");
  await expect(field).toHaveValue("12");
  expect(submitted).toBe(0);
});

test("numeric parsing uses the provider's partial number-format override", async ({
  mount,
}) => {
  const component = await mount(
    <LocaleProvider
      locale="en"
      messages={{ numberFormat: { decimal: ",", grouping: "." } }}
    >
      <NumericInput ariaLabel="Estimate" constraints={{ min: 1, max: 2 }} />
    </LocaleProvider>,
  );
  await component.getByRole("textbox").pressSequentially("1,5");
  await expect(component.getByRole("textbox")).toHaveValue("1,5");
  await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
    "data-state",
    "valid",
  );
});

test("numeric bounds render in plain notation, without grouping or exponent", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput
      ariaLabel="Estimate"
      constraints={{ min: 0.0000001, max: 1000000 }}
    />,
  );
  await expect(component.getByTestId("numeric-feedback")).toContainText(
    "0.0000001",
  );
  await expect(component.getByTestId("numeric-feedback")).toContainText(
    "1000000",
  );
  await expect(component.getByTestId("numeric-feedback")).not.toContainText(
    "1e",
  );
});

for (const locale of ["en", "he"]) {
  test(`numeric affix reflow preserves a 6rem input at 320px in ${locale}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 600 });
    const component = await mount(
      <LocaleProvider locale={locale}>
        <NumericInput
          ariaLabel="Estimate"
          prefix={"P".repeat(32)}
          suffix={"S".repeat(32)}
        />
      </LocaleProvider>,
    );
    const field = component.getByRole("textbox");
    await expect(field).toHaveCSS("min-width", "96px");
    // Gecko's layout unit conversion can report 95.999992px for 6rem.
    expect((await field.boundingBox())!.width).toBeGreaterThanOrEqual(95.99);
    for (const affix of await component.locator("bdi").all()) {
      expect(
        await affix.evaluate(
          (node) =>
            node.scrollWidth <= node.clientWidth &&
            node.scrollHeight <= node.clientHeight,
        ),
      ).toBe(true);
      expect((await affix.boundingBox())!.height).toBeGreaterThan(20);
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}

test("numeric RTL keeps signed text LTR, suffix on the left, and isolated signed guidance", async ({
  mount,
}) => {
  const component = await mount(
    <LocaleProvider locale="he">
      <div>
        <p id="numeric-question">Temperature</p>
        <NumericInput
          entry="-2.5"
          ariaLabelledBy="numeric-question"
          constraints={{ min: -10, max: 10 }}
          suffix="°C"
        />
      </div>
    </LocaleProvider>,
  );
  const field = component.getByRole("textbox", { name: "Temperature" });
  await expect(field).toHaveAttribute("dir", "ltr");
  await expect(field).toHaveCSS("text-align", "right");
  await expect(field).toHaveValue("-2.5");
  const suffix = component.locator("bdi");
  await expect(suffix).toHaveText("°C");
  expect((await suffix.boundingBox())!.x).toBeLessThan(
    (await field.boundingBox())!.x,
  );
  await expect(component.getByTestId("numeric-feedback")).toContainText(
    "\u2066-10\u2069",
  );
  await expect(field).toHaveAccessibleDescription(/°C/);
});

test("numeric field height equals a one-row open response", async ({
  mount,
}) => {
  const component = await mount(
    <div>
      <NumericInput ariaLabel="Number" />
      <TextArea rows={1} ariaLabel="Text" />
    </div>,
  );
  expect(
    (await component.getByTestId("numeric-field").boundingBox())!.height,
  ).toBe(
    (await component.getByRole("textbox", { name: "Text" }).boundingBox())!
      .height,
  );
});

test("numeric IME commits and autofill filter inserted text without filtering a composition in progress", async ({
  mount,
}) => {
  const component = await mount(
    <NumericInput ariaLabel="Estimate" entry="35" />,
  );
  const field = component.getByRole("textbox");
  await field.focus();
  await field.evaluate((node: HTMLInputElement) => {
    node.setSelectionRange(1, 1);
    node.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    set.call(node, "3あ5");
    node.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        isComposing: true,
        inputType: "insertCompositionText",
        data: "あ",
      }),
    );
  });
  await expect(field).toHaveValue("3あ5");
  await field.evaluate((node: HTMLInputElement) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, "3x45");
    node.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "x4" }),
    );
  });
  await expect(field).toHaveValue("345");
  await field.fill("12x,3");
  await expect(field).toHaveValue("123");
});

test("numeric paste and drop preserve the existing answer", async ({
  mount,
}) => {
  const attempts: unknown[] = [];
  const component = await mount(
    <NumericInput
      entry="25"
      ariaLabel="Estimate"
      onDebugMessage={(message) => attempts.push(message)}
    />,
  );
  const field = component.getByRole("textbox");
  await field.evaluate((node) => {
    const data = new DataTransfer();
    data.setData("text/plain", "999");
    node.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
    node.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: data,
      }),
    );
  });
  await expect(field).toHaveValue("25");
  await expect
    .poll(
      () =>
        attempts.filter(
          (message) => (message as { type: string }).type === "pasteAttempt",
        ).length,
    )
    .toBe(2);
});

for (const key of ["Backspace", "Delete"]) {
  test(`numeric repeated-digit ${key} preserves the browser caret and the next insertion`, async ({
    mount,
  }) => {
    const component = await mount(
      <NumericInput entry="111" ariaLabel="Estimate" />,
    );
    const field = component.getByRole("textbox");
    await field.focus();
    await field.evaluate((node: HTMLInputElement) =>
      node.setSelectionRange(1, 1),
    );
    await field.press(key);
    await expect(field).toHaveValue("11");
    expect(
      await field.evaluate((node: HTMLInputElement) => node.selectionStart),
    ).toBe(key === "Backspace" ? 0 : 1);
    await field.pressSequentially("2");
    await expect(field).toHaveValue(key === "Backspace" ? "211" : "121");
  });
}

for (const refusalBetweenEdits of [false, true]) {
  test(`numeric native undo and redo preserve typing${refusalBetweenEdits ? " across a refused character" : ""}`, async ({
    mount,
  }) => {
    const component = await mount(<NumericInput ariaLabel="Estimate" />);
    const field = component.getByRole("textbox");
    await field.pressSequentially("12");
    if (refusalBetweenEdits) {
      await field.pressSequentially("x");
      await expect(field).toHaveValue("12");
    }
    await field.pressSequentially("3");
    await expect(field).toHaveValue("123");
    await field.press("ControlOrMeta+z");
    await expect(field).not.toHaveValue("123");
    await field.press("ControlOrMeta+Shift+z");
    await expect(field).toHaveValue("123");
  });
}

for (const initialOverride of [undefined, { decimal: ".", grouping: "," }]) {
  test(`numeric unanswered guidance follows provider ${initialOverride ? "format change" : "format hydration"}`, async ({
    mount,
  }) => {
    const records: Array<{
      entry: string;
      format: { decimal: string; grouping: string };
    }> = [];
    const save = (
      entry: string,
      format: { decimal: string; grouping: string },
    ) => records.push({ entry, format });
    const component = await mount(
      <LocaleProvider
        locale="en"
        messages={
          initialOverride ? { numberFormat: initialOverride } : undefined
        }
      >
        <NumericInput
          ariaLabel="Estimate"
          constraints={{ min: 1.5, max: 2.5 }}
          onChange={save}
        />
      </LocaleProvider>,
    );
    const field = component.getByRole("textbox");
    const originalId = await field.getAttribute("id");
    await expect(component.getByTestId("numeric-feedback")).toContainText(
      "1.5",
    );
    await component.update(
      <LocaleProvider
        locale="he"
        messages={{ numberFormat: { decimal: ",", grouping: "." } }}
      >
        <NumericInput
          ariaLabel="Estimate"
          constraints={{ min: 1.5, max: 2.5 }}
          onChange={save}
        />
      </LocaleProvider>,
    );
    await expect(field).toHaveAttribute("id", originalId!);
    await expect(field).toHaveValue("");
    await expect(component.getByTestId("numeric-feedback")).toContainText(
      "1,5",
    );
    expect(records).toHaveLength(0);
    await field.pressSequentially("1,5");
    await expect(field).toHaveValue("1,5");
    await expect(component.getByTestId("numeric-feedback")).toHaveAttribute(
      "data-state",
      "valid",
    );
    await field.blur();
    await expect
      .poll(() => records.at(-1))
      .toEqual({ entry: "1,5", format: { decimal: ",", grouping: "." } });
  });
}

test("numeric provider format changes preserve local text until the next accepted edit", async ({
  mount,
}) => {
  const records: Array<{
    entry: string;
    format: { decimal: string; grouping: string };
  }> = [];
  const save = (entry: string, format: { decimal: string; grouping: string }) =>
    records.push({ entry, format });
  const component = await mount(
    <LocaleProvider locale="en">
      <NumericInput
        ariaLabel="Estimate"
        constraints={{ min: 1.5, max: 2.5 }}
        onChange={save}
      />
    </LocaleProvider>,
  );
  const field = component.getByRole("textbox");
  await field.pressSequentially("1.5");
  await component.update(
    <LocaleProvider
      locale="he"
      messages={{ numberFormat: { decimal: ",", grouping: "." } }}
    >
      <NumericInput
        ariaLabel="Estimate"
        constraints={{ min: 1.5, max: 2.5 }}
        onChange={save}
      />
    </LocaleProvider>,
  );
  await expect(field).toHaveValue("1.5");
  await expect(component.getByTestId("numeric-feedback")).toContainText("1.5");
  await expect
    .poll(() => records.at(-1))
    .toEqual({ entry: "1.5", format: { decimal: ".", grouping: "," } });
  await field.fill("1,5");
  await field.blur();
  await expect
    .poll(() => records.at(-1))
    .toEqual({ entry: "1,5", format: { decimal: ",", grouping: "." } });
});
