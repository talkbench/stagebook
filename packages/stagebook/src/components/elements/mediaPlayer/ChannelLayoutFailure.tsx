import { useEffect, useRef } from "react";
import { ChannelLayoutError } from "../../../audioProbe/channelLayout.js";
import { ErrorCallout } from "../../ErrorCallout.js";
import { useMessages } from "../../StagebookProvider.js";
import { useRegisterPlayback } from "../../playback/PlaybackProvider.js";
import type { PlaybackHandle } from "../../playback/PlaybackHandle.js";

const refused: PlaybackHandle = {
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
  annotationError: true,
  getTransportCapabilities: () => ({ play: false, pause: false, seek: false }),
};

export function ChannelLayoutFailure({
  name,
  error,
  onError,
}: {
  name: string;
  error: ChannelLayoutError;
  onError?: (error: ChannelLayoutError) => void;
}) {
  const messages = useMessages();
  useRegisterPlayback(name, refused);
  const callback = useRef(onError);
  callback.current = onError;
  const currentError = useRef(error);
  currentError.current = error;
  const signature = JSON.stringify([name, error.diagnostics]);
  const reported = useRef<string | null>(null);
  useEffect(() => {
    if (reported.current === signature) return;
    reported.current = signature;
    console.error("[MediaPlayer]", currentError.current);
    try {
      callback.current?.(currentError.current);
    } catch (error) {
      console.error("[MediaPlayer] onChannelError callback failed", error);
    }
  }, [signature]);
  return (
    <ErrorCallout data-testid="mediaPlayer-channel-error">
      {messages.mediaChannelLayoutError}
    </ErrorCallout>
  );
}
