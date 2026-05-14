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
      <div className="stagebook-discussion-page">
        {/* Discussion column */}
        <div data-testid="discussion" className="stagebook-discussion-column">
          {renderDiscussion(stage.discussion)}
        </div>

        {/* Elements / content column. In host-scroll mode the host owns
            the scroll container; in internal-scroll mode this column
            scrolls itself, governed by the `data-internal-scroll` attr. */}
        <div
          ref={isHostScroll ? null : discussionContentRef}
          data-testid="stageContent"
          className="stagebook-discussion-content"
          data-internal-scroll={isHostScroll ? undefined : "true"}
        >
          {elementsColumn}
          {!isHostScroll && (
            <ScrollIndicator visible={showDiscussionScrollIndicator} />
          )}
        </div>
        <style>{`
          /* Mirrors deliberation-empirica's Stage layout (#295). On
             narrow viewports the two columns stack; at the md breakpoint
             they switch to a side-by-side row with the parent forced to
             viewport-min-height so \`align-items: stretch\` reliably
             extends both columns to fill the visible area. We avoid
             \`flex-wrap\` here because the wrap path made the layout
             depend on a brittle interaction between line-height,
             align-content, and the discussion column's intrinsic
             height — the empirica reference (which works) uses a
             clean media-query switch. */
          .stagebook-discussion-page {
            display: flex;
            flex-direction: column;
            width: 100%;
            gap: 1rem;
            padding-bottom: 1rem;
          }
          .stagebook-discussion-column {
            position: relative;
            width: 100%;
            min-height: 16rem;
          }
          .stagebook-discussion-content {
            width: 100%;
            padding-left: 1rem;
            padding-right: 1rem;
          }
          @media (min-width: 48rem) {
            .stagebook-discussion-page {
              flex-direction: row;
              align-items: stretch;
              padding-top: 1rem;
              padding-left: 1.5rem;
              padding-right: 1.5rem;
              /* \`height: 100%\` (alongside the existing min-height floor)
                 makes the wrapper fill a definite-height host container
                 instead of growing past it. Without this, an elements
                 column whose content exceeds viewport height pushes the
                 wrapper taller rather than triggering the column's
                 own \`overflow-y: auto\` — defeating the "fixed video
                 column, scrolling right column" layout. In hosts whose
                 parent is content-sized (no definite height), height:
                 100% resolves to auto and the min-height floor still
                 applies, so this change is backward-compatible. */
              height: 100%;
              min-height: calc(100vh - 4rem);
            }
            .stagebook-discussion-column {
              flex: 1;
              min-width: 24rem;
            }
            .stagebook-discussion-content {
              flex: 0 1 auto;
              width: 40vw;
              min-width: 20rem;
              max-width: 48rem;
              align-self: stretch;
              padding-left: 0;
              padding-right: 0;
            }
            .stagebook-discussion-content[data-internal-scroll="true"] {
              overflow-y: auto;
              scroll-behavior: smooth;
            }
          }
        `}</style>
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
