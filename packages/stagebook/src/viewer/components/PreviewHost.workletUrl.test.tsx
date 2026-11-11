// @vitest-environment jsdom
//
// #837: the VS Code preview and the viewer app both mount PreviewHost, and
// the worklet file's URL reaches the media player only if PreviewHost hands
// it to Viewer. Dropping it re-breaks every timeline under the webview's
// Content-Security-Policy.
import { beforeAll, expect, test, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { TreatmentFileType } from "../../schemas/index.js";
import type { ViewerProps } from "./Viewer.js";

const viewerProps: ViewerProps[] = [];
vi.mock("./Viewer.js", () => ({
  Viewer: (props: ViewerProps) => {
    viewerProps.push(props);
    return null;
  },
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const treatmentFile = {
  treatments: [
    {
      name: "study",
      playerCount: 1,
      compatibleIntroSequences: [],
      gameStages: [
        { name: "s1", duration: 60, elements: [{ type: "separator" }] },
      ],
    },
  ],
} as unknown as TreatmentFileType;

test("PreviewHost passes channelCountWorkletUrl on to Viewer", async () => {
  const { PreviewHost } = await import("./PreviewHost.js");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PreviewHost
        treatmentFile={treatmentFile}
        selectedIntroIndex={0}
        selectedTreatmentIndex={0}
        getTextContent={() => Promise.resolve("")}
        getAssetURL={(path) => path}
        channelCountWorkletUrl="/static/channel-count.js"
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(viewerProps.at(-1)?.channelCountWorkletUrl).toBe(
    "/static/channel-count.js",
  );
  act(() => root.unmount());
  container.remove();
});
