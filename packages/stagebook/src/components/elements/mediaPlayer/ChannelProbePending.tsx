import { useIsRTL, useMessages } from "../../StagebookProvider.js";
import { Button } from "../../form/Button.js";
import { useRegisterPlayback } from "../../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../../playback/PlaybackHandle.js";

// What a linked Timeline sees while the player waits: nothing to play, and
// speaker tracks still unknown, so it shows a notice and saves nothing.
const waiting: PlaybackHandle = {
  play() {},
  pause() {},
  seekTo() {},
  requestWaveformCapture() {},
  setChannelMuted() {},
  getCurrentTime: () => 0,
  getDuration: () => 0,
  isPaused: () => true,
  isChannelMuted: () => false,
  isYouTube: false,
  channelCount: 0,
  peaks: [],
  peaksVersion: 0,
  annotationPending: true,
  getTransportCapabilities: () => ({ play: false, pause: false, seek: false }),
};

/**
 * A group recording that needs this session's channel probe before it can
 * present speaker tracks (#841). The button's click is the user gesture the
 * probe needs; `onPrepare` must call the host's requestChannelProbe inside
 * it. If the host's own probe passes first, the player replaces this without
 * a click.
 */
export function ChannelProbePending({
  name,
  running,
  onPrepare,
}: {
  name: string;
  running: boolean;
  onPrepare: () => void;
}) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  useRegisterPlayback(name, waiting);
  return (
    <div
      data-testid="mediaPlayer-channel-probe"
      dir={isRTL ? "rtl" : "ltr"}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        padding: "1.5rem 1rem",
        border: "1px solid var(--stagebook-border, #d1d5db)",
        borderRadius: "0.5rem",
        backgroundColor: "var(--stagebook-surface, #fff)",
      }}
    >
      <p
        style={{
          margin: 0,
          textAlign: "center",
          color: "var(--stagebook-text-secondary, #374151)",
        }}
      >
        {messages.mediaChannelProbePrompt}
      </p>
      <Button primary disabled={running} onClick={onPrepare}>
        {messages.mediaChannelProbeButton}
      </Button>
      <p
        role="status"
        style={{
          margin: 0,
          minHeight: "1.25em",
          fontSize: "0.875rem",
          color: "var(--stagebook-text-muted, #626977)",
        }}
      >
        {running ? messages.mediaChannelProbeRunning : ""}
      </p>
    </div>
  );
}
