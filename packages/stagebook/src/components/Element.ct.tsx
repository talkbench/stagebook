import { test, expect } from "@playwright/experimental-ct-react";
import { MockStageRenderer } from "./testing/MockStageRenderer";
import type { StageConfig } from "./Stage";

// Helper: create a stage with a single element for testing dispatch
function singleElementStage(element: Record<string, unknown>): StageConfig {
  return {
    name: "TestStage",
    duration: 60,
    elements: [element as never],
  };
}

test.describe("Element router dispatch", () => {
  test("type: prompt renders prompt content", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "prompt",
          file: "test/prompt.md",
        })}
      />,
    );
    // MockStageRenderer's getTextContent returns mock prompt markdown
    await expect(component).toContainText("Mock content");
  });

  test("type: separator renders hr", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({ type: "separator", style: "thick" })}
      />,
    );
    await expect(component.locator("hr")).toBeVisible();
  });

  test("type: submitButton renders button", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "submitButton",
          buttonText: "Continue",
        })}
      />,
    );
    await expect(component.locator("button")).toContainText("Continue");
  });

  test("type: image renders img with CDN URL", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "image",
          file: "shared/photo.png",
        })}
      />,
    );
    await expect(component.locator("img")).toHaveAttribute(
      "src",
      "https://mock-cdn.test/shared/photo.png",
    );
  });

  test("type: image YAML file path with special chars is URL-encoded before resolve (#433)", async ({
    mount,
  }) => {
    // YAML `file:` fields are researcher-authored — a filename like
    // `My Photo!.png` or `round#3.png` must reach the host as URL-
    // safe input. Without encoding, the special chars land literally
    // in <img src> and either 404 or get misparsed by stricter
    // backends (e.g. `?` would split into a query string).
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "image",
          file: "shared/my pic.png",
        })}
      />,
    );
    await expect(component.locator("img")).toHaveAttribute(
      "src",
      "https://mock-cdn.test/shared/my%20pic.png",
    );
  });

  test("type: image YAML file path with `asset://` scheme is NOT re-encoded (#433)", async ({
    mount,
  }) => {
    // `asset://` is stagebook's platform-provided reference scheme
    // (#188). The path encoder skips anything with a scheme prefix
    // so the host's `asset://` handling stays intact.
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "image",
          file: "asset://diagrams/flow.png",
        })}
      />,
    );
    await expect(component.locator("img")).toHaveAttribute(
      "src",
      "https://mock-cdn.test/asset://diagrams/flow.png",
    );
  });

  test("type: audio renders (invisible element)", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "audio",
          file: "shared/chime.mp3",
        })}
      />,
    );
    // Audio renders null but the stage container exists
    await expect(component).toBeAttached();
  });

  test("type: timer renders countdown", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "timer",
          startTime: 0,
          endTime: 60,
        })}
      />,
    );
    await expect(component).toContainText("01:00");
  });

  test("type: display renders resolved values", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "display",
          reference: "self.prompt.answer",
        })}
        stateValues={{ "self.prompt.answer": "Hello from display" }}
      />,
    );
    await expect(component).toContainText("Hello from display");
  });

  test("type: trackedLink renders link", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "trackedLink",
          name: "testLink",
          url: "https://example.org",
          displayText: "Click here",
        })}
      />,
    );
    await expect(component).toContainText("Click here");
    await expect(component.locator("a")).toHaveAttribute(
      "href",
      "https://example.org",
    );
  });

  test("type: qualtrics renders iframe", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_test",
        })}
      />,
    );
    await expect(component.locator("iframe")).toBeVisible();
  });

  // Regression guard: Element must forward `urlParams` through to the
  // Qualtrics component. Prior versions of the sibling project
  // (deliberation-empirica#1240) regressed this silently because the
  // direct-mount Qualtrics tests bypassed the Element wrapper.
  test("type: qualtrics forwards urlParams (static + reference) to iframe URL", async ({
    mount,
  }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_test",
          urlParams: [
            { key: "condition", value: "topicA" },
            { key: "answer", reference: "self.prompt.myQ" },
          ],
        })}
        stateValues={{ "self.prompt.myQ": "yes" }}
      />,
    );
    const src = await component.locator("iframe").getAttribute("src");
    expect(src).toContain("condition=topicA");
    expect(src).toContain("answer=yes");
  });

  // Regression guard (#473): Element must source the standard Qualtrics
  // identifiers from the current participant's `attributes` — the anonymized
  // `stableParticipantId` and `sampleId` URL params — NOT the internal
  // `playerId`. Like the urlParams guard above, this exercises the Element
  // wrapper, not the leaf Qualtrics component.
  test("type: qualtrics sources stableParticipantId + sampleId from attributes", async ({
    mount,
  }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_test",
        })}
        stateValues={{
          "self.attributes.stableParticipantId": "stable-xyz",
          "self.attributes.sampleId": "row-9",
        }}
      />,
    );
    const src = await component.locator("iframe").getAttribute("src");
    expect(src).toContain("stableParticipantId=stable-xyz");
    expect(src).toContain("sampleId=row-9");
    // The internal playerId ("test-player-1") must never leak into the URL.
    expect(src).not.toContain("test-player-1");
  });

  test("type: qualtrics omits sampleId param when sampleId is unset (pre-game)", async ({
    mount,
  }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "qualtrics",
          url: "https://upenn.qualtrics.com/jfe/form/SV_test",
        })}
        stateValues={{
          "self.attributes.stableParticipantId": "stable-xyz",
        }}
      />,
    );
    const src = await component.locator("iframe").getAttribute("src");
    expect(src).toContain("stableParticipantId=stable-xyz");
    expect(src).not.toContain("sampleId=");
  });

  test("type: mediaPlayer renders a video element", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "mediaPlayer",
          name: "test_video",
          file: "https://example.com/video.mp4",
        })}
      />,
    );
    await expect(
      component.locator('[data-testid="mediaPlayer-video"]'),
    ).toBeAttached();
  });

  test("unknown type renders nothing (no crash)", async ({ mount }) => {
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "nonExistentType",
        })}
      />,
    );
    // Should not crash — renders the stage container with no content
    await expect(component).toBeAttached();
  });

  for (const failure of ["loading", "parsing"] as const) {
    test(`prompt ${failure} failure shows a shared alert with collapsed diagnostics`, async ({
      mount,
      page,
    }) => {
      const component = await mount(
        <MockStageRenderer
          stage={singleElementStage({
            type: "prompt",
            file: "test/question.md",
          })}
          promptError={
            failure === "loading" ? "Network unavailable" : undefined
          }
          promptContent={
            failure === "parsing"
              ? "---\ntype: invalidType\n---\nQuestion"
              : undefined
          }
        />,
      );
      const alert = component.getByRole("alert");
      await expect(alert).toHaveClass(/stagebook-error-callout/);
      await expect(alert).toContainText("This question couldn't load");
      const diagnostic = alert.getByText(`Error ${failure} prompt`, {
        exact: false,
      });
      await expect(diagnostic).toBeHidden();
      await page.keyboard.press("Tab");
      await expect(alert.locator("summary")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(diagnostic).toBeVisible();
      await expect(diagnostic).toContainText('"test/question.md"');
      await page.keyboard.press("Space");
      await expect(diagnostic).toBeHidden();
    });
  }
});
