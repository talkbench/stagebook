/**
 * Harness for the MediaPlayer's event log (#682, #677, #676): a real
 * MediaPlayer, optionally with a Timeline attached, whose saves land in one
 * DOM log. The Submit button unmounts both elements while the log survives —
 * what a host does when the stage is submitted (SubmissionConditionalRender
 * swaps the stage's children out at submit time).
 */
import React, { useState } from "react";
import { MediaPlayer, type MediaPlayerProps } from "../elements/MediaPlayer.js";
import { Timeline } from "../elements/Timeline.js";
import { PlaybackProvider } from "../playback/PlaybackProvider.js";

export interface MockLoggedPlayerProps {
  url: string;
  startAt?: number;
  stopAt?: number;
  controls?: MediaPlayerProps["controls"];
  withTimeline?: boolean;
  elapsedTime?: number;
}

export function MockLoggedPlayer({
  url,
  startAt,
  stopAt,
  controls = { playPause: true, seek: true, speed: true },
  withTimeline = false,
  elapsedTime = 0,
}: MockLoggedPlayerProps) {
  const [saves, setSaves] = useState<Array<{ key: string; value: unknown }>>(
    [],
  );
  const [submitted, setSubmitted] = useState(false);
  const save = (key: string, value: unknown) =>
    setSaves((prev) => [...prev, { key, value }]);

  return (
    <PlaybackProvider>
      {!submitted && (
        <div style={{ width: 800 }}>
          <MediaPlayer
            name="clip"
            url={url}
            startAt={startAt}
            stopAt={stopAt}
            playback="manual"
            controls={controls}
            save={save}
            getElapsedTime={() => elapsedTime}
          />
          {withTimeline && (
            <Timeline
              source="clip"
              name="marks"
              selectionType="point"
              multiSelect
              showWaveform={false}
              save={save}
            />
          )}
        </div>
      )}
      <button
        type="button"
        data-testid="submit"
        onClick={() => setSubmitted(true)}
      >
        Submit
      </button>
      <div data-testid="save-log" style={{ display: "none" }}>
        {JSON.stringify(saves)}
      </div>
    </PlaybackProvider>
  );
}
