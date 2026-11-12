import type { TreatmentFileType } from "../../../schemas/index.js";
import { Viewer } from "../Viewer.js";

// The treatment from #837: a media player with a linked timeline.
const treatmentFile = {
  treatments: [
    {
      name: "Annotate",
      playerCount: 1,
      compatibleIntroSequences: [],
      gameStages: [
        {
          name: "Clip",
          duration: 600,
          elements: [
            {
              type: "mediaPlayer",
              file: "/audio-probe/participants_1ch.mp4",
              name: "v",
              playback: "manual",
              controls: { playPause: true, seek: true },
            },
            {
              type: "timeline",
              source: "v",
              name: "t",
              selectionType: "point",
            },
          ],
        },
        { name: "After", duration: 600, elements: [{ type: "separator" }] },
      ],
    },
  ],
} as unknown as TreatmentFileType;

const getTextContent = () => Promise.resolve("");
const getAssetURL = (path: string) => path;

export function TimelineViewer({
  channelCountWorkletUrl,
}: {
  channelCountWorkletUrl?: string;
}) {
  return (
    <Viewer
      treatmentFile={treatmentFile}
      getTextContent={getTextContent}
      getAssetURL={getAssetURL}
      selectedIntroIndex={0}
      selectedTreatmentIndex={0}
      channelCountWorkletUrl={channelCountWorkletUrl}
    />
  );
}
