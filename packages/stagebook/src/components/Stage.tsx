/* eslint-disable @typescript-eslint/unbound-method */
import React, { useRef } from "react";
import { useStagebookContext } from "./StagebookProvider.js";
import { Element, type ElementConfig } from "./Element.js";
import { TimeConditionalRender } from "./conditions/TimeConditionalRender.js";
import { PositionConditionalRender } from "./conditions/PositionConditionalRender.js";
import { ConditionsConditionalRender } from "./conditions/ConditionsConditionalRender.js";
import { SubmissionConditionalRender } from "./conditions/SubmissionConditionalRender.js";
import { StageConditionGate } from "./conditions/StageConditionGate.js";
import { ScrollIndicator } from "./scroll/ScrollIndicator.js";
import { useScrollAwareness } from "./scroll/useScrollAwareness.js";
import { PlaybackProvider } from "./playback/PlaybackProvider.js";
import { ElementErrorBoundary } from "./ElementErrorBoundary.js";
import type { DiscussionType } from "../schemas/treatment.js";
import type { Condition } from "./conditions/ConditionsConditionalRender.js";

// Max-width per element type — wider for surveys/qualtrics/video
const DEFAULT_LANE = "42rem"; // ~672px
const ELEMENT_LANES: Record<string, string> = {
  survey: "64rem", // ~1024px
  qualtrics: "64rem",
  mediaPlayer: "56rem", // ~896px
  timeline: "56rem",
};

function laneFor(type: string): string {
  return ELEMENT_LANES[type] ?? DEFAULT_LANE;
}

/**
 * Compute the max-width lane for an element. Separators span at least as
 * wide as the widest non-separator sibling on the stage so they read as
 * true page-spanning dividers rather than stubs (issue #301).
 */
export function maxWidthForElement(
  element: ElementConfig,
  siblings: readonly ElementConfig[] = [],
): string {
  if (element.type !== "separator") return laneFor(element.type);

  let widestRem = parseFloat(DEFAULT_LANE);
  let widest = DEFAULT_LANE;
  for (const s of siblings) {
    if (s.type === "separator") continue;
    const lane = laneFor(s.type);
    const rem = parseFloat(lane);
    if (rem > widestRem) {
      widestRem = rem;
      widest = lane;
    }
  }
  return widest;
}

export interface StageConfig {
  name: string;
  duration?: number;
  elements: ElementConfig[];
  discussion?: DiscussionType;
  /**
   * Stage-level conditions (#183). When any condition evaluates to
   * false at mount the stage is skipped; when a condition flips to
   * false after mount the stage ends early. Stagebook asks the host
   * to advance via `StagebookContext.advanceStage` (falling back to
   * `submit`).
   */
  conditions?: Condition[];
}

export interface StageProps {
  stage: StageConfig;
  onSubmit: () => void;
  /**
   * Who owns the scroll container?
   *
   * - `"internal"` (default, current behavior): Stage wraps its elements
   *   in an `overflow: auto` div, calls `useScrollAwareness` on it, and
   *   renders the `<ScrollIndicator>` itself. Convenient for hosts that
   *   want a fixed-height column with internal scroll out of the box.
   * - `"host"`: Stage drops the internal scroll container, the bottom
   *   padding, and the indicator. Content flows naturally; the host
   *   decides what scrolls (e.g. the page, a `<main>`, a custom shell)
   *   and is free to mount `useScrollAwareness` + `<ScrollIndicator>`
   *   against its own ref. Lets hosts add bottom-of-stage breathing
   *   room (#234) and decorate around Stage without fighting an
   *   internal scroller. (Issue #236.)
   */
  scrollMode?: "internal" | "host";
}

function WrappedElement({
  element,
  siblings,
  onSubmit,
  stageDuration,
}: {
  element: ElementConfig;
  siblings: readonly ElementConfig[];
  onSubmit: () => void;
  stageDuration?: number;
}) {
  const { getElapsedTime, position, resolve } = useStagebookContext();

  return (
    <TimeConditionalRender
      displayTime={element.displayTime}
      hideTime={element.hideTime}
      getElapsedTime={getElapsedTime}
    >
      <PositionConditionalRender
        showToPositions={element.showToPositions as number[] | undefined}
        hideFromPositions={element.hideFromPositions as number[] | undefined}
        position={position}
      >
        <ConditionsConditionalRender
          conditions={(element.conditions as Condition[]) ?? []}
          resolve={resolve}
        >
          <div
            data-testid={`element-${element.type}${element.name ? `-${element.name}` : ""}`}
            style={{
              margin: "0 auto",
              width: "100%",
              maxWidth: maxWidthForElement(element, siblings),
              padding: "0.5rem 1rem",
            }}
          >
            <ElementErrorBoundary
              elementType={element.type}
              elementName={element.name}
            >
              <Element
                element={element}
                onSubmit={onSubmit}
                stageDuration={stageDuration}
              />
            </ElementErrorBoundary>
          </div>
        </ConditionsConditionalRender>
      </PositionConditionalRender>
    </TimeConditionalRender>
  );
}

function ElementsColumn({
  elements,
  onSubmit,
  stageDuration,
}: {
  elements: ElementConfig[];
  onSubmit: () => void;
  stageDuration?: number;
}) {
  return (
    <>
      {elements.map((element, i) => (
        <WrappedElement
          key={element.name ?? `element-${i}`}
          element={element}
          siblings={elements}
          onSubmit={onSubmit}
          stageDuration={stageDuration}
        />
      ))}
    </>
  );
}

// Check whether the current position should see the discussion
function positionAllowsDiscussion(
  discussion: DiscussionType | undefined,
  position: number | undefined,
): boolean {
  if (!discussion) return false;
  if (position === undefined || position === null) return false;

  // Defensive coercion — host platforms may pass position as a string
  const numPosition =
    typeof position === "number" ? position : Number(position);
  if (Number.isNaN(numPosition)) return false;

  const show = discussion.showToPositions;
  const hide = discussion.hideFromPositions;

  if (show && !show.includes(numPosition)) return false;
  if (hide && hide.includes(numPosition)) return false;

  return true;
}

export function Stage({
  stage,
  onSubmit,
  scrollMode = "internal",
}: StageProps) {
  const ctx = useStagebookContext();
  const { isSubmitted, playerCount, position, resolve, renderDiscussion } = ctx;

  const showDiscussion = positionAllowsDiscussion(stage.discussion, position);

  // In "host" mode the host owns the scroll container; Stage's outer
  // wrappers become semantic groupings without overflow, and the host
  // is responsible for mounting `useScrollAwareness` + `ScrollIndicator`
  // against its own ref. We still call the hooks unconditionally so hook
  // order stays stable (they no-op on null refs); the refs just don't
  // get attached in host mode.
  const isHostScroll = scrollMode === "host";
  const discussionContentRef = useRef<HTMLDivElement>(null);
  const singleColumnRef = useRef<HTMLDivElement>(null);
  const { showIndicator: showDiscussionScrollIndicator } =
    useScrollAwareness(discussionContentRef);
  const { showIndicator: showSingleColumnScrollIndicator } =
    useScrollAwareness(singleColumnRef);

  const elementsColumn = (
    <ElementsColumn
      elements={stage.elements}
      onSubmit={onSubmit}
      stageDuration={stage.duration}
    />
  );

  // Two-column layout: discussion on left, elements on right
  if (showDiscussion && renderDiscussion && stage.discussion) {
    const discussionConditions = stage.discussion.conditions as
      | Condition[]
      | undefined;

    const discussionPage = (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          height: "100%",
          width: "100%",
          flexDirection: "row",
          alignItems: "stretch",
          gap: "1rem",
          paddingBottom: "1rem",
          paddingLeft: "1.5rem",
          paddingRight: "1.5rem",
          minHeight: "calc(100vh - 4rem)",
        }}
      >
        {/* Discussion column */}
        <div
          data-testid="discussion"
          style={{
            position: "relative",
            flex: 1,
            minWidth: "24rem",
            minHeight: "16rem",
          }}
        >
          {renderDiscussion(stage.discussion)}
        </div>

        {/* Elements column — scrollable independently in `internal` mode.
            flex: "1 1 20rem" lets it share space in row mode (40vw preferred)
            but stretch to full width when the container wraps to column. */}
        <div
          ref={isHostScroll ? null : discussionContentRef}
          data-testid="stageContent"
          style={{
            flex: "1 1 20rem",
            maxWidth: "48rem",
            alignSelf: "stretch",
            ...(isHostScroll
              ? {}
              : { overflowY: "auto", scrollBehavior: "smooth" }),
          }}
        >
          {elementsColumn}
          {!isHostScroll && (
            <ScrollIndicator visible={showDiscussionScrollIndicator} />
          )}
        </div>
      </div>
    );

    return (
      <StageConditionGate conditions={stage.conditions}>
        <PlaybackProvider>
          <SubmissionConditionalRender
            isSubmitted={isSubmitted}
            playerCount={playerCount}
          >
            {discussionConditions && discussionConditions.length > 0 ? (
              <ConditionsConditionalRender
                conditions={discussionConditions}
                resolve={resolve}
                fallback={
                  <div
                    data-testid="stageContent"
                    style={{
                      display: "flex",
                      width: "100%",
                      flexDirection: "column",
                      ...(isHostScroll
                        ? {}
                        : {
                            height: "100%",
                            paddingBottom: "0.5rem",
                            overflow: "auto",
                          }),
                    }}
                  >
                    {elementsColumn}
                  </div>
                }
              >
                {discussionPage}
              </ConditionsConditionalRender>
            ) : (
              discussionPage
            )}
          </SubmissionConditionalRender>
        </PlaybackProvider>
      </StageConditionGate>
    );
  }

  // Single-column layout: elements only
  return (
    <StageConditionGate conditions={stage.conditions}>
      <PlaybackProvider>
        <SubmissionConditionalRender
          isSubmitted={isSubmitted}
          playerCount={playerCount}
        >
          <div
            ref={isHostScroll ? null : singleColumnRef}
            data-testid="stageContent"
            style={{
              display: "flex",
              width: "100%",
              flexDirection: "column",
              ...(isHostScroll
                ? {}
                : {
                    height: "100%",
                    paddingBottom: "0.5rem",
                    overflow: "auto",
                  }),
            }}
          >
            {elementsColumn}
            {!isHostScroll && (
              <ScrollIndicator visible={showSingleColumnScrollIndicator} />
            )}
          </div>
        </SubmissionConditionalRender>
      </PlaybackProvider>
    </StageConditionGate>
  );
}
