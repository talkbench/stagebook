import React, { useState } from "react";
import {
  StagebookProvider,
  useStagebookContext,
  type StagebookContext,
} from "../StagebookProvider.js";
import { Prompt } from "../elements/Prompt.js";
import { SubmitButton } from "../elements/SubmitButton.js";
import {
  ConditionsConditionalRender,
  type ConditionNode,
} from "../conditions/ConditionsConditionalRender.js";

export interface PromptValidityHarnessProps {
  kind?: "text" | "checkbox";
  required?: boolean;
  hidden?: boolean;
  two?: boolean;
  operator?: "all" | "any";
  locale?: string;
}

function Content({
  kind = "text",
  required = false,
  hidden = false,
  two = false,
  operator = "all",
}: PromptValidityHarnessProps) {
  const context = useStagebookContext();
  const { readReference, onContractViolation, violationKeys } = context;
  const save = (key: string, record: unknown, scope?: "player" | "shared") =>
    context.save(key, record, scope);
  const names = two ? ["first", "second"] : ["first"];
  const answered = (name: string): ConditionNode => ({
    reference: `self.prompt.${name}.isValid`,
    comparator: "equals",
    value: true,
  });
  const optional = (name: string): ConditionNode => ({
    any: [
      { reference: `self.prompt.${name}.isValid`, comparator: "doesNotExist" },
      answered(name),
    ],
  });
  return (
    <div>
      {names.map((name) => (
        <ConditionsConditionalRender
          key={name}
          conditions={
            hidden
              ? {
                  reference: "self.prompt.show.value",
                  comparator: "equals",
                  value: true,
                }
              : undefined
          }
          readReference={readReference}
          onViolation={onContractViolation}
          violationKeys={violationKeys}
        >
          <section data-testid={name}>
            <Prompt
              name={name}
              metadata={
                kind === "text"
                  ? { name, type: "openResponse", minLength: 3, required }
                  : {
                      name,
                      type: "multipleChoice",
                      select: "multiple",
                      required,
                    }
              }
              body={`Question ${name}`}
              responseItems={kind === "text" ? [] : ["Alpha", "Beta"]}
              value={
                (
                  context.get(`prompt_${name}`)[0] as
                    | { value?: unknown }
                    | undefined
                )?.value
              }
              save={save}
            />
          </section>
        </ConditionsConditionalRender>
      ))}
      <ConditionsConditionalRender
        conditions={{ [operator]: names.map(answered) } as ConditionNode}
        readReference={readReference}
        onViolation={onContractViolation}
        violationKeys={violationKeys}
      >
        <SubmitButton
          name="answered"
          buttonText="Answered and valid"
          save={save}
          onSubmit={() => context.submit()}
        />
      </ConditionsConditionalRender>
      <ConditionsConditionalRender
        conditions={{ [operator]: names.map(optional) } as ConditionNode}
        readReference={readReference}
        onViolation={onContractViolation}
        violationKeys={violationKeys}
      >
        <SubmitButton
          name="optional"
          buttonText="Optional valid"
          save={save}
          onSubmit={() => context.submit()}
        />
      </ConditionsConditionalRender>
    </div>
  );
}

/** Saves actual Prompt records into the host store; the provider resolves every gate. */
export function PromptValidityHarness(props: PromptValidityHarnessProps) {
  const [records, setRecords] = useState<Record<string, unknown>>({});
  const context: StagebookContext = {
    get: (key) => (key in records ? [records[key]] : []),
    save: (key, record) =>
      setRecords((previous) => ({ ...previous, [key]: record })),
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (path) => path,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "game_0_validation",
    playerId: "participant",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
    locale: props.locale,
  };
  return (
    <StagebookProvider value={context}>
      <Content {...props} />
    </StagebookProvider>
  );
}
