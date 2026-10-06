import React, { useState } from "react";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Element } from "../Element.js";
import { ConditionsConditionalRender } from "../conditions/ConditionsConditionalRender.js";
import type { NumberFormat } from "../../messages/types.js";

const source =
  "---\ntype: numericResponse\nrequired: true\nmin: 18\nmax: 20\nprefix: '$'\nsuffix: 'per year'\n---\nYour estimate";
const getTextContent = () => Promise.resolve(source);

function NumericReferenceGates() {
  const context = useStagebookContext();
  const { readReference, onContractViolation, violationKeys } = context;
  return (
    <>
      <ConditionsConditionalRender
        readReference={readReference}
        onViolation={onContractViolation}
        violationKeys={violationKeys}
        conditions={{
          reference: "self.prompt.estimate",
          comparator: "isAtLeast",
          value: 18,
        }}
      >
        <Element
          element={{
            type: "submitButton",
            name: "atLeast",
            buttonText: "At least eighteen",
          }}
          onSubmit={() => {}}
        />
      </ConditionsConditionalRender>
      <ConditionsConditionalRender
        readReference={readReference}
        onViolation={onContractViolation}
        violationKeys={violationKeys}
        conditions={{
          reference: "self.prompt.estimate.isValid",
          comparator: "equals",
          value: true,
        }}
      >
        <Element
          element={{
            type: "submitButton",
            name: "valid",
            buttonText: "Valid answer",
          }}
          onSubmit={() => {}}
        />
      </ConditionsConditionalRender>
    </>
  );
}

/** Browser fixture uses the actual Element -> Prompt -> host store -> reference path. */
export function NumericPromptHarness({
  initialEntry,
  savedFormat,
  locale = "en",
  numberFormat,
}: {
  initialEntry?: string;
  savedFormat?: NumberFormat;
  locale?: string;
  numberFormat?: NumberFormat;
}) {
  const [records, setRecords] = useState<Record<string, unknown>>(
    initialEntry === undefined
      ? {}
      : { prompt_estimate: { entry: initialEntry, numberFormat: savedFormat } },
  );
  const [mountId, setMountId] = useState(0);
  const context: StagebookContext = {
    get: (key) => (key in records ? [records[key]] : []),
    save: (key, record) =>
      setRecords((previous) => ({ ...previous, [key]: record })),
    getElapsedTime: () => 12,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent,
    progressLabel: "numeric-browser",
    playerId: "participant",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
    locale,
    messages: numberFormat ? { numberFormat } : undefined,
  };
  return (
    <StagebookProvider value={context}>
      <Element
        key={mountId}
        element={{
          type: "prompt",
          file: "estimate.prompt.md",
          name: "estimate",
        }}
        onSubmit={() => {}}
      />
      <NumericReferenceGates />
      <button onClick={() => setMountId((previous) => previous + 1)}>
        Reload question
      </button>
      <pre data-testid="numeric-record">
        {JSON.stringify(records.prompt_estimate ?? null)}
      </pre>
    </StagebookProvider>
  );
}
