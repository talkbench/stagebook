import { test, expect } from "@playwright/experimental-ct-react";
import { Slider } from "./Slider.js";

for (const initial of [undefined, 25]) {
  test(`pointer adjustment from ${initial ?? "unanswered"} previews locally and emits once on release`, async ({
    mount,
    page,
  }) => {
    const values: number[] = [];
    const component = await mount(
      <Slider
        value={initial}
        showValue
        onChange={(v) => {
          values.push(v);
        }}
      />,
    );
    const track = component.locator('[data-testid="slider-track"]');
    const box = (await track.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, {
      steps: 10,
    });
    await expect(component.getByTestId("slider-value-badge")).toHaveText(
      /^(7\d|8\d)$/,
    );
    // Longer than the old Prompt debounce; holding is not a commit.
    await page.waitForTimeout(150);
    expect(values).toEqual([]);
    await page.mouse.up();
    await expect.poll(() => values.length).toBe(1);
    expect(values[0]).toBeGreaterThanOrEqual(75);
    await page.waitForTimeout(150);
    expect(values).toHaveLength(1);
  });
}

test("held keyboard adjustments commit once on key release, with no save during a pause", async ({
  mount,
  page,
}) => {
  const values: number[] = [];
  const component = await mount(
    <Slider
      value={50}
      onChange={(v) => {
        values.push(v);
      }}
    />,
  );
  const input = component.getByRole("slider");
  await input.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowRight");
  await expect(input).toHaveValue("55");
  await page.waitForTimeout(150);
  expect(values).toEqual([]);
  await page.keyboard.up("ArrowRight");
  await expect.poll(() => values).toEqual([55]);
});

for (const pointerType of ["touch", "pen"]) {
  test(`${pointerType}: cancellation restores unanswered state and cannot later commit`, async ({
    mount,
  }) => {
    const values: number[] = [];
    const component = await mount(
      <Slider
        onChange={(v) => {
          values.push(v);
        }}
      />,
    );
    const wrapper = component.locator('[role="presentation"]');
    const box = (await component.getByTestId("slider-track").boundingBox())!;
    const event = {
      pointerId: 1,
      pointerType,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width * 0.7,
      clientY: box.y + box.height / 2,
    };
    await wrapper.dispatchEvent("pointerdown", event);
    await expect(component).toHaveAttribute("data-state", "anchored");
    await wrapper.dispatchEvent("pointercancel", event);
    await expect(component).toHaveAttribute("data-state", "unanchored");
    await wrapper.dispatchEvent("pointerup", event);
    expect(values).toEqual([]);
  });
  test(`${pointerType}: completed adjustment emits its final value`, async ({
    mount,
  }) => {
    const values: number[] = [];
    const component = await mount(
      <Slider
        value={20}
        onChange={(v) => {
          values.push(v);
        }}
      />,
    );
    const wrapper = component.locator('[role="presentation"]');
    const box = (await component.getByTestId("slider-track").boundingBox())!;
    const event = {
      pointerId: 1,
      pointerType,
      isPrimary: true,
      button: 0,
      clientX: box.x + box.width * 0.7,
      clientY: box.y + box.height / 2,
    };
    await wrapper.dispatchEvent("pointerdown", event);
    await wrapper.dispatchEvent("pointermove", {
      ...event,
      clientX: box.x + box.width * 0.8,
    });
    expect(values).toEqual([]);
    await wrapper.dispatchEvent("pointerup", {
      ...event,
      clientX: box.x + box.width * 0.8,
    });
    await expect.poll(() => values).toEqual([80]);
  });
}

test("blur cancels unfinished keyboard changes and late keyup cannot save them", async ({
  mount,
  page,
}) => {
  const values: number[] = [];
  const component = await mount(
    <div>
      <Slider
        value={20}
        onChange={(v) => {
          values.push(v);
        }}
      />
      <input aria-label="outside" />
    </div>,
  );
  const input = component.getByRole("slider");
  await input.focus();
  await page.keyboard.down("ArrowRight");
  await expect(input).toHaveValue("21");
  await component.getByRole("textbox").focus();
  await expect(input).toHaveValue("20");
  await page.keyboard.up("ArrowRight");
  expect(values).toEqual([]);
});

test("unmount during a drag does not emit an answer", async ({
  mount,
  page,
}) => {
  const values: number[] = [];
  const component = await mount(
    <Slider
      value={20}
      onChange={(v) => {
        values.push(v);
      }}
    />,
  );
  const box = (await component.getByTestId("slider-track").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await component.unmount();
  await page.mouse.up();
  expect(values).toEqual([]);
});

test("canceling a second touch does not discard the active adjustment", async ({
  mount,
}) => {
  const values: number[] = [];
  const component = await mount(
    <Slider
      value={20}
      onChange={(v) => {
        values.push(v);
      }}
    />,
  );
  const wrapper = component.locator('[role="presentation"]');
  const box = (await component.getByTestId("slider-track").boundingBox())!;
  const event = {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: box.x + box.width * 0.7,
    clientY: box.y + box.height / 2,
  };
  await wrapper.dispatchEvent("pointerdown", event);
  await wrapper.dispatchEvent("pointerdown", { ...event, pointerId: 2 });
  await wrapper.dispatchEvent("pointercancel", { ...event, pointerId: 2 });
  await expect(component.getByRole("slider")).toHaveValue("70");
  await wrapper.dispatchEvent("pointerup", event);
  await expect.poll(() => values).toEqual([70]);
});
