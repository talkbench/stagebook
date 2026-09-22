import { test, expect } from "@playwright/experimental-ct-react";
import { MockTimeline } from "../testing/MockTimeline.js";

const props = {
  source: "player",
  playerName: "player",
  name: "edits",
  selectionType: "range" as const,
  multiSelect: true,
  mockDuration: 60,
  initialSelections: [{ start: 10, end: 20 }],
};

test("keyboard edits stay local while held, commit on release, and cancel on blur", async ({
  mount,
  page,
}) => {
  const component = await mount(
    <div>
      <MockTimeline {...props} />
      <input aria-label="outside" />
    </div>,
  );
  const timeline = component.getByTestId("timeline");
  await component.getByTestId("range-0").click();
  await page.keyboard.press("Tab");
  for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(650); // Past the old trailing debounce; a held key is unfinished.
  await expect(component.getByTestId("save-log")).toHaveText("[]");
  await page.keyboard.up("ArrowRight");
  await expect(component.getByTestId("save-log")).toHaveText(
    JSON.stringify([
      { key: "timeline_edits", value: [{ start: 10, end: 25 }] },
    ]),
  );
  const committed = await component.getByTestId("range-0").boundingBox();
  await page.keyboard.down("ArrowRight");
  await component.getByRole("textbox").focus();
  await expect
    .poll(
      async () => (await component.getByTestId("range-0").boundingBox())?.width,
    )
    .toBe(committed!.width);
  await page.keyboard.up("ArrowRight");
  await timeline.focus();
  await page.keyboard.press("Delete");
  // Undo must not resurrect the canceled adjustment.
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        JSON.parse((await component.getByTestId("save-log").textContent())!).at(
          -1,
        ).value,
    )
    .toEqual([{ start: 10, end: 25 }]);
});

for (const selectionType of ["range", "point"] as const) {
  test(`${selectionType}: canceled pointer edits restore the prior value without saving`, async ({
    mount,
    page,
  }) => {
    const initialSelections =
      selectionType === "range" ? [{ start: 10, end: 20 }] : [{ time: 20 }];
    const component = await mount(
      <MockTimeline
        {...props}
        selectionType={selectionType}
        initialSelections={initialSelections}
      />,
    );
    const target = component.getByTestId(
      selectionType === "range" ? "range-0-handle-end" : "point-0",
    );
    const box = (await target.boundingBox())!;
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const overlay = component.getByTestId("selection-overlay");
    const event = {
      pointerId: 17,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    };
    await target.dispatchEvent("pointerdown", event);
    await overlay.dispatchEvent("pointermove", { ...event, clientX: x + 60 });
    await expect
      .poll(async () => (await target.boundingBox())?.x)
      .not.toBe(box.x);
    await expect(component.getByTestId("save-log")).toHaveText("[]");
    await overlay.dispatchEvent("pointercancel", event);
    await expect.poll(async () => (await target.boundingBox())?.x).toBe(box.x);
    await expect(component.getByTestId("save-log")).toHaveText("[]");
    await component.getByTestId("timeline").focus();
    await page.keyboard.press("Control+z");
    await expect(component.getByTestId("save-log")).toHaveText("[]");
  });
}

test("a completed pointer edit emits once, but an interrupted creation emits nothing", async ({
  mount,
  page,
}) => {
  const component = await mount(<MockTimeline {...props} />);
  const target = component.getByTestId("range-0-handle-end");
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 10 });
  await expect(component.getByTestId("save-log")).toHaveText("[]");
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        JSON.parse((await component.getByTestId("save-log").textContent())!)
          .length,
    )
    .toBe(1);
  const overlay = component.getByTestId("selection-overlay");
  const area = (await overlay.boundingBox())!;
  const event = {
    pointerId: 19,
    pointerType: "pen",
    isPrimary: true,
    button: 0,
    clientX: area.x + area.width * 0.8,
    clientY: area.y + 20,
  };
  await overlay.dispatchEvent("pointerdown", event);
  await overlay.dispatchEvent("pointermove", {
    ...event,
    clientX: area.x + area.width * 0.9,
  });
  await overlay.dispatchEvent("pointercancel", event);
  await expect(component.getByTestId("range-drag-preview")).toHaveCount(0);
  expect(
    JSON.parse((await component.getByTestId("save-log").textContent())!).length,
  ).toBe(1);
});

for (const interruption of ["focus loss", "window blur", "stage cutoff"]) {
  test(`pointer edit ${interruption} discards the preview and ignores late release`, async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <div>
        <MockTimeline {...props} />
        <input aria-label="outside" />
      </div>,
    );
    const target = component.getByTestId("range-0-handle-end");
    const before = (await target.boundingBox())!;
    await page.mouse.move(
      before.x + before.width / 2,
      before.y + before.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(before.x + 70, before.y + before.height / 2, {
      steps: 5,
    });
    await expect
      .poll(async () => (await target.boundingBox())?.x)
      .not.toBe(before.x);
    if (interruption === "focus loss")
      await component.getByRole("textbox").focus();
    else if (interruption === "window blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else
      await component.update(
        <div>
          <MockTimeline {...props} mockShowTimeline={false} />
          <input aria-label="outside" />
        </div>,
      );
    await page.mouse.up();
    await expect(component.getByTestId("save-log")).toHaveText("[]");
    if (interruption !== "stage cutoff")
      await expect
        .poll(async () => (await target.boundingBox())?.x)
        .toBe(before.x);
  });
}

test("cutoff during a held keyboard edit has no cleanup save", async ({
  mount,
  page,
}) => {
  const component = await mount(<MockTimeline {...props} />);
  await component.getByTestId("range-0").click();
  await page.keyboard.press("Tab");
  await page.keyboard.down("ArrowRight");
  await component.update(<MockTimeline {...props} mockShowTimeline={false} />);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(600);
  await expect(component.getByTestId("save-log")).toHaveText("[]");
});
