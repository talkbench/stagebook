import { test, expect } from "@playwright/experimental-ct-react";
import { MockStageRenderer } from "../testing/MockStageRenderer";

// A minimal stage with one element — submitButton is an advancement
// element and keeps the stage schema-valid in both passing and failing
// condition cases.
const elements = [{ type: "submitButton" as const }];

test.describe("StageConditionGate (#183)", () => {
  test("renders stage body when all conditions pass", async ({
    mount,
    page,
  }) => {
    await mount(
      <MockStageRenderer
        stage={{
          name: "r2",
          duration: 60,
          conditions: [
            {
              reference: "shared.survey.continueVote.result.keepGoing",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements,
        }}
        stateValues={{
          "shared.survey.continueVote.result.keepGoing": "yes",
        }}
      />,
    );
    await expect(page.locator('[data-testid="stageContent"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="stage-condition-gate"]'),
    ).not.toBeVisible();
  });

  test("shows the advancing state when a stage-level condition fails", async ({
    mount,
    page,
  }) => {
    await mount(
      <MockStageRenderer
        stage={{
          name: "r2",
          duration: 60,
          conditions: [
            {
              reference: "shared.survey.continueVote.result.keepGoing",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements,
        }}
        stateValues={{
          "shared.survey.continueVote.result.keepGoing": "no",
        }}
      />,
    );
    const gate = page.locator('[data-testid="stage-condition-gate"]');
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("data-state", "advancing");
    // Stage body should not be rendered.
    await expect(
      page.locator('[data-testid="stageContent"]'),
    ).not.toBeVisible();
  });

  test("shows the advancing state when the referenced data is absent (skip-at-load)", async ({
    mount,
    page,
  }) => {
    // `equals "yes"` evaluates false against undefined data — classic
    // skip-at-load pattern when the prior-stage value was never set.
    await mount(
      <MockStageRenderer
        stage={{
          name: "r2",
          duration: 60,
          conditions: [
            {
              reference: "shared.survey.continueVote.result.keepGoing",
              comparator: "equals",
              value: "yes",
            },
          ],
          elements,
        }}
        // no stateValues — references are undefined
      />,
    );
    await expect(
      page.locator('[data-testid="stage-condition-gate"]'),
    ).toBeVisible();
  });

  test("renders stage body when early-termination condition holds (data not yet present)", async ({
    mount,
    page,
  }) => {
    // Early-termination pattern: condition is true while the referenced
    // value is undefined; flips to false once data arrives.
    await mount(
      <MockStageRenderer
        stage={{
          name: "speed_round",
          duration: 60,
          conditions: [
            {
              reference: "shared.submitButton.speedSubmit",
              comparator: "doesNotExist",
            },
          ],
          elements: [{ type: "submitButton" as const, name: "speedSubmit" }],
        }}
        // no stateValues — submitButton.speedSubmit is undefined →
        // doesNotExist is true → stage renders.
      />,
    );
    await expect(page.locator('[data-testid="stageContent"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="stage-condition-gate"]'),
    ).not.toBeVisible();
  });

  test("exit-phase stage with a false condition skips cleanly (#315)", async ({
    mount,
    page,
  }) => {
    // The Stage component is phase-agnostic — game, intro, and exit
    // stages all share the same StageConditionGate path because the
    // viewer's flattenSteps collapses all three phases into a uniform
    // step shape. This test makes that guarantee explicit using the
    // dialogue-levers `second_discussion_followup` pattern from #315:
    // an exit-sequence stage gated on whether the participant opted
    // into the second discussion in a prior game stage. When the
    // referenced prompt answer is absent (e.g. partner attrited, or
    // the gating stage itself was skipped — the transitive-skip case),
    // the gate skips the exit step end-to-end.
    await mount(
      <MockStageRenderer
        stage={{
          // No `duration:` — matches how the viewer flattens exit steps
          // (only gameStages carry a duration). Keeping the field absent
          // exercises the schema path the host hits for exit phases.
          name: "second_discussion_followup",
          conditions: [
            {
              reference: "0.prompt.continue_with_partner",
              comparator: "equals",
              value: "Yes",
            },
          ],
          elements,
        }}
        // No stateValues — `0.prompt.continue_with_partner` is absent,
        // which is what the runtime sees when the prior gating stage
        // was itself skipped (transitive skip).
      />,
    );
    const gate = page.locator('[data-testid="stage-condition-gate"]');
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("data-state", "advancing");
    // `not.toBeAttached()` rather than `not.toBeVisible()` — when the
    // gate advances, StageConditionGate returns only the gate <div>
    // without children, so stageContent should not be in the DOM at
    // all. The stronger assertion catches a regression that mounted
    // children but hid them via CSS (visibility/display tricks).
    await expect(
      page.locator('[data-testid="stageContent"]'),
    ).not.toBeAttached();
  });

  test("no gate overhead when stage has no conditions", async ({
    mount,
    page,
  }) => {
    await mount(
      <MockStageRenderer
        stage={{
          name: "plain",
          duration: 60,
          elements,
        }}
      />,
    );
    await expect(page.locator('[data-testid="stageContent"]')).toBeVisible();
    await expect(
      page.locator('[data-testid="stage-condition-gate"]'),
    ).not.toBeAttached();
  });
});
