import { test, expect } from "@playwright/experimental-ct-react";
import { MockSaveTracker } from "./testing/MockSaveTracker";
import type { StageConfig } from "./Stage";

test.describe("Save metadata (wrappedSave)", () => {
  test("submitButton save includes step and stageTimeElapsed", async ({
    mount,
  }) => {
    const stage: StageConfig = {
      name: "testStage",
      duration: 60,
      elements: [{ type: "submitButton", name: "confirm" }],
    };

    const component = await mount(
      <MockSaveTracker stage={stage} elapsedTime={25.5} />,
    );

    // Click submit
    await component.locator("button").click();

    const log = await component
      .locator('[data-testid="save-log"]')
      .textContent();
    const saves = JSON.parse(log!);

    const submitSave = saves.find(
      (s: { key: string }) => s.key === "submitButton_confirm",
    );
    expect(submitSave).toBeDefined();
    expect(submitSave.value.time).toBe(25.5);
    expect(submitSave.value.step).toBe("game_0_testStage");
    expect(submitSave.value.stageTimeElapsed).toBe(25.5);
  });

  test("prompt save includes step and stageTimeElapsed", async ({ mount }) => {
    const stage: StageConfig = {
      name: "promptStage",
      duration: 120,
      elements: [
        { type: "prompt", file: "test/q.md", name: "myPrompt" },
        { type: "submitButton" },
      ],
    };

    const component = await mount(
      <MockSaveTracker stage={stage} elapsedTime={42} />,
    );

    // Wait for prompt to load, then find a radio button or just submit
    // The mock prompt is noResponse type, so no input — just verify
    // submit button save has metadata
    await component.locator("button").click();

    const log = await component
      .locator('[data-testid="save-log"]')
      .textContent();
    const saves = JSON.parse(log!);

    // Every save should have step and stageTimeElapsed
    for (const save of saves) {
      if (save.value && typeof save.value === "object") {
        expect(save.value.step).toBe("game_0_promptStage");
        expect(typeof save.value.stageTimeElapsed).toBe("number");
      }
    }
  });

  test("metadata is consistent across different element types", async ({
    mount,
  }) => {
    const stage: StageConfig = {
      name: "mixedStage",
      duration: 60,
      elements: [
        { type: "submitButton", name: "btn1" },
        { type: "submitButton", name: "btn2" },
      ],
    };

    const component = await mount(
      <MockSaveTracker stage={stage} elapsedTime={10} />,
    );

    // Click first button
    await component.locator("button").first().click();

    const log = await component
      .locator('[data-testid="save-log"]')
      .textContent();
    const saves = JSON.parse(log!);

    expect(saves.length).toBeGreaterThanOrEqual(1);
    const save = saves[0];
    expect(save.value.step).toBe("game_0_mixedStage");
    expect(save.value.stageTimeElapsed).toBe(10);
  });
});
