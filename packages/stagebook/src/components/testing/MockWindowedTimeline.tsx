/**
 * Integration harness for a Timeline whose source is a real MediaPlayer with
 * a `startAt`/`stopAt` window (#675). Unlike MockTimeline, the handle here is
 * the MediaPlayer's own, so seeks, duration and bounds come from the
 * component the Timeline is actually wired to in a study. Save calls from
 * both elements land in one DOM log.
 */
import React, { useState } from "react";
import { MediaPlayer } from "../elements/MediaPlayer.js";
import { Timeline } from "../elements/Timeline.js";
import { PlaybackProvider } from "../playback/PlaybackProvider.js";

export interface MockWindowedTimelineProps {
  url: string;
  startAt?: number;
  stopAt?: number;
  allowScrubOutsideBounds?: boolean;
  selectionType: "range" | "point";
  multiSelect?: boolean;
  width?: number;
}

export function MockWindowedTimeline({
  url,
  startAt,
  stopAt,
  allowScrubOutsideBounds,
  selectionType,
  multiSelect = true,
  width = 800,
}: MockWindowedTimelineProps) {
  const [saves, setSaves] = useState<Array<{ key: string; value: unknown }>>(
    [],
  );
  const save = (key: string, value: unknown) =>
    setSaves((prev) => [...prev, { key, value }]);

  return (
    <PlaybackProvider>
      <div style={{ width }}>
        <MediaPlayer
          name="clip"
          url={url}
          startAt={startAt}
          stopAt={stopAt}
          allowScrubOutsideBounds={allowScrubOutsideBounds}
          playback="manual"
          controls={{ playPause: true, seek: true, step: true }}
          save={save}
          getElapsedTime={() => 0}
        />
        <Timeline
          source="clip"
          name="marks"
          selectionType={selectionType}
          multiSelect={multiSelect}
          showWaveform={false}
          save={save}
        />
      </div>
      <div data-testid="save-log" style={{ display: "none" }}>
        {JSON.stringify(saves)}
      </div>
    </PlaybackProvider>
  );
}
