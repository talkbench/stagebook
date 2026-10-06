import { test, expect } from "@playwright/experimental-ct-react";
import type { Locator } from "playwright/test";
import { Prompt } from "./Prompt";
import { BodylessCheckboxHarness } from "../testing/BodylessCheckboxHarness";
import {
  bodylessCheckboxes,
  bodylessDropdown,
  bodylessNumeric,
  bodylessOpenResponse,
  bodylessRadios,
} from "./fixtures/prompts";

// `body: none` (#718): the browser computes the accessible names, so they're
// checked here rather than in jsdom (Prompt.bodyless.test.tsx).

const TECHNICAL_ERRORS =
  "This recording has technical errors that prevent analysis";

// A new block formatting context, so a child's top margin stays inside the
// root instead of collapsing through it and measuring as no gap.
const contain = { display: "flow-root" } as const;

/** Distance from the mounted root's top-left corner to the target's. */
async function offset(root: Locator, target: Locator) {
  const outer = (await root.boundingBox())!;
  const inner = (await target.boundingBox())!;
  return { top: inner.y - outer.y, start: inner.x - outer.x };
}

test("a bodyless checkbox is named by its label and toggles by click and keyboard", async ({
  mount,
  page,
}) => {
  const component = await mount(<BodylessCheckboxHarness />);
  const checkbox = component.getByRole("checkbox", { name: TECHNICAL_ERRORS });
  const others = component.getByTestId("other-questions");
  const saved = component.getByTestId("saved");

  // Optional and unchecked: nothing saved, and `doesNotInclude` holds.
  await expect(checkbox).not.toBeChecked();
  await expect(others).toBeVisible();
  await expect(saved).toHaveText("null");

  await component.getByText(TECHNICAL_ERRORS).click();
  await expect(checkbox).toBeChecked();
  await expect(others).toHaveCount(0);
  await expect(saved).toHaveText(JSON.stringify([TECHNICAL_ERRORS]));

  await checkbox.focus();
  await page.keyboard.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(others).toBeVisible();
  await expect(saved).toHaveText("[]");
});

test("bodyless checkboxes sit flush, in a row, in an unnamed group", async ({
  mount,
}) => {
  const component = await mount(
    <div style={contain}>
      <Prompt
        {...bodylessCheckboxes}
        name="materials"
        value={[]}
        save={() => {}}
      />
    </div>,
  );
  await expect(component.getByRole("group")).not.toHaveAttribute(
    "aria-labelledby",
  );
  const rows = component.getByTestId("option");
  const first = await offset(component, rows.first());
  const second = await offset(component, rows.last());
  expect(first.top).toBeCloseTo(0, 0);
  expect(first.start).toBeCloseTo(0, 0);
  expect(second.top).toBeCloseTo(first.top, 0);
  await expect(
    component.getByRole("checkbox", { name: "Show strategy notes" }),
  ).toBeVisible();
});

test("an ariaLabel names bodyless radios without showing", async ({
  mount,
}) => {
  const component = await mount(
    <div style={contain}>
      <Prompt
        {...bodylessRadios}
        name="briefing"
        value={undefined}
        save={() => {}}
      />
    </div>,
  );
  const group = component.getByRole("radiogroup", {
    name: "Briefing materials",
  });
  await expect(group).toBeVisible();
  await expect(component.getByText("Briefing materials")).toBeHidden();
  const first = await offset(
    component,
    component.getByTestId("option").first(),
  );
  expect(first.top).toBeCloseTo(0, 0);
  expect(first.start).toBeCloseTo(0, 0);
});

test("an ariaLabel names a bodyless textarea", async ({ mount }) => {
  const component = await mount(
    <div style={contain}>
      <Prompt {...bodylessOpenResponse} name="notes" value="" save={() => {}} />
    </div>,
  );
  const textbox = component.getByRole("textbox", {
    name: "Notes on this recording",
  });
  await expect(textbox).toBeVisible();
  await expect(component.getByText("Notes on this recording")).toBeHidden();
  // Firefox sets the textarea 1px down within its line; a body gap is 16px.
  expect((await offset(component, textbox)).top).toBeLessThan(2);
});

test("an ariaLabel names a bodyless dropdown, with no gap above it", async ({
  mount,
}) => {
  const component = await mount(
    <div style={contain}>
      <Prompt
        {...bodylessDropdown}
        name="house"
        value={undefined}
        save={() => {}}
      />
    </div>,
  );
  const select = component.getByRole("combobox", { name: "Hogwarts house" });
  await expect(select).toBeVisible();
  expect((await offset(component, select)).top).toBeCloseTo(0, 0);
});

test("an ariaLabel names a bodyless numeric field", async ({ mount }) => {
  const component = await mount(
    <div style={contain}>
      <Prompt
        {...bodylessNumeric}
        name="age"
        value={undefined}
        save={() => {}}
      />
    </div>,
  );
  await expect(
    component.getByRole("textbox", { name: "Age in years" }),
  ).toBeVisible();
  await expect(component.getByText("Age in years")).toBeHidden();
});
