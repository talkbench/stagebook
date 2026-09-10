import { test, expect } from "@playwright/experimental-ct-react";
import type { CSSProperties } from "react";
import { RadioGroup } from "./form/RadioGroup";
import { CheckboxGroup } from "./form/CheckboxGroup";
import { Select } from "./form/Select";
import { TextArea } from "./form/TextArea";
import { Button } from "./form/Button";
import { MockKitchenTimer } from "./testing/MockKitchenTimer";
import { TimeRuler } from "./elements/timeline/TimeRuler";

const options = [{ key: "a", value: "Option A" }];

for (const theme of ["default", "fallback", "custom"] as const) {
  test(`choice outlines and ruler text are independent of field borders (${theme}, #616)`, async ({
    mount,
  }) => {
    const style =
      theme === "default"
        ? {}
        : {
            "--stagebook-border": theme === "fallback" ? "initial" : "#d1d5db",
            "--stagebook-choice-border":
              theme === "fallback" ? "initial" : "#005a99",
            "--stagebook-timeline-ruler-text":
              theme === "fallback" ? "initial" : "#005a99",
          };
    const component = await mount(
      <div style={style as CSSProperties}>
        <RadioGroup options={options} onChange={() => {}} />
        <CheckboxGroup options={options} onChange={() => {}} />
        <Select options={options} onChange={() => {}} label="Choose" />
        <TextArea label="Response" />
        <Button primary={false}>Back</Button>
        <TimeRuler duration={60} width={600} zoomLevel={1} viewportStart={0} />
      </div>,
    );
    for (const role of ["radio", "checkbox"] as const) {
      await expect(component.getByRole(role)).toHaveCSS(
        "border-top-color",
        theme === "custom" ? "rgb(0, 90, 153)" : "rgb(133, 140, 153)",
      );
    }
    for (const role of ["combobox", "textbox", "button"] as const) {
      await expect(component.getByRole(role)).toHaveCSS(
        "border-top-color",
        "rgb(209, 213, 219)",
      );
    }
    await expect(
      component.getByTestId("time-ruler").getByText("0:30", { exact: true }),
    ).toHaveCSS(
      "color",
      theme === "custom" ? "rgb(0, 90, 153)" : "rgb(115, 115, 115)",
    );
  });
}

test("timer falls back to the host primary color and accepts a dedicated override (#616)", async ({
  mount,
}) => {
  const component = await mount(
    <div
      style={
        {
          "--stagebook-primary": "#005a99",
          "--stagebook-timer-fill": "initial",
        } as CSSProperties
      }
    >
      <MockKitchenTimer startTime={0} endTime={60} elapsedTime={20} />
    </div>,
  );
  const fill = component.getByTestId("timer-fill");
  await expect(fill).toHaveCSS("background-color", "rgb(0, 90, 153)");
  await component.evaluate((el) =>
    (el as HTMLElement).style.setProperty("--stagebook-timer-fill", "#626977"),
  );
  await expect(fill).toHaveCSS("background-color", "rgb(98, 105, 119)");
});
