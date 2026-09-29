import { test, expect } from "@playwright/experimental-ct-react";
import { SharedPromptHarness } from "./fixtures/SharedPromptHarness";

test("the real Element/host callback path commits pending local text including remote merges", async ({
  mount,
}) => {
  const component = await mount(<SharedPromptHarness />);
  await component
    .getByRole("textbox", { name: "Host shared editor" })
    .fill("Local draft");
  await component.getByRole("button", { name: "Receive remote merge" }).click();
  await expect(component.getByTestId("write-count")).toHaveText("0");
  await expect(component.getByTestId("write-count")).toHaveText("1");
  const saved = JSON.parse(
    await component.getByTestId("last-write").innerText(),
  );
  expect(saved).toEqual({
    key: "prompt_answer",
    scope: "shared",
    record: {
      name: "answer",
      type: "openResponse",
      file: "answer.prompt.md",
      shared: true,
      prompt: "Shared answer",
      responses: ["A placeholder"],
      debugMessages: [],
      value: "Merged from peer",
      step: "game_0_shared",
      stageTimeElapsed: 42,
    },
  });
});

test("idle remote observers stay silent, but a former typist corrects a late merge", async ({
  mount,
  page,
}) => {
  const component = await mount(<SharedPromptHarness />);
  await component.getByRole("button", { name: "Receive remote merge" }).click();
  // This is a negative timing assertion: give a hypothetical accidental
  // quiet-period timer its complete window before checking that none wrote.
  await page.waitForTimeout(2100);
  await expect(component.getByTestId("write-count")).toHaveText("0");
  await component
    .getByRole("textbox", { name: "Host shared editor" })
    .fill("Mine before merge");
  await component.getByRole("button", { name: "Leave editor" }).click();
  await expect(component.getByTestId("write-count")).toHaveText("1");
  await component.getByRole("button", { name: "Receive remote merge" }).click();
  await expect(component.getByTestId("write-count")).toHaveText("2");
  await expect(component.getByTestId("last-write")).toContainText(
    '"value":"Merged from peer"',
  );
});
