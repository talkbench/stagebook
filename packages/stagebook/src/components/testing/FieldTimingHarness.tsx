import React, { useState } from "react";
import { Prompt } from "../elements/Prompt.js";

/** Exercises conditional field mounting and the actual Prompt save boundary. */
export function FieldTimingHarness({
  kind,
  shown,
  stageTime,
  onClockRead,
}: {
  kind: "openResponse" | "numericResponse";
  shown: boolean;
  stageTime: number;
  onClockRead: (time: number) => void;
}) {
  const [records, setRecords] = useState<unknown[]>([]);
  return (
    <div>
      <button>Before field</button>
      {shown && (
        <Prompt
          metadata={{ type: kind, name: "answer" }}
          body="Your answer"
          responseItems={[]}
          name="answer"
          value={undefined}
          getElapsedTime={() => {
            onClockRead(stageTime);
            return stageTime;
          }}
          save={(_key, record) =>
            setRecords((previous) => [...previous, record])
          }
        />
      )}
      <output data-testid="saved-records">{JSON.stringify(records)}</output>
    </div>
  );
}
