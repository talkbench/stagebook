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

for (const stylesheet of [true, false]) {
  test(`timer follows scoped primary colors and honors an inherited fill override (stylesheet=${String(stylesheet)}, #616)`, async ({
    mount,
    page,
  }) => {
    if (!stylesheet) {
      await page.evaluate(() => {
        document
          .querySelectorAll('style, link[rel="stylesheet"]')
          .forEach((el) => el.remove());
      });
    }
    const component = await mount(
      <div>
        <div
          data-testid="theme"
          style={{ "--stagebook-primary": "#005a99" } as CSSProperties}
        >
          <Button primary>Continue</Button>
          <MockKitchenTimer startTime={0} endTime={60} elapsedTime={20} />
        </div>
      </div>,
    );
    const theme = component.getByTestId("theme");
    const fill = component.getByTestId("timer-fill");
    const button = component.getByRole("button");
    await expect(button).toHaveCSS("background-color", "rgb(0, 90, 153)");
    await expect(fill).toHaveCSS("background-color", "rgb(0, 90, 153)");
    await theme.evaluate((el) =>
      (el as HTMLElement).style.setProperty("--stagebook-primary", "#15803d"),
    );
    await expect(fill).toHaveCSS("background-color", "rgb(21, 128, 61)");
    // A dedicated override on an ancestor must still beat the local primary.
    await component.evaluate((el) =>
      (el as HTMLElement).style.setProperty(
        "--stagebook-timer-fill",
        "#626977",
      ),
    );
    await expect(fill).toHaveCSS("background-color", "rgb(98, 105, 119)");
    await component.evaluate((el) =>
      (el as HTMLElement).style.removeProperty("--stagebook-timer-fill"),
    );
    await expect(fill).toHaveCSS("background-color", "rgb(21, 128, 61)");
  });
}
