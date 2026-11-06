import { test, expect } from "@playwright/experimental-ct-react";
import { TextArea } from "./TextArea";
import { NumericInput } from "./NumericInput";
import type { PointerStats } from "../../utils/pointerTelemetry";

test("text clicks preserve empty/return/already-focused context without extra saves", async ({
  mount,
}) => {
  const snapshots: PointerStats[] = [];
  const values: string[] = [];
  const component = await mount(
    <TextArea
      defaultText="A placeholder is not an answer"
      onPointerSnapshot={(stats) => snapshots.push(stats)}
      onChange={(value) => values.push(value)}
      debounceDelay={100000}
      maxWait={100000}
    />,
  );
  const field = component.locator("textarea");
  await field.click({ position: { x: 25, y: 15 } });
  await expect.poll(() => snapshots.at(-1)?.clickCount).toBe(1);
  expect(snapshots.at(-1)).toMatchObject({
    clickSamples: [
      {
        source: "pointer",
        targetPart: "control",
        fieldState: { wasFocused: false, wasEmpty: true, priorFocusCount: 0 },
      },
    ],
    focusSamples: [
      {
        source: "pointer",
        visit: "first",
        fieldState: { wasFocused: false, wasEmpty: true, priorFocusCount: 0 },
      },
    ],
  });
  const first = JSON.stringify(snapshots.at(-1));
  const box = (await field.boundingBox())!;
  expect(snapshots.at(-1)!.clickSamples[0].position!.x).toBeCloseTo(
    25 / box.width,
    2,
  );
  expect(values).toEqual([]);
  await field.fill("answer");
  await field.click({ position: { x: 40, y: 20 } });
  await expect.poll(() => snapshots.at(-1)?.clickCount).toBe(2);
  expect(snapshots.at(-1)!.clickSamples[1].fieldState).toEqual({
    wasFocused: true,
    wasEmpty: false,
    priorFocusCount: 1,
  });
  expect(snapshots.at(-1)!.focusCount).toBe(1);
  expect(values).toEqual([]);
  await field.blur();
  await expect.poll(() => values).toEqual(["answer"]);
  await field.click({ position: { x: 30, y: 20 } });
  await expect.poll(() => snapshots.at(-1)?.focusCount).toBe(2);
  expect(snapshots.at(-1)!.focusSamples[1]).toMatchObject({
    visit: "return",
    fieldState: { wasFocused: false, wasEmpty: false, priorFocusCount: 1 },
  });
  // Previously delivered payloads are detached from the live accumulator.
  expect(
    JSON.stringify(snapshots.find((stats) => stats.clickCount === 1)),
  ).toBe(first);
});

test("a visible text label preserves label-origin geometry and one activation", async ({
  mount,
}) => {
  const snapshots: PointerStats[] = [];
  const component = await mount(
    <TextArea
      label="Response"
      onPointerSnapshot={(stats) => snapshots.push(stats)}
    />,
  );
  await component.locator("label").click();
  await expect(component.locator("textarea")).toBeFocused();
  await expect.poll(() => snapshots.at(-1)?.clickCount).toBe(1);
  expect(snapshots.at(-1)).toMatchObject({
    clickSamples: [{ source: "pointer", targetPart: "label" }],
    focusSamples: [{ source: "pointer", targetPart: "label" }],
  });
  expect(snapshots.at(-1)!.clickSamples[0].position).not.toBeNull();
});

test("numeric affix placement stays distinct from direct input placement", async ({
  mount,
}) => {
  const snapshots: PointerStats[] = [];
  const values: string[] = [];
  const component = await mount(
    <NumericInput
      prefix="$"
      onPointerSnapshot={(stats) => snapshots.push(stats)}
      onChange={(value) => values.push(value)}
    />,
  );
  await component.locator("bdi").click();
  await expect(component.locator("input")).toBeFocused();
  await expect.poll(() => snapshots.at(-1)?.clickCount).toBe(1);
  expect(snapshots.at(-1)!.clickSamples[0].targetPart).not.toBe("control");
  expect(snapshots.at(-1)!.clickSamples[0].controlPosition!.x).toBeLessThan(0);
  expect(snapshots.at(-1)!.focusSamples[0].fieldState).toEqual({
    wasFocused: false,
    wasEmpty: true,
    priorFocusCount: 0,
  });
  expect(values).toEqual([]);
});

test("Tab and script focus have no fabricated placement", async ({
  mount,
  page,
}) => {
  const snapshots: PointerStats[] = [];
  const component = await mount(
    <div>
      <button>Before</button>
      <TextArea onPointerSnapshot={(stats) => snapshots.push(stats)} />
    </div>,
  );
  await component.locator("button").focus();
  await page.keyboard.press("Tab");
  await expect(component.locator("textarea")).toBeFocused();
  await expect.poll(() => snapshots.at(-1)?.focusCount).toBe(1);
  expect(snapshots.at(-1)!.focusSamples[0].position).toBeNull();
  expect(snapshots.at(-1)!.focusSamples[0].source).not.toBe("pointer");
  await component.locator("textarea").blur();
  await component.locator("textarea").focus();
  await expect.poll(() => snapshots.at(-1)?.focusCount).toBe(2);
  expect(snapshots.at(-1)!.focusSamples[1]).toMatchObject({
    source: "unknown",
    position: null,
  });
});
