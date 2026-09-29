import React, { useEffect, useState, useCallback, useRef, useId } from "react";
import { Markdown } from "../form/Markdown.js";
import { RadioGroup } from "../form/RadioGroup.js";
import { CheckboxGroup } from "../form/CheckboxGroup.js";
import { Select } from "../form/Select.js";
import { NumericInput } from "../form/NumericInput.js";
import { ErrorCallout } from "../ErrorCallout.js";
import type { NumberFormat } from "../../messages/types.js";
import {
  filterNumericInsertion,
  numericInputMode,
} from "../../utils/numericResponse.js";
import { getNumericFeedback } from "../../utils/numericFeedback.js";
import { TextArea } from "../form/TextArea.js";
import type { DebugMessage } from "../../utils/promptTelemetry.js";
import { useResponseCommit } from "../hooks/useResponseCommit.js";
import { buildPromptRecord } from "../../utils/buildPromptRecord.js";
import { Slider } from "../form/Slider.js";
import { ListSorter } from "../form/ListSorter.js";
import {
  useMessages,
  useIsRTL,
  type StagebookContext,
} from "../StagebookProvider.js";
import type { MetadataType } from "../../schemas/promptFile.js";

function setEquality(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  return Array.from(a).every((item) => b.has(item));
}

export interface PromptProps {
  metadata: MetadataType;
  body: string;
  responseItems: string[];
  /**
   * Numeric per-option values parsed from the body section, aligned i-th
   * with `responseItems` (labels). Populated for sliders (always) and for
   * multipleChoice prompts in numeric mode (#282). Empty for text-only
   * multipleChoice, listSorter, and openResponse.
   */
  responsePoints?: number[];
  /**
   * Deprecated alias for `responsePoints`, kept for backward compatibility
   * with consumers that referenced this field name pre-#282. Identical to
   * `responsePoints` for slider prompts.
   * @deprecated
   */
  sliderPoints?: number[];
  name: string;
  file?: string;
  shared?: boolean;
  value: unknown;
  /** Numeric responses restore raw text and its parsing format verbatim. */
  entry?: string;
  numberFormat?: NumberFormat;
  save: (key: string, value: unknown, scope?: "player" | "shared") => void;
  /** Commit-time record context, provided by Element or a standalone host. */
  step?: string;
  getElapsedTime?: () => number;
  /** Cancellation identity only; never added to the saved record. */
  stageId?: string;
  resolveURL?: (path: string) => string;
  renderSharedNotepad?: StagebookContext["renderSharedNotepad"];
  renderSharedNumericResponse?: StagebookContext["renderSharedNumericResponse"];
  onContractViolation?: StagebookContext["onContractViolation"];
}

export function Prompt(props: PromptProps) {
  // A host may reuse the same mounted element for another stage or prompt.
  // Reset the complete instrument lifetime, including timers and telemetry.
  return (
    <PromptContent
      key={JSON.stringify([
        props.name,
        props.file,
        props.stageId ?? props.step,
      ])}
      {...props}
    />
  );
}

function PromptContent({
  metadata,
  body,
  responseItems,
  responsePoints,
  sliderPoints,
  name,
  file,
  shared = false,
  value,
  entry,
  numberFormat,
  save,
  step,
  getElapsedTime,
  resolveURL,
  renderSharedNotepad,
  renderSharedNumericResponse,
  onContractViolation,
}: PromptProps) {
  // Prefer `responsePoints` (#282 canonical name); fall back to the
  // deprecated `sliderPoints` alias if a caller still uses it.
  const numericPoints = responsePoints ?? sliderPoints;
  const hasNumericPoints =
    numericPoints !== undefined && numericPoints.length > 0;
  // `shuffleOrder[i]` is the original index of the option at display
  // position `i`. We track *one* shuffle order and derive both labels and
  // numeric points from it, so a shuffled label always stays paired with
  // its corresponding numeric value (#282 — without this, a shuffled
  // numeric multipleChoice records the wrong number for the chosen label).
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  // TextArea emits blur telemetry and the response in one event. Read the
  // ref at commit time, without waiting for a React state update.
  const debugMessagesRef = useRef<DebugMessage[]>([]);

  // Stable id for the wrapper around the rendered prompt body. The
  // dropdown's `<select>` points its `aria-labelledby` here so the
  // control is named by the question the participant reads, rather
  // than shipping a duplicate visible label (#545). `useId()` keeps
  // it unique when multiple Prompts share a page.
  const bodyId = useId();
  const requiredId = useId();
  const messages = useMessages();
  const isRTL = useIsRTL();

  const promptType = metadata.type;
  const required = "required" in metadata && metadata.required === true;
  // Per-type fields only exist on the discriminated-union branch where
  // they were declared (#243). Safely-narrowed lookups via the type tag.
  const rows = promptType === "openResponse" ? (metadata.rows ?? 5) : 5;
  const minLength =
    promptType === "openResponse" ? metadata.minLength : undefined;
  const maxLength =
    promptType === "openResponse" ? metadata.maxLength : undefined;
  // `shuffle` (renamed from `shuffleOptions` in #243) lives on
  // multipleChoice, dropdown, and listSorter. Sliders never shuffle —
  // points and labels share an i'th-position alignment that scrambling
  // would break.
  const shouldShuffle =
    (promptType === "multipleChoice" ||
      promptType === "dropdown" ||
      promptType === "listSorter") &&
    metadata.shuffle === true;

  // Initialize shuffleOrder when responseItems first arrives or changes
  // length. Reshuffles only when the option set itself changes — the
  // setEquality guard prevents a re-shuffle on every render.
  if (
    promptType !== "noResponse" &&
    responseItems.length > 0 &&
    (shuffleOrder.length !== responseItems.length ||
      !setEquality(
        new Set(responseItems),
        new Set(shuffleOrder.map((i) => responseItems[i] ?? "")),
      ))
  ) {
    const indices = Array.from({ length: responseItems.length }, (_, i) => i);
    if (shouldShuffle) {
      indices.sort(() => 0.5 - Math.random());
    }
    setShuffleOrder(indices);
  }

  // Apply the shuffle to both labels and (when present) numeric points so
  // they stay aligned at every display position.
  const responses =
    shuffleOrder.length === responseItems.length
      ? shuffleOrder.map((i) => responseItems[i] ?? "")
      : responseItems;
  const shuffledNumericPoints =
    numericPoints && shuffleOrder.length === numericPoints.length
      ? shuffleOrder.map((i) => numericPoints[i] ?? 0)
      : numericPoints;

  const record = {
    metadata,
    name,
    file,
    shared,
    body,
    responses,
  };

  // Track whether we've auto-saved the dropdown default for this
  // mount. Without this, the visual state ("Option A is shown
  // selected because that's the browser default for an uncontrolled
  // <select>") would diverge from the saved state ("nothing — the
  // participant didn't interact"). Only fires when no placeholder is
  // configured (with a placeholder, the dropdown intentionally shows
  // "Pick one…" and the participant must explicitly choose).
  const dropdownDefaultSavedRef = useRef(false);

  const saveData = useCallback(
    (
      newValue: unknown,
      recordData: typeof record,
      label?: string,
      format?: NumberFormat,
    ) => {
      const updatedRecord = buildPromptRecord({
        ...recordData,
        value: newValue,
        ...(recordData.metadata.type === "numericResponse"
          ? { entry: newValue as string, numberFormat: format }
          : {}),
        debugMessages: debugMessagesRef.current,
        label,
        step,
        stageTimeElapsed: getElapsedTime?.(),
      });
      const scope = shared ? "shared" : "player";
      save(`prompt_${recordData.name}`, updatedRecord, scope);
    },
    [shared, save, step, getElapsedTime],
  );

  // Auto-save the dropdown's first option as the participant's
  // default when no placeholder is configured and there's no prior
  // saved value. The browser visually selects the first <option> by
  // default — this keeps the saved data aligned with what the
  // participant sees, so a prompt that "looks answered" is in fact
  // recorded as answered. With a placeholder, the dropdown shows
  // "Pick one…" and the participant must explicitly choose, so no
  // auto-save.
  //
  // The ref guard means the save happens at most once per mount even
  // though the effect re-runs on prop changes — so dependency churn
  // from `record`/`responses` being recomputed each render is fine.
  const firstOption = responses[0];
  // `metadata.placeholder` only exists on the dropdown branch of
  // the discriminated union; narrow explicitly so TypeScript
  // doesn't widen to `unknown` here.
  const placeholderConfigured: string | undefined =
    metadata.type === "dropdown" ? metadata.placeholder : undefined;
  useEffect(() => {
    if (
      promptType !== "dropdown" ||
      placeholderConfigured !== undefined ||
      value !== undefined ||
      firstOption === undefined ||
      firstOption.length === 0 ||
      dropdownDefaultSavedRef.current
    ) {
      return;
    }
    dropdownDefaultSavedRef.current = true;
    saveData(firstOption, record, firstOption);
  }, [promptType, placeholderConfigured, value, firstOption, record, saveData]);

  return (
    <>
      <div id={bodyId}>
        <Markdown text={body} resolveURL={resolveURL} />
      </div>

      {required && (
        <div
          id={requiredId}
          data-testid="required-marker"
          dir={isRTL ? "rtl" : "ltr"}
          style={{
            color: "var(--stagebook-text-muted, #626977)",
            fontSize: "0.75rem",
            textAlign: "start",
            marginBottom: "0.25rem",
          }}
        >
          {messages.promptRequired}
        </div>
      )}

      {promptType === "multipleChoice" &&
        (metadata.select === "single" || metadata.select === undefined) &&
        // In numeric mode (#282) the option key is the stringified number;
        // the saved value is the number (parsed back from the key) and the
        // label is the displayed text. In text mode value === label.
        (hasNumericPoints && shuffledNumericPoints ? (
          <RadioGroup
            options={responses.map((label, idx) => ({
              key: String(shuffledNumericPoints[idx]),
              value: label,
            }))}
            value={typeof value === "number" ? String(value) : undefined}
            layout={metadata.layout}
            ariaLabelledBy={bodyId}
            ariaRequired={required || undefined}
            onChange={(e) => {
              const idx = shuffledNumericPoints.findIndex(
                (p) => String(p) === e.target.value,
              );
              const numericValue = shuffledNumericPoints[idx];
              const label = responses[idx] ?? "";
              saveData(numericValue, record, label);
            }}
          />
        ) : (
          <RadioGroup
            options={responses.map((choice) => ({
              key: choice,
              value: choice,
            }))}
            value={value as string | undefined}
            layout={metadata.layout}
            ariaLabelledBy={bodyId}
            ariaRequired={required || undefined}
            onChange={(e) =>
              // Text mode: label === value.
              saveData(e.target.value, record, e.target.value)
            }
          />
        ))}

      {promptType === "multipleChoice" && metadata.select === "multiple" && (
        <CheckboxGroup
          options={responses.map((choice) => ({
            key: choice,
            value: choice,
          }))}
          value={(value as string[]) ?? []}
          layout={metadata.layout}
          ariaLabelledBy={bodyId}
          ariaDescribedBy={required ? requiredId : undefined}
          onChange={(newSelection) => saveData(newSelection, record)}
        />
      )}

      {promptType === "dropdown" && (
        // Same single-select semantics as multipleChoice text mode —
        // saved value is the chosen option's text — but rendered as a
        // compact `<select>` for long option lists. Numeric mode (#282)
        // is intentionally not supported here; if a researcher needs
        // numeric values they should use multipleChoice + numeric
        // labels (which gives them the radio UI that pairs naturally
        // with point-anchored Likert scales).
        <div style={{ marginTop: "1rem" }}>
          {/* Preserve study-prompt spacing here; standalone Select lets
              its host own the surrounding layout (#605). */}
          <Select
            options={responses.map((choice) => ({
              key: choice,
              value: choice,
            }))}
            value={value as string | undefined}
            placeholder={metadata.placeholder}
            // Name the <select> by the visible prompt body so it isn't an
            // unnamed control (axe `select-name`, WCAG 4.1.2 / 1.3.1) — see
            // #545. Preferred over a visible `label`, which would duplicate
            // the body the participant already reads.
            ariaLabelledBy={bodyId}
            ariaRequired={required || undefined}
            onChange={(e) => saveData(e.target.value, record, e.target.value)}
          />
        </div>
      )}

      {promptType === "openResponse" && !shared && (
        <TextArea
          defaultText={responses.join("\n")}
          debounceDelay={2000}
          maxWait={5000}
          onChange={(val) => saveData(val, record)}
          onDebugMessage={(message) => {
            debugMessagesRef.current = [...debugMessagesRef.current, message];
          }}
          value={value as string | undefined}
          rows={rows}
          showCharacterCount={!!(minLength || maxLength)}
          minLength={minLength}
          maxLength={maxLength}
          ariaLabelledBy={bodyId}
          ariaRequired={required || undefined}
        />
      )}

      {promptType === "openResponse" && shared && renderSharedNotepad && (
        <SharedNotepadResponse
          padName={name}
          defaultText={responses.join("\n")}
          rows={rows}
          renderSharedNotepad={renderSharedNotepad}
          onCommit={(text) => saveData(text, record)}
        />
      )}

      {promptType === "numericResponse" && !shared && (
        <NumericInput
          entry={entry}
          numberFormat={numberFormat}
          nextEditNumberFormat={messages.numberFormat}
          constraints={metadata}
          prefix={metadata.prefix}
          suffix={metadata.suffix}
          ariaLabelledBy={bodyId}
          ariaRequired={required || undefined}
          onChange={(text, format) => saveData(text, record, undefined, format)}
          onDebugMessage={(message) => {
            debugMessagesRef.current = [...debugMessagesRef.current, message];
          }}
        />
      )}

      {promptType === "numericResponse" &&
        shared &&
        (renderSharedNumericResponse ? (
          <SharedResponse
            onCommit={(text) =>
              saveData(
                text,
                record,
                undefined,
                numberFormat ?? messages.numberFormat,
              )
            }
          >
            {(callbacks) =>
              renderSharedNumericResponse({
                name,
                constraints: {
                  required: metadata.required,
                  min: metadata.min,
                  max: metadata.max,
                  integer: metadata.integer,
                },
                prefix: metadata.prefix,
                suffix: metadata.suffix,
                required,
                numberFormat: numberFormat ?? messages.numberFormat,
                inputmode: numericInputMode(metadata),
                ariaLabelledBy: bodyId,
                filterInsertion: (change) =>
                  filterNumericInsertion(
                    change,
                    numberFormat ?? messages.numberFormat,
                  ),
                getFeedback: (text, revealProblems) =>
                  getNumericFeedback(
                    text,
                    metadata,
                    numberFormat ?? messages.numberFormat,
                    revealProblems,
                    messages,
                  ),
                ...callbacks,
              })
            }
          </SharedResponse>
        ) : (
          <MissingNumericRenderer onContractViolation={onContractViolation} />
        ))}

      {promptType === "listSorter" && (
        <ListSorter
          items={(value as string[]) ?? responses}
          onChange={(newOrder) => saveData(newOrder, record)}
        />
      )}

      {promptType === "slider" && (
        <Slider
          min={metadata.min}
          max={metadata.max}
          interval={metadata.interval}
          labelPts={numericPoints}
          labels={responses}
          showValue={metadata.showValue}
          value={value as number | undefined}
          onChange={(val) => saveData(val, record)}
        />
      )}
    </>
  );
}

function MissingNumericRenderer({
  onContractViolation,
}: Pick<PromptProps, "onContractViolation">) {
  const messages = useMessages();
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    const info = {
      kind: "missingSharedNumericResponse" as const,
      message: "Shared numeric prompts require renderSharedNumericResponse.",
    };
    console.error(info.message);
    onContractViolation?.(info);
  }, [onContractViolation]);
  return <ErrorCallout>{messages.sharedNumericUnavailable}</ErrorCallout>;
}

function SharedNotepadResponse({
  padName,
  defaultText,
  rows,
  renderSharedNotepad,
  onCommit,
}: {
  padName: string;
  defaultText: string;
  rows: number;
  renderSharedNotepad: NonNullable<PromptProps["renderSharedNotepad"]>;
  onCommit: (text: string) => void;
}) {
  return (
    <SharedResponse onCommit={onCommit}>
      {(callbacks) =>
        renderSharedNotepad({ padName, defaultText, rows, ...callbacks })
      }
    </SharedResponse>
  );
}

/** Shared editor lifetime follows the keyed prompt. The same scheduler serves
 * text and numeric documents; retained callbacks become inert on unmount. */
function SharedResponse({
  onCommit,
  children,
}: {
  onCommit: (text: string) => void;
  children: (callbacks: {
    onLocalEdit: (text: string) => void;
    onRemoteChange: (text: string) => void;
    onBlur: (text: string) => void;
  }) => React.ReactNode;
}) {
  const pendingKind = useRef<"local" | "correction" | undefined>(undefined);
  const hasCommitted = useRef(false);
  const latestText = useRef<string | undefined>(undefined);
  const active = useRef(true);
  const commits = useResponseCommit<string>({
    onCommit: (text) => {
      pendingKind.current = undefined;
      hasCommitted.current = true;
      latestText.current = text;
      onCommit(text);
    },
  });
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const onLocalEdit = useCallback(
    (text: string) => {
      if (!active.current) return;
      pendingKind.current = "local";
      latestText.current = text;
      // Queue preserves an existing maximum deadline, including promotion
      // from a correction batch. Equal local values still commit normally.
      commits.queue(text);
    },
    [commits],
  );
  const onRemoteChange = useCallback(
    (text: string) => {
      if (!active.current) return;
      if (pendingKind.current === "local") {
        latestText.current = text;
        commits.replacePending(text);
        return;
      }
      // A never-editing observer cannot start work. A former typist can fix
      // its stale snapshot when a late merge arrives, without another edit.
      // Ignore duplicate merged callbacks so correction delivery cannot loop
      // or perpetually postpone the quiet deadline.
      if (!hasCommitted.current || latestText.current === text) return;
      latestText.current = text;
      pendingKind.current = "correction";
      commits.queue(text);
    },
    [commits],
  );
  const onBlur = useCallback(
    (text: string) => {
      if (!active.current || pendingKind.current === undefined) return;
      latestText.current = text;
      commits.replacePending(text);
      // A correction still waits for its existing cadence, but blur may
      // carry a newer merged snapshot than the last remote notification.
      if (pendingKind.current === "local") commits.flush();
    },
    [commits],
  );

  return children({ onLocalEdit, onRemoteChange, onBlur });
}
