import React, { useState, useCallback, useRef } from "react";
import { Markdown } from "../form/Markdown.js";
import { RadioGroup } from "../form/RadioGroup.js";
import { CheckboxGroup } from "../form/CheckboxGroup.js";
import { TextArea, type DebugMessage } from "../form/TextArea.js";
import { Slider } from "../form/Slider.js";
import { ListSorter } from "../form/ListSorter.js";
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
  save: (key: string, value: unknown, scope?: "player" | "shared") => void;
  resolveURL?: (path: string) => string;
  renderSharedNotepad?: (config: {
    padName: string;
    defaultText?: string;
    rows?: number;
  }) => React.ReactNode;
}

export function Prompt({
  metadata,
  body,
  responseItems,
  responsePoints,
  sliderPoints,
  name,
  file,
  shared = false,
  value,
  save,
  resolveURL,
  renderSharedNotepad,
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
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
  const debounceTextRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceInteractiveRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const promptType = metadata.type;
  // Per-type fields only exist on the discriminated-union branch where
  // they were declared (#243). Safely-narrowed lookups via the type tag.
  const rows = promptType === "openResponse" ? (metadata.rows ?? 5) : 5;
  const minLength =
    promptType === "openResponse" ? metadata.minLength : undefined;
  const maxLength =
    promptType === "openResponse" ? metadata.maxLength : undefined;
  // `shuffle` (renamed from `shuffleOptions` in #243) lives on
  // multipleChoice and listSorter. Sliders never shuffle — points and
  // labels share an i'th-position alignment that scrambling would break.
  const shouldShuffle =
    (promptType === "multipleChoice" || promptType === "listSorter") &&
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
    ...metadata,
    name,
    file,
    shared,
    prompt: body,
    responses,
    debugMessages,
  };

  const saveData = useCallback(
    (newValue: unknown, recordData: typeof record, label?: string) => {
      const updatedRecord = {
        ...recordData,
        value: newValue,
        // For multipleChoice prompts (#282), record both the chosen value
        // and its display label. In numeric mode `value` is the number and
        // `label` is the text; in text mode `value === label`. Slider
        // responses don't carry a label since the input is continuous.
        ...(label !== undefined ? { label } : {}),
      };
      const scope = shared ? "shared" : "player";
      save(`prompt_${recordData.name}`, updatedRecord, scope);
    },
    [shared, save],
  );

  const debouncedSaveText = useCallback(
    (newValue: unknown, recordData: typeof record) => {
      if (debounceTextRef.current) clearTimeout(debounceTextRef.current);
      debounceTextRef.current = setTimeout(
        () => saveData(newValue, recordData),
        2000,
      );
    },
    [saveData],
  );

  const debouncedSaveInteractive = useCallback(
    (newValue: unknown, recordData: typeof record, label?: string) => {
      if (debounceInteractiveRef.current)
        clearTimeout(debounceInteractiveRef.current);
      debounceInteractiveRef.current = setTimeout(
        () => saveData(newValue, recordData, label),
        50,
      );
    },
    [saveData],
  );

  return (
    <>
      <Markdown text={body} resolveURL={resolveURL} />

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
            onChange={(e) => {
              const idx = shuffledNumericPoints.findIndex(
                (p) => String(p) === e.target.value,
              );
              const numericValue = shuffledNumericPoints[idx];
              const label = responses[idx] ?? "";
              debouncedSaveInteractive(numericValue, record, label);
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
            onChange={(e) =>
              // Text mode: label === value.
              debouncedSaveInteractive(e.target.value, record, e.target.value)
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
          onChange={(newSelection) =>
            debouncedSaveInteractive(newSelection, record)
          }
        />
      )}

      {promptType === "openResponse" && !shared && (
        <TextArea
          defaultText={responses.join("\n")}
          onChange={(val) => debouncedSaveText(val, record)}
          onDebugMessage={(message) =>
            setDebugMessages((prev) => [...prev, message])
          }
          value={value as string | undefined}
          rows={rows}
          showCharacterCount={!!(minLength || maxLength)}
          minLength={minLength}
          maxLength={maxLength}
        />
      )}

      {promptType === "openResponse" &&
        shared &&
        renderSharedNotepad?.({
          padName: name,
          defaultText: responses.join("\n"),
          rows,
        })}

      {promptType === "listSorter" && (
        <ListSorter
          items={(value as string[]) ?? responses}
          onChange={(newOrder) => debouncedSaveInteractive(newOrder, record)}
        />
      )}

      {promptType === "slider" && (
        <Slider
          min={metadata.min}
          max={metadata.max}
          interval={metadata.interval}
          labelPts={numericPoints}
          labels={responses}
          value={value as number | undefined}
          onChange={(val) => debouncedSaveInteractive(val, record)}
        />
      )}
    </>
  );
}
