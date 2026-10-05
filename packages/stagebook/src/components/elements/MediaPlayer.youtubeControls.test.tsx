// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MediaPlayer, type MediaPlayerProps } from "./MediaPlayer.js";

// YouTube's own controls bypass the event log, so they come off whenever
// the study gives the participant stagebook's controls (#699). Runs against
// a stub window.YT that records the options each player is created with.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type PlayerVars = Record<string, unknown>;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let created: PlayerVars[] = [];

beforeEach(() => {
  created = [];
  const w = window as unknown as { YT?: unknown };
  w.YT = {
    Player: function (_el: unknown, opts: { playerVars?: PlayerVars }) {
      created.push(opts.playerVars ?? {});
      return {
        playVideo: () => {},
        pauseVideo: () => {},
        seekTo: () => {},
        getCurrentTime: () => 0,
        getDuration: () => 100,
        getPlayerState: () => 2,
        destroy: () => {},
      };
    },
  };
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  delete (window as unknown as { YT?: unknown }).YT;
});

function render(props: Partial<MediaPlayerProps>) {
  act(() =>
    root!.render(
      <MediaPlayer
        name="clip"
        url="https://youtu.be/QC8iQqtG0hg"
        save={() => {}}
        getElapsedTime={() => 0}
        {...props}
      />,
    ),
  );
}

function mount(props: Partial<MediaPlayerProps>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render(props);
}

function playerVars(): PlayerVars {
  expect(created).toHaveLength(1);
  return created[0];
}

const UNCHANGED = { enablejsapi: 1, modestbranding: 1, rel: 0 };

describe("YouTube native controls (#699)", () => {
  it("turns YouTube's controls and keyboard off when stagebook controls are on", () => {
    mount({ playback: "manual", controls: { playPause: true, seek: true } });
    expect(playerVars()).toEqual({ ...UNCHANGED, controls: 0, disablekb: 1 });
  });

  it("turns them off for any stagebook control, not only play/pause and seek", () => {
    mount({ controls: { step: true } });
    expect(playerVars()).toEqual({ ...UNCHANGED, controls: 0, disablekb: 1 });
  });

  it("leaves the player variables unchanged in play-once mode", () => {
    mount({});
    expect(playerVars()).toEqual(UNCHANGED);
  });

  it("leaves them unchanged when every configured control is off", () => {
    mount({ playback: "manual", controls: { playPause: false } });
    expect(playerVars()).toEqual(UNCHANGED);
  });

  it("leaves them unchanged when playback follows stage time, even with controls", () => {
    // Stage-time sync suppresses stagebook's controls, so YouTube's stay.
    mount({ syncToStageTime: true, startAt: 5, controls: { playPause: true } });
    expect(playerVars()).toEqual({ start: 5, ...UNCHANGED });
  });

  it("re-creates the player when stagebook's controls are turned on after mount", () => {
    // The flag is a creation option, so a change rebuilds the player rather
    // than leaving YouTube's controls out of step with stagebook's.
    mount({ playback: "manual" });
    render({ playback: "manual", controls: { playPause: true } });
    expect(created).toEqual([
      UNCHANGED,
      { ...UNCHANGED, controls: 0, disablekb: 1 },
    ]);
  });
});
