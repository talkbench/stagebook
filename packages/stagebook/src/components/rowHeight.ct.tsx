import { test, expect } from "@playwright/experimental-ct-react";
import type { CSSProperties } from "react";
import { RadioGroup } from "./form/RadioGroup";
import { CheckboxGroup } from "./form/CheckboxGroup";
import { Select } from "./form/Select";
import { Button } from "./form/Button";
import { ListSorter } from "./form/ListSorter";
import { Prompt } from "./elements/Prompt";

const options = [
  { key: "a", value: "Agree" },
  { key: "b", value: "Disagree" },
];

for (const { name, token, height, sorterHeight } of [
  {
    name: "stylesheet default",
    token: undefined,
    height: 44,
    sorterHeight: 54,
  },
  {
    name: "component fallback",
    token: "initial",
    height: 44,
    sorterHeight: 54,
  },
  { name: "host override", token: "4.5rem", height: 72, sorterHeight: 72 },
]) {
  test(`row sizing: ${name} includes padding and borders (#632)`, async ({
    mount,
  }) => {
    const component = await mount(
      <div
        style={
          { "--stagebook-row-min-height": token, width: 400 } as CSSProperties
        }
      >
        <RadioGroup options={options} label="Radio" onChange={() => {}} />
        <CheckboxGroup options={options} label="Checkbox" onChange={() => {}} />
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <Select options={options} label="Device" onChange={() => {}} />
          </div>
          <Button icon aria-label="Refresh devices">
            +
          </Button>
        </div>
        <ListSorter items={["Alpha", "Bravo", "Charlie"]} onChange={() => {}} />
      </div>,
    );

    for (const testId of ["radioGroup", "checkboxGroup"]) {
      const rows = component.getByTestId(testId).getByTestId("option");
      await expect(rows).toHaveCount(2);
      for (const row of await rows.all()) {
        expect((await row.boundingBox())!.height).toBe(height);
      }
    }
    const select = (await component.getByRole("combobox").boundingBox())!;
    const button = (await component
      .getByRole("button", { name: "Refresh devices" })
      .boundingBox())!;
    expect(select.height).toBe(height);
    expect(button.height).toBe(height);
    expect(button.width).toBe(height);
    expect(button.y).toBe(select.y);

    for (let i = 0; i < 3; i++) {
      const row = (await component
        .getByTestId(`draggable-${i}`)
        .boundingBox())!;
      const number = (await component
        .locator("p")
        .filter({ hasText: `${i + 1}.` })
        .boundingBox())!;
      expect(row.height).toBe(sorterHeight);
      expect(number.height).toBe(sorterHeight);
      expect(number.y).toBe(row.y);
    }
  });
}

for (const select of ["single", "multiple"] as const) {
  test(`row sizing: ${select} choice prompts retain 44px rows and their body gap (#632)`, async ({
    mount,
  }) => {
    const component = await mount(
      <div>
        <Prompt
          metadata={{ type: "multipleChoice", select }}
          body="I felt heard during the discussion."
          responseItems={["Agree", "Disagree"]}
          responsePoints={[]}
          sliderPoints={[]}
          name="spacing"
          value={undefined}
          save={() => {}}
        />
      </div>,
    );
    const rows = component.getByTestId("option");
    await expect(rows).toHaveCount(2);
    const first = (await rows.first().boundingBox())!;
    const second = (await rows.nth(1).boundingBox())!;
    expect(first.height).toBe(44);
    expect(second.y - first.y).toBe(46);
    const body = (await component.locator("p").boundingBox())!;
    expect(first.y - body.y - body.height).toBeCloseTo(16, 1);
  });
}

for (const [name, token, height] of [
  ["default", undefined, 44],
  ["fallback", "initial", 44],
  ["host override", "4.5rem", 72],
] as const) {
  test(`Select label stays vertically centered: ${name} (#657)`, async ({
    mount,
    page,
  }) => {
    const component = await mount(
      <div
        style={
          { width: 340, "--stagebook-row-min-height": token } as CSSProperties
        }
      >
        <Select
          options={[{ key: "camera", value: "Camera" }]}
          value="camera"
          label="Device"
          onChange={() => {}}
        />
      </div>,
    );
    const select = component.getByRole("combobox");
    await page.evaluate(() => document.fonts.ready);
    expect((await select.boundingBox())!.height).toBe(height);
    const content = await select.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        appearance: style.appearance,
        left: parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
        right:
          parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight),
      };
    });
    const screenshot = await select.screenshot({ scale: "css" });
    await test
      .info()
      .attach("select-label", { body: screenshot, contentType: "image/png" });
    // The displayed label is an anonymous UA box: DOM option bounds do not
    // describe it. Read the painted ink, excluding the border and chevron.
    const gaps = await page.evaluate(
      async ({ base64, content }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const { data } = context.getImageData(0, 0, image.width, image.height);
        let first = image.height,
          last = -1;
        for (let y = 2; y < image.height - 2; y++) {
          for (
            let x = Math.ceil(content.left);
            x < image.width - content.right;
            x++
          ) {
            const i = (y * image.width + x) * 4;
            if (Math.max(data[i], data[i + 1], data[i + 2]) < 160) {
              first = Math.min(first, y);
              last = Math.max(last, y);
            }
          }
        }
        return {
          above: first,
          below: image.height - last - 1,
          inkHeight: last - first + 1,
        };
      },
      { base64: screenshot.toString("base64"), content },
    );
    await test.info().attach("label-position", {
      body: JSON.stringify({ appearance: content.appearance, height, ...gaps }),
      contentType: "application/json",
    });
    expect(
      gaps.inkHeight,
      "the sample must contain the displayed label",
    ).toBeGreaterThan(5);
    // A 1px movement grows one gap and shrinks the other: their difference
    // changes by 2px. Compare centers so the tolerance is 1 CSS px. Linux
    // WebKit paints this ink 1px lower than macOS; the original 3px shift
    // (and the larger shift with a host override) must still fail.
    const centerOffset = (gaps.above - gaps.below) / 2;
    expect(
      Math.abs(centerOffset),
      JSON.stringify({ ...gaps, centerOffset }),
    ).toBeLessThanOrEqual(1);
  });
}
