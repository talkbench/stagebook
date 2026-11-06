/**
 * Unit tests for YouTubePlayer.
 * These mock window.YT so no network access is needed.
 * Run with: npx vitest run src/components/elements/mediaPlayer/YouTubePlayer.test.ts
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PlaybackHandle } from "../../playback/PlaybackHandle.js";

// We test the loadYouTubeAPI helper and YouTubePlayer logic by mocking
// window.YT before import. Since loadYouTubeAPI is module-level state,
// we re-import for each suite via dynamic import after setting up the mock.

// Minimal mock YT player returned by new window.YT.Player(...)
function makeMockYTPlayer() {
  return {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 5),
    getDuration: vi.fn(() => 120),
    getPlayerState: vi.fn(() => 2 /* PAUSED */),
    destroy: vi.fn(),
  };
}

type MockYTPlayer = ReturnType<typeof makeMockYTPlayer>;

// Captures the event callbacks registered with YT.Player so tests can fire them
let capturedOnReady: (() => void) | null = null;
let capturedOnStateChange: ((e: { data: number }) => void) | null = null;
let capturedOnError: ((e: { data: number }) => void) | null = null;
let mockPlayer: MockYTPlayer;

function installYTMock() {
  mockPlayer = makeMockYTPlayer();
  capturedOnReady = null;
  capturedOnStateChange = null;
  capturedOnError = null;

  Object.assign(window, {
    YT: {
      PlayerState: {
        UNSTARTED: -1,
        ENDED: 0,
        PLAYING: 1,
        PAUSED: 2,
        BUFFERING: 3,
        CUED: 5,
      },
      Player: vi.fn(
        (
          _el: unknown,
          opts: {
            events?: {
              onReady?: () => void;
              onStateChange?: (e: { data: number }) => void;
              onError?: (e: { data: number }) => void;
            };
          },
        ) => {
          capturedOnReady = opts.events?.onReady ?? null;
          capturedOnStateChange = opts.events?.onStateChange ?? null;
          capturedOnError = opts.events?.onError ?? null;
          return mockPlayer;
        },
      ),
    },
  });
}

function fireReady() {
  capturedOnReady?.();
}

function fireStateChange(state: number) {
  capturedOnStateChange?.({ data: state });
}

// ── helpers to exercise the module under test ─────────────────────────────────

async function importModule() {
  // Dynamic import so each test can work with a fresh module cache in vitest
  const mod = await import("./YouTubePlayer.js");
  return mod;
}

// ─────────────────────────────────────────────────────────────────────────────
// loadYouTubeAPI
// ─────────────────────────────────────────────────────────────────────────────

describe("loadYouTubeAPI", () => {
  beforeEach(() => {
    installYTMock();
  });

  it("resolves immediately when window.YT.Player already exists", async () => {
    const { loadYouTubeAPI } = await importModule();
    await expect(loadYouTubeAPI()).resolves.toBeUndefined();
  });

  it("does not inject a script tag when YT is already present", async () => {
    const appendSpy = vi.spyOn(document.head, "appendChild");
    const { loadYouTubeAPI } = await importModule();
    await loadYouTubeAPI();
    expect(appendSpy).not.toHaveBeenCalled();
    appendSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildYouTubeHandle (the PlaybackHandle factory exposed for testing)
// ─────────────────────────────────────────────────────────────────────────────

describe("buildYouTubeHandle", () => {
  let handle: PlaybackHandle;

  beforeEach(async () => {
    installYTMock();
    const { buildYouTubeHandle } = await importModule();
    handle = buildYouTubeHandle(mockPlayer as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("play() calls player.playVideo()", () => {
    handle.play();
    expect(mockPlayer.playVideo).toHaveBeenCalledOnce();
  });

  it("pause() calls player.pauseVideo()", () => {
    handle.pause();
    expect(mockPlayer.pauseVideo).toHaveBeenCalledOnce();
  });

  it("seekTo(30) calls player.seekTo(30, true)", () => {
    handle.seekTo(30);
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(30, true);
  });

  it("getCurrentTime() returns player.getCurrentTime()", () => {
    mockPlayer.getCurrentTime.mockReturnValue(42);
    expect(handle.getCurrentTime()).toBe(42);
  });

  it("getDuration() returns player.getDuration()", () => {
    mockPlayer.getDuration.mockReturnValue(180);
    expect(handle.getDuration()).toBe(180);
  });

  it("isPaused() returns true when state is PAUSED (2)", () => {
    mockPlayer.getPlayerState.mockReturnValue(2);
    expect(handle.isPaused()).toBe(true);
  });

  it("isPaused() returns false when state is PLAYING (1)", () => {
    mockPlayer.getPlayerState.mockReturnValue(1);
    expect(handle.isPaused()).toBe(false);
  });

  it("isYouTube is true", () => {
    expect(handle.isYouTube).toBe(true);
  });

  it("reports unknown audio state when an older handle lacks the getters", () => {
    expect(handle.getAudioState?.()).toEqual({ muted: null, volume: null });
  });

  it("reads and normalizes audio state without changing the player's settings", async () => {
    const { buildYouTubeHandle } = await importModule();
    const player = {
      ...mockPlayer,
      isMuted: vi.fn(() => true),
      getVolume: vi.fn(() => 35),
      mute: vi.fn(),
      unMute: vi.fn(),
      setVolume: vi.fn(),
    };
    const audioHandle = buildYouTubeHandle(player);
    expect(audioHandle.getAudioState?.()).toEqual({
      muted: true,
      volume: 0.35,
    });
    player.isMuted.mockReturnValue(false);
    player.getVolume.mockReturnValue(0);
    expect(audioHandle.getAudioState?.()).toEqual({ muted: false, volume: 0 });
    player.getVolume.mockReturnValue(100);
    expect(audioHandle.getAudioState?.()).toEqual({ muted: false, volume: 1 });
    expect(player.mute).not.toHaveBeenCalled();
    expect(player.unMute).not.toHaveBeenCalled();
    expect(player.setVolume).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, 101])(
    "does not invent a volume from invalid API value %s",
    async (volume) => {
      const { buildYouTubeHandle } = await importModule();
      const audioHandle = buildYouTubeHandle({
        ...mockPlayer,
        isMuted: () => false,
        getVolume: () => volume,
      });
      expect(audioHandle.getAudioState?.()).toEqual({
        muted: false,
        volume: null,
      });
    },
  );

  it("reports each unavailable audio field independently", async () => {
    const { buildYouTubeHandle } = await importModule();
    const audioHandle = buildYouTubeHandle({
      ...mockPlayer,
      getVolume: () => 25,
    });
    expect(audioHandle.getAudioState?.()).toEqual({
      muted: null,
      volume: 0.25,
    });
    const destroyedHandle = buildYouTubeHandle({
      ...mockPlayer,
      isMuted: () => {
        throw new Error("destroyed player");
      },
      getVolume: () => 50,
    });
    expect(destroyedHandle.getAudioState?.()).toEqual({
      muted: null,
      volume: 0.5,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createYouTubePlayer (integration: creates YT.Player, fires callbacks)
// ─────────────────────────────────────────────────────────────────────────────

describe("createYouTubePlayer", () => {
  beforeEach(() => {
    installYTMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onHandleReady with a PlaybackHandle after onReady fires", async () => {
    const { createYouTubePlayer } = await importModule();
    const onHandleReady = vi.fn();
    const container = document.createElement("div");

    createYouTubePlayer({
      container,
      videoId: "abc123",
      onHandleReady,
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onEnded: vi.fn(),
    });

    expect(onHandleReady).not.toHaveBeenCalled();
    fireReady();
    expect(onHandleReady).toHaveBeenCalledOnce();
    expect(onHandleReady.mock.calls[0][0]).toMatchObject({ isYouTube: true });
  });

  it("calls onPlay when state changes to PLAYING (1)", async () => {
    const { createYouTubePlayer } = await importModule();
    const onPlay = vi.fn();
    const container = document.createElement("div");

    createYouTubePlayer({
      container,
      videoId: "abc123",
      onHandleReady: vi.fn(),
      onPlay,
      onPause: vi.fn(),
      onEnded: vi.fn(),
    });

    fireReady();
    mockPlayer.getCurrentTime.mockReturnValue(7);
    fireStateChange(1 /* PLAYING */);
    expect(onPlay).toHaveBeenCalledWith(7);
  });

  it("calls onPause when state changes to PAUSED (2)", async () => {
    const { createYouTubePlayer } = await importModule();
    const onPause = vi.fn();
    const container = document.createElement("div");

    createYouTubePlayer({
      container,
      videoId: "abc123",
      onHandleReady: vi.fn(),
      onPlay: vi.fn(),
      onPause,
      onEnded: vi.fn(),
    });

    fireReady();
    mockPlayer.getCurrentTime.mockReturnValue(12);
    fireStateChange(2 /* PAUSED */);
    expect(onPause).toHaveBeenCalledWith(12);
  });

  it("calls onEnded when state changes to ENDED (0)", async () => {
    const { createYouTubePlayer } = await importModule();
    const onEnded = vi.fn();
    const container = document.createElement("div");

    createYouTubePlayer({
      container,
      videoId: "abc123",
      onHandleReady: vi.fn(),
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onEnded,
    });

    fireReady();
    mockPlayer.getCurrentTime.mockReturnValue(120);
    fireStateChange(0 /* ENDED */);
    expect(onEnded).toHaveBeenCalledWith(120);
  });

  it.each([3, -1, 5])(
    "reports inactive state %s without pause or querying the playhead",
    async (state) => {
      const { createYouTubePlayer } = await importModule();
      const onPlaybackInactive = vi.fn();
      const onPause = vi.fn();
      const { destroy } = createYouTubePlayer({
        container: document.createElement("div"),
        videoId: "abc123",
        onHandleReady: vi.fn(),
        onPlay: vi.fn(),
        onPause,
        onEnded: vi.fn(),
        onPlaybackInactive,
      });
      fireReady();
      mockPlayer.getCurrentTime.mockImplementation(() => {
        throw new Error("unavailable position");
      });
      fireStateChange(state);
      expect(onPlaybackInactive).toHaveBeenCalledOnce();
      expect(onPause).not.toHaveBeenCalled();
      destroy();
      fireStateChange(state);
      expect(onPlaybackInactive).toHaveBeenCalledTimes(1);
    },
  );

  it("reports an error as inactive even when the backend cannot report its playhead", async () => {
    const { createYouTubePlayer } = await importModule();
    const onPlaybackInactive = vi.fn();
    const onPause = vi.fn();
    const onEnded = vi.fn();
    const { destroy } = createYouTubePlayer({
      container: document.createElement("div"),
      videoId: "abc123",
      onHandleReady: vi.fn(),
      onPlay: vi.fn(),
      onPause,
      onEnded,
      onPlaybackInactive,
    });
    fireReady();
    mockPlayer.getCurrentTime.mockImplementation(() => {
      throw new Error("failed backend");
    });
    capturedOnError?.({ data: 100 });
    expect(onPlaybackInactive).toHaveBeenCalledOnce();
    expect(onPause).not.toHaveBeenCalled();
    expect(onEnded).not.toHaveBeenCalled();
    destroy();
    capturedOnError?.({ data: 100 });
    expect(onPlaybackInactive).toHaveBeenCalledTimes(1);
  });

  it("passes startAt to YT.Player playerVars", async () => {
    const { createYouTubePlayer } = await importModule();
    const container = document.createElement("div");

    createYouTubePlayer({
      container,
      videoId: "abc123",
      startAt: 45,
      onHandleReady: vi.fn(),
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onEnded: vi.fn(),
    });

    const ctor = (
      window as unknown as { YT: { Player: ReturnType<typeof vi.fn> } }
    ).YT.Player;
    const opts = ctor.mock.calls[0][1] as { playerVars?: { start?: number } };
    expect(opts.playerVars?.start).toBe(45);
  });

  it("returns a destroy function that calls player.destroy()", async () => {
    const { createYouTubePlayer } = await importModule();
    const container = document.createElement("div");

    const { destroy } = createYouTubePlayer({
      container,
      videoId: "abc123",
      onHandleReady: vi.fn(),
      onPlay: vi.fn(),
      onPause: vi.fn(),
      onEnded: vi.fn(),
    });

    fireReady();
    destroy();
    expect(mockPlayer.destroy).toHaveBeenCalledOnce();
  });
});
