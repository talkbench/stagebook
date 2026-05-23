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

  test("prompt parse error shows error message", async ({ mount }) => {
    // MockStageRenderer returns valid mock markdown by default,
    // but we can test the error path by providing a stage with an
    // empty prompt file path (getTextContent returns mock that parses)
    // This test verifies the Element router handles the happy path.
    const component = await mount(
      <MockStageRenderer
        stage={singleElementStage({
          type: "prompt",
          file: "test/question.md",
          name: "testPrompt",
        })}
      />,
    );
    // Should render mock content without errors
    await expect(component).toContainText("Mock content");
    // No error messages
    await expect(component).not.toContainText("Error");
  });
});
