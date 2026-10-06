import React, { useState } from "react";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Prompt } from "../elements/Prompt.js";
import { ConditionsConditionalRender } from "../conditions/ConditionsConditionalRender.js";

const TECHNICAL_ERRORS =
  "This recording has technical errors that prevent analysis";

function Content() {
  const context = useStagebookContext();
  const record = context.get("prompt_errors")[0] as
    | { value?: unknown }
    | undefined;
  return (
    <div>
      <Prompt
        name="errors"
        metadata={{
          type: "multipleChoice",
          select: "multiple",
          layout: "vertical",
          body: "none",
        }}
        body=""
        responseItems={[TECHNICAL_ERRORS]}
        value={record?.value}
        save={(key, value, scope) => context.save(key, value, scope)}
      />
      {/* The annotation task's other questions, hidden once it's checked. */}
      <ConditionsConditionalRender
        conditions={{
          reference: "self.prompt.errors.value",
          comparator: "doesNotInclude",
          value: TECHNICAL_ERRORS,
        }}
        readReference={context.readReference}
        onViolation={context.onContractViolation}
        violationKeys={context.violationKeys}
      >
        <p data-testid="other-questions">Other questions</p>
      </ConditionsConditionalRender>
    </div>
  );
}

/** A `body: none` checkbox (#718) gating later content through the host store. */
export function BodylessCheckboxHarness() {
  const [records, setRecords] = useState<Record<string, unknown>>({});
  const context: StagebookContext = {
    get: (key) => (key in records ? [records[key]] : []),
    save: (key, record) =>
      setRecords((previous) => ({ ...previous, [key]: record })),
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "game_0_bodyless",
    playerId: "participant",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
  };
  return (
    <StagebookProvider value={context}>
      <Content />
      <output data-testid="saved">
        {JSON.stringify(
          (records.prompt_errors as { value?: unknown } | undefined)?.value ??
            null,
        )}
      </output>
    </StagebookProvider>
  );
}
