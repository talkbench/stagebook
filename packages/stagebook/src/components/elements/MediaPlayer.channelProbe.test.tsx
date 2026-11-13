// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPlayer } from "./MediaPlayer.js";
import { Timeline } from "./Timeline.js";
import { ChannelProbePending } from "./mediaPlayer/ChannelProbePending.js";
import { PlaybackProvider } from "../playback/PlaybackProvider.js";
import type { ChannelProbeResult } from "../../audioProbe/probe.js";
import type {
  ChannelLayoutError,
  ChannelMappingEntry,
} from "../../audioProbe/channelLayout.js";

// The player's wait for the channel probe (#841), with a probe the test
// settles by hand. Real probes and audio run in MediaPlayer.channels.ct.tsx.
vi.mock("./mediaPlayer/playbackGraph.js", () => ({
  buildPlaybackGraph: () => ({
    analysers: [
      { frequencyBinCount: 1, getByteTimeDomainData() {} },
      { frequencyBinCount: 1, getByteTimeDomainData() {} },
    ],
    gains: [{ gain: { value: 1 } }, { gain: { value: 1 } }],
  }),
}));
vi.mock("./mediaPlayer/channelCountMonitor.js", () => ({
  monitorChannelCount: () => Promise.resolve(() => {}),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DYAD: ChannelMappingEntry[] = [
  { index: 0, role: "participant", position: 0 },
  { index: 1, role: "participant", position: 5 },
];

const probe = (verdict: "pass" | "fail"): ChannelProbeResult => ({
  verdict,
  mappings: { 2: verdict === "pass" ? [0, 1] : null },
  detail: {},
  stagebookVersion: "test",
  elapsedMs: 1,
});

function deferred() {
  let resolve!: (r: ChannelProbeResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<ChannelProbeResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      createMediaElementSource = () => ({});
      resume = () => Promise.resolve();
      close = () => Promise.resolve();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("offline"))),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(props: {
  url?: string;
  mapping?: ChannelMappingEntry[];
  channelProbe?: ChannelProbeResult;
  requestChannelProbe?: () => Promise<ChannelProbeResult>;
  onChannelError?: (e: ChannelLayoutError) => void;
}) {
  act(() =>
    root.render(
      <MediaPlayer
        name="group"
        url={props.url ?? "https://example.com/room.mp4"}
        sourceId="room.mp4"
        channelMapping={props.mapping ?? DYAD}
        channelProbe={props.channelProbe}
        requestChannelProbe={props.requestChannelProbe}
        onChannelError={props.onChannelError}
        save={() => {}}
        getElapsedTime={() => 0}
        playback="manual"
      />,
    ),
  );
}

const $ = (testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`);
const prepareButton = () =>
  [...container.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Prepare audio"),
  );

async function clickPrepare() {
  const button = prepareButton();
  if (!button) throw new Error("No Prepare audio button");
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe("a group recording waiting for the channel probe", () => {
  it("disables the button and shows progress while the probe runs, and asks once", async () => {
    const pending = deferred();
    const request = vi.fn(() => pending.promise);
    render({ requestChannelProbe: request });
    await clickPrepare();
    expect(prepareButton()?.disabled).toBe(true);
    expect(container.textContent).toContain("Preparing audio…");
    act(() => prepareButton()?.click());
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(probe("pass"));
      await pending.promise;
    });
    expect($("mediaPlayer-channel-probe")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
  });

  it("plays from the probe it asked for, even if the host never passes it back", async () => {
    render({ requestChannelProbe: () => Promise.resolve(probe("pass")) });
    await clickPrepare();
    expect(container.querySelector("video")).not.toBeNull();
    expect($("mediaPlayer-channel-error")).toBeNull();
  });

  it("ends in the refusal when the request throws, with a probe diagnostic", async () => {
    const onChannelError = vi.fn();
    render({
      requestChannelProbe: () => {
        throw new Error("no probe");
      },
      onChannelError,
    });
    await clickPrepare();
    expect($("mediaPlayer-channel-error")).not.toBeNull();
    expect($("mediaPlayer-channel-probe")).toBeNull();
    const error = onChannelError.mock.calls[0][0] as ChannelLayoutError;
    expect(error.diagnostics.map((d) => d.code)).toEqual(["probe"]);
  });

  it("ends in the refusal when the request rejects", async () => {
    render({
      requestChannelProbe: () => Promise.reject(new Error("no probe")),
    });
    await clickPrepare();
    expect($("mediaPlayer-channel-error")).not.toBeNull();
  });

  it("gives a failed requested probe no second try, but a later host pass still wins", async () => {
    const request = vi.fn(() => Promise.resolve(probe("fail")));
    render({ requestChannelProbe: request });
    await clickPrepare();
    expect($("mediaPlayer-channel-error")).not.toBeNull();
    expect(prepareButton()).toBeUndefined();

    render({ requestChannelProbe: request, channelProbe: probe("pass") });
    expect($("mediaPlayer-channel-error")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("offers one try after the host's own probe failed", () => {
    render({
      channelProbe: probe("fail"),
      requestChannelProbe: () => Promise.resolve(probe("pass")),
    });
    expect($("mediaPlayer-channel-probe")).not.toBeNull();
  });

  it("is ready without a click once the host's probe passes", () => {
    const request = vi.fn(() => deferred().promise);
    render({ requestChannelProbe: request });
    expect($("mediaPlayer-channel-probe")).not.toBeNull();
    render({ requestChannelProbe: request, channelProbe: probe("pass") });
    expect($("mediaPlayer-channel-probe")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("only a missing probe waits", () => {
  it.each([
    ["a YouTube URL", { url: "https://www.youtube.com/watch?v=abc" }],
    [
      "an invalid mapping",
      {
        mapping: [
          { index: 0, role: "participant", position: 0 },
          { index: 1, role: "participant", position: 0 },
        ] as ChannelMappingEntry[],
      },
    ],
  ])("%s is refused without asking for a probe", (_name, props) => {
    const request = vi.fn(() => Promise.resolve(probe("pass")));
    render({ ...props, requestChannelProbe: request });
    expect($("mediaPlayer-channel-error")).not.toBeNull();
    expect($("mediaPlayer-channel-probe")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("without requestChannelProbe, a missing probe is refused as before", () => {
    render({});
    expect($("mediaPlayer-channel-error")).not.toBeNull();
    expect($("mediaPlayer-channel-probe")).toBeNull();
  });
});

describe("a Timeline linked to a waiting player", () => {
  it("shows a notice and saves nothing, keeping restored selections untouched", () => {
    const save = vi.fn();
    act(() =>
      root.render(
        <PlaybackProvider>
          <ChannelProbePending
            name="group"
            running={false}
            onPrepare={() => {}}
          />
          <Timeline
            source="group"
            name="marks"
            selectionType="point"
            selectionScope="track"
            initialSelections={[{ time: 1, position: 5 }]}
            save={save}
          />
        </PlaybackProvider>,
      ),
    );
    const notice = $("timeline-pending");
    expect(notice?.getAttribute("role")).toBe("status");
    expect($("timeline")).toBeNull();
    expect($("timeline-error")).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
