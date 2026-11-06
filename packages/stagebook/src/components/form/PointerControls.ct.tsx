import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator } from "@playwright/test";
import { PointerControlsHarness } from "../testing/PointerControlsHarness.js";
import { MockSubmitButton } from "../testing/MockSubmitButton.js";
import type { PointerStats } from "../../utils/pointerTelemetry.js";

async function history(component: Locator) {
  return JSON.parse(
    (await component.getByTestId("pointer-history").textContent())!,
  ) as PointerStats[];
}

for (const control of ["radio", "checkbox"] as const) {
  test(`${control} records glyph, label text and padding once each before the answer callback`, async ({
    mount,
  }) => {
    const component = await mount(<PointerControlsHarness control={control} />);
    const inputs = component.locator("input");
    const rows = component.getByTestId("option");
    await inputs.nth(0).click();
    let records = await history(component);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      clickCount: 1,
      clickCountsBySource: { pointer: 1, keyboard: 0, unknown: 0 },
      clickSamples: [
        {
          source: "pointer",
          pointerType: "mouse",
          targetPart: "control",
          position: { width: expect.any(Number), x: expect.any(Number) },
          controlPosition: { x: expect.any(Number), y: expect.any(Number) },
        },
      ],
    });
    const textPoint = await rows.nth(1).evaluate((row) => {
      const text = [...row.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const textRect = range.getClientRects()[0]!;
      const rowRect = row.getBoundingClientRect();
      return {
        x: textRect.left + textRect.width / 2 - rowRect.left,
        y: textRect.top + textRect.height / 2 - rowRect.top,
      };
    });
    await rows.nth(1).click({ position: textPoint });
    records = await history(component);
    expect(records).toHaveLength(2);
    expect(records[1]!.clickCount).toBe(2);
    expect(records[1]!.clickSamples[1]).toMatchObject({
      source: "pointer",
      targetPart: "label-text",
    });
    expect(records[1]!.clickSamples[1]!.controlPosition!.x).toBeGreaterThan(1);

    const rowBox = (await rows.nth(2).boundingBox())!;
    await rows.nth(2).click({ position: { x: rowBox.width - 3, y: 3 } });
    records = await history(component);
    expect(records).toHaveLength(3);
    expect(records[2]!.clickCount).toBe(3);
    expect(records[2]!.clickSamples[2]!.targetPart).toBe("padding");
    expect(records[0]!.clickCount).toBe(1);
    expect(records[0]!.clickSamples).toHaveLength(1);
  });

  test(`${control} keyboard and programmatic activations have no invented placement`, async ({
    mount,
  }) => {
    const component = await mount(<PointerControlsHarness control={control} />);
    const inputs = component.locator("input");
    await inputs.nth(0).focus();
    await inputs.nth(0).press("Space");
    let records = await history(component);
    expect(records.at(-1)!.clickSamples[0]).toMatchObject({
      source: "keyboard",
      position: null,
      controlPosition: null,
      pointerType: null,
    });
    if (control === "radio") {
      await inputs.nth(0).press("ArrowDown");
      records = await history(component);
      expect(records.at(-1)!.clickSamples.at(-1)).toMatchObject({
        source: "keyboard",
        position: null,
      });
    }
    await inputs.nth(2).click();
    await inputs.nth(3).evaluate((input: HTMLInputElement) => input.click());
    records = await history(component);
    expect(records.at(-1)!.clickSamples.at(-1)).toMatchObject({
      source: "unknown",
      position: null,
      controlPosition: null,
      pointerType: null,
    });
  });
}

test("nested button content uses button geometry and distinguishes keyboard and programmatic activation", async ({
  mount,
}) => {
  const component = await mount(<PointerControlsHarness control="button" />);
  const button = component.getByRole("button");
  await button.evaluate(() => document.fonts.ready.then(() => {}));
  const box = (await button.boundingBox())!;
  await component.getByTestId("nested-button-content").click();
  let records = await history(component);
  expect(records[0]!.clickSamples[0]).toMatchObject({
    source: "pointer",
    targetPart: "control",
  });
  expect(records[0]!.clickSamples[0]!.position!.width).toBeCloseTo(
    box.width,
    4,
  );
  expect(records[0]!.clickSamples[0]!.position!.height).toBeCloseTo(
    box.height,
    4,
  );
  await button.press("Enter");
  await button.press("Space");
  await button.evaluate((element: HTMLButtonElement) => element.click());
  records = await history(component);
  expect(records).toHaveLength(4);
  expect(records.at(-1)!.clickCountsBySource).toEqual({
    pointer: 1,
    keyboard: 2,
    unknown: 1,
  });
  for (const sample of records.at(-1)!.clickSamples.slice(1)) {
    expect(sample.position).toBeNull();
    expect(sample.controlPosition).toBeNull();
  }
});

test("disabled buttons do not activate or save a snapshot", async ({
  mount,
}) => {
  const component = await mount(
    <PointerControlsHarness control="button" disabled />,
  );
  await component.getByRole("button").click({ force: true });
  await component.getByRole("button").evaluate((button: HTMLButtonElement) => {
    button.click();
  });
  expect(await history(component)).toEqual([]);
});

test("SubmitButton's existing record includes the activation that submits", async ({
  mount,
}) => {
  const component = await mount(<MockSubmitButton name="continue" />);
  await component.getByRole("button").click();
  const record = JSON.parse(
    (await component.getByTestId("submit-saved-value").textContent())!,
  ) as { pointerStats: PointerStats };
  expect(record.pointerStats).toMatchObject({
    controlType: "button",
    clickCount: 1,
    clickCountsBySource: { pointer: 1, keyboard: 0, unknown: 0 },
    clickSamples: [{ source: "pointer", pointerType: "mouse" }],
  });
  await expect(component.getByTestId("submit-submitted")).toHaveText("true");
});

test.describe("touch activation", () => {
  test.use({ hasTouch: true });

  for (const control of ["button", "radio", "checkbox"] as const) {
    test(`${control} taps retain touch provenance and label forwarding counts once`, async ({
      mount,
    }) => {
      const component = await mount(
        <PointerControlsHarness control={control} />,
      );
      await component.evaluate(() => document.fonts.ready.then(() => {}));
      for (let index = 0; index < 2; index++) {
        if (control === "button") {
          await component.getByTestId("nested-button-content").tap();
        } else {
          const row = component.getByTestId("option").nth(index);
          const textPoint = await row.evaluate((label) => {
            const text = [...label.childNodes].find(
              (node) =>
                node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            )!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const textRect = range.getClientRects()[0]!;
            const labelRect = label.getBoundingClientRect();
            return {
              x: textRect.left + textRect.width / 2 - labelRect.left,
              y: textRect.top + textRect.height / 2 - labelRect.top,
            };
          });
          await row.tap({ position: textPoint });
        }
        const records = await history(component);
        expect(records).toHaveLength(index + 1);
        expect(records.at(-1)).toMatchObject({
          clickCount: index + 1,
          clickCountsBySource: { pointer: index + 1, keyboard: 0, unknown: 0 },
          clickCountsByPointerType: { touch: index + 1, mouse: 0, pen: 0 },
        });
        expect(records.at(-1)!.clickSamples).toHaveLength(index + 1);
        expect(records.at(-1)!.clickSamples.at(-1)).toMatchObject({
          source: "pointer",
          pointerType: "touch",
          isTrusted: true,
          targetPart: control === "button" ? "control" : "label-text",
          coordinateEvent: "click",
          position: { x: expect.any(Number), y: expect.any(Number) },
        });
      }
    });
  }
});
