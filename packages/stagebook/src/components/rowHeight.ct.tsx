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
