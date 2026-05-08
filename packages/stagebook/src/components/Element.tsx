/* eslint-disable @typescript-eslint/unbound-method */
import React from "react";
import { useStagebookContext, useTextContent } from "./StagebookProvider.js";
import { promptFileSchema } from "../schemas/promptFile.js";
import {
  formatReference,
  parseDottedReference,
  type ReferenceType,
} from "../schemas/reference.js";
import { Separator } from "./form/Separator.js";
import { Display } from "./elements/Display.js";
import { SubmitButton } from "./elements/SubmitButton.js";
import { AudioElement } from "./elements/AudioElement.js";
import { ImageElement } from "./elements/ImageElement.js";
import { KitchenTimer } from "./elements/KitchenTimer.js";
import { TrackedLink, type ResolvedParam } from "./elements/TrackedLink.js";
import { MediaPlayer } from "./elements/MediaPlayer.js";
import { Timeline } from "./elements/Timeline.js";
import { Prompt } from "./elements/Prompt.js";
import { Qualtrics } from "./elements/Qualtrics.js";
import { Loading } from "./form/Loading.js";

// Resolve element URL params using the StagebookProvider's resolve.
// Plain function — no hooks — so it's safe to call conditionally (e.g. in
// a switch case) without violating the Rules of Hooks.
function resolveParams(
  urlParams:
    | Array<{
        key: string;
        value?: unknown;
        // After #240, references can be either the dotted-string sugar
        // or the structured `{position, source, name?, path?}` form.
        // Per #298 position lives inside the reference; the pre-#298
        // sibling `position:` field is gone.
        reference?: string | ReferenceType;
      }>
    | undefined,
  resolve: (ref: string | ReferenceType) => unknown[],
): ResolvedParam[] {
  if (!urlParams) return [];
  return urlParams.map((param) => {
    if (!param.reference) {
      return {
        key: param.key,
        value:
          param.value == null
            ? ""
            : String(param.value as string | number | boolean),
      };
    }
    // Per #298 the position is part of the reference itself; the
    // sibling `param.position` field is removed.
    const values = resolve(param.reference);
    const picked = values.find((v) => v !== undefined);
    return {
      key: param.key,
      value: picked == null ? "" : String(picked as string | number | boolean),
    };
  });
}

export interface ElementConfig {
  type: string;
  name?: string;
  file?: string;
  style?: "" | "thin" | "regular" | "thick";
  // After #240, references accept the dotted-string sugar OR the structured
  // `{source, name?, path?}` form. Element.tsx forwards either to `resolve`
  // (which handles both) and stringifies for the `data-reference` attribute
  // on Display.
  reference?: string | ReferenceType;
  position?: string;
  shared?: boolean;
  buttonText?: string;
  url?: string;
  source?: string;
  displayText?: string;
  helperText?: string;
  urlParams?: Array<{
    key: string;
    value?: unknown;
    reference?: string | ReferenceType;
    position?: string;
  }>;
  width?: number;
  startTime?: number;
  endTime?: number;
  displayTime?: number;
  hideTime?: number;
  warnTimeRemaining?: number;
  surveyName?: string;
  [key: string]: unknown;
}

export interface ElementProps {
  element: ElementConfig;
  onSubmit: () => void;
  stageDuration?: number;
}

export function Element({ element, onSubmit, stageDuration }: ElementProps) {
  const ctx = useStagebookContext();
  const {
    resolve,
    save,
    getElapsedTime,
    getAssetURL,
    progressLabel,
    renderSharedNotepad,
    renderDiscussion,
    renderSurvey,
    playerId,
    setAllowIdle,
  } = ctx;

  // Wrap save to add consistent metadata to every element's saved data
  const wrappedSave = React.useCallback(
    (key: string, value: unknown, scope?: "player" | "shared") => {
      const enriched =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? {
              ...value,
              step: progressLabel,
              stageTimeElapsed: getElapsedTime(),
            }
          : value;
      save(key, enriched, scope);
    },
    [save, progressLabel, getElapsedTime],
  );

  // For prompt elements, load the file content
  const promptFile = element.type === "prompt" ? element.file : undefined;
  const {
    data: promptMarkdown,
    isLoading: promptLoading,
    error: promptError,
  } = useTextContent(promptFile ?? "");

  const resolvedParams = resolveParams(
    element.type === "trackedLink" ? element.urlParams : undefined,
    resolve,
  );

  switch (element.type) {
    case "audio":
      return (
        <AudioElement
          src={getAssetURL(element.file ?? "")}
          save={wrappedSave}
          name={element.name ?? element.file}
        />
      );

    case "display": {
      // Per #298, the position is part of the reference itself —
      // `0.prompt.foo.value`, `all.prompt.recall.value`, etc. The
      // Display element no longer takes a sibling `position:` field;
      // the position is parsed out of the reference and used for
      // layout hints. The resolver handles the same parsing internally
      // when resolving values.
      const ref = element.reference ?? `self.prompt.${String(element.name)}`;
      const values = resolve(ref);
      // Parse once, derive both the canonical dotted-string form (for
      // `data-reference`) and the position (for layout) from the same
      // structured shape.
      let parsed: ReferenceType | null = null;
      if (typeof ref === "string") {
        const r = parseDottedReference(ref);
        if (r.ok) parsed = r.value;
      } else {
        parsed = ref;
      }
      const refString = parsed ? formatReference(parsed) : (ref as string); // malformed pass-through
      const positionForLayout =
        parsed === null ? undefined : String(parsed.position);
      return (
        <Display
          reference={refString}
          position={positionForLayout}
          values={values}
        />
      );
    }

    case "image":
      return (
        <ImageElement
          src={getAssetURL(element.file ?? "")}
          width={element.width}
        />
      );

    case "prompt": {
      if (promptError) {
        return (
          <p style={{ color: "#dc2626", fontSize: "0.875rem" }}>
            Error loading prompt{element.file ? ` "${element.file}"` : ""}:{" "}
            {promptError.message}
          </p>
        );
      }
      if (promptLoading || !promptMarkdown) {
        return <Loading />;
      }
      const parsed = promptFileSchema.safeParse(promptMarkdown);
      if (!parsed.success) {
        return (
          <p
            style={{
              color: "var(--stagebook-danger, #dc2626)",
              fontSize: "0.875rem",
            }}
          >
            Error parsing prompt{element.file ? ` "${element.file}"` : ""}:{" "}
            {parsed.error.issues[0]?.message}
          </p>
        );
      }
      const { metadata, body, responseItems, responsePoints } = parsed.data;
      const promptName =
        element.name ?? `${progressLabel}_${metadata.name ?? element.file}`;

      // Read current value from state. Position comes from the
      // reference itself per #298 — `shared.prompt.X` for shared
      // prompts, `self.prompt.X` for player-scoped.
      const scope = element.shared ? "shared" : "self";
      const currentValues = resolve(`${scope}.prompt.${promptName}`);
      const currentValue = currentValues[0];

      return (
        <Prompt
          metadata={metadata}
          body={body}
          responseItems={responseItems}
          responsePoints={responsePoints}
          name={promptName}
          file={element.file}
          shared={element.shared}
          value={currentValue}
          save={wrappedSave}
          resolveURL={getAssetURL}
          renderSharedNotepad={renderSharedNotepad}
        />
      );
    }

    case "separator":
      return <Separator style={element.style} />;

    case "submitButton": {
      const buttonName = element.name ?? progressLabel;
      return (
        <SubmitButton
          onSubmit={onSubmit}
          name={buttonName}
          buttonText={element.buttonText}
          save={wrappedSave}
        />
      );
    }

    case "timer":
      return (
        <KitchenTimer
          startTime={element.startTime ?? element.displayTime ?? 0}
          endTime={element.endTime ?? element.hideTime ?? stageDuration ?? 0}
          warnTimeRemaining={element.warnTimeRemaining}
          getElapsedTime={getElapsedTime}
        />
      );

    case "mediaPlayer": {
      const rawURL = String(element.file ?? "");
      const resolvedURL =
        rawURL.startsWith("http://") || rawURL.startsWith("https://")
          ? rawURL
          : getAssetURL(rawURL);
      const rawCaptions =
        typeof element.captionsFile === "string" ? element.captionsFile : null;
      const resolvedCaptionsURL =
        rawCaptions == null
          ? undefined
          : rawCaptions.startsWith("http://") ||
              rawCaptions.startsWith("https://")
            ? rawCaptions
            : getAssetURL(rawCaptions);
      return (
        <MediaPlayer
          name={String(element.name ?? rawURL)}
          url={resolvedURL}
          save={wrappedSave}
          getElapsedTime={getElapsedTime}
          onComplete={onSubmit}
          captionsURL={resolvedCaptionsURL}
          syncToStageTime={element.syncToStageTime as boolean | undefined}
          submitOnComplete={element.submitOnComplete as boolean | undefined}
          playVideo={element.playVideo as boolean | undefined}
          playAudio={element.playAudio as boolean | undefined}
          startAt={element.startAt as number | undefined}
          stopAt={element.stopAt as number | undefined}
          allowScrubOutsideBounds={
            element.allowScrubOutsideBounds as boolean | undefined
          }
          stepDuration={element.stepDuration as number | undefined}
          playback={element.playback as "once" | "manual" | undefined}
          controls={
            element.controls as
              | {
                  playPause?: boolean;
                  seek?: boolean;
                  step?: boolean;
                  speed?: boolean;
                }
              | undefined
          }
        />
      );
    }

    case "timeline": {
      const timelineName = String(element.name ?? "");
      // Read previously saved selections so participants who reload the
      // stage see their existing marks. Matches the form-input convention
      // (Prompt reads `prompt.<name>`, Timeline reads `timeline.<name>`).
      const savedSelections = resolve(`timeline.${timelineName}`)[0];
      return (
        <Timeline
          source={String(element.source ?? "")}
          name={timelineName}
          selectionType={
            (element.selectionType as "range" | "point") ?? "range"
          }
          selectionScope={element.selectionScope as "track" | "all" | undefined}
          multiSelect={element.multiSelect as boolean | undefined}
          showWaveform={element.showWaveform as boolean | undefined}
          trackLabels={element.trackLabels as string[] | undefined}
          initialSelections={savedSelections as unknown[] | undefined}
          save={wrappedSave}
        />
      );
    }

    case "trackedLink":
      return (
        <TrackedLink
          name={element.name ?? ""}
          url={element.url ?? ""}
          displayText={element.displayText ?? ""}
          helperText={element.helperText}
          resolvedParams={resolvedParams}
          save={wrappedSave}
          getElapsedTime={getElapsedTime}
          progressLabel={progressLabel}
          setAllowIdle={setAllowIdle}
        />
      );

    case "qualtrics": {
      const qualtricsParams = resolveParams(element.urlParams, resolve);
      return (
        <Qualtrics
          url={element.url ?? ""}
          resolvedParams={qualtricsParams}
          participantId={playerId}
          save={wrappedSave}
          onComplete={onSubmit}
        />
      );
    }

    case "survey": {
      const surveyName = element.surveyName ?? "";
      const surveyKey = element.name ?? surveyName;
      return (
        renderSurvey?.({
          surveyName,
          onComplete: (results: unknown) => {
            wrappedSave(`survey_${surveyKey}`, results);
            onSubmit();
          },
        }) ?? null
      );
    }

    case "discussion":
      return renderDiscussion?.(element as never) ?? null;

    default:
      console.warn(`Unknown element type: ${element.type}`);
      return null;
  }
}
