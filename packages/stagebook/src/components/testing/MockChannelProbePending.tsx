/**
 * Test wrapper: a group recording waiting for the channel probe (#841), with
 * a Timeline linked to it, as a participant sees them before the audio is
 * ready. Serializable props only, for Playwright CT.
 */
import { ChannelProbePending } from "../elements/mediaPlayer/ChannelProbePending.js";
import { Timeline } from "../elements/Timeline.js";
import { PlaybackProvider } from "../playback/PlaybackProvider.js";

export function MockChannelProbePending({ running }: { running?: boolean }) {
  return (
    <PlaybackProvider>
      <ChannelProbePending
        name="recording"
        running={running ?? false}
        onPrepare={() => {}}
      />
      <Timeline
        source="recording"
        name="marks"
        selectionType="point"
        save={() => {}}
      />
    </PlaybackProvider>
  );
}
