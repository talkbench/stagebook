import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from "react";
import type {
  IntroSequenceType,
  TreatmentFileType,
  TreatmentType,
} from "stagebook";
import {
  StagebookProvider,
  Stage,
  ScrollIndicator,
  useScrollAwareness,
} from "stagebook/components";
import { flattenSteps } from "../lib/steps";
import { ViewerStateStore } from "../lib/store";
import { createViewerContext } from "../lib/context";
import { StageNav } from "./StageNav";
import { StateInspector } from "./StateInspector";
import { TimeScrubber } from "./TimeScrubber";
import { NotesIconsOverlay } from "./NotesIconsOverlay";
import { createSkeletonRenderers } from "./SkeletonPlaceholder";

export interface ViewerProps {
  treatmentFile: TreatmentFileType;
  /** Must be referentially stable (memoized) to avoid re-fetch loops. */
  getTextContent: (path: string) => Promise<string>;
  /** Must be referentially stable (memoized) to avoid re-fetch loops. */
  getAssetURL: (path: string) => string;
  selectedIntroIndex: number;
  selectedTreatmentIndex: number;
  /**
   * Optional back affordance. When provided, the header shows a back arrow
   * that invokes this callback. Omit to hide the arrow (e.g. in an embedded
   * preview where there is no prior screen to return to).
   */
  onBack?: () => void;
  /**
   * Optional refresh affordance. When provided, the header shows a reload
   * icon that invokes this callback. The Viewer itself doesn't re-fetch —
   * hosts are expected to supply an updated `treatmentFile` prop in response.
   * Viewer state (stageIndex, position, saved responses) persists across the
   * prop update since React doesn't unmount the component.
   */
  onRefresh?: () => void;
  /**
   * Bump to force useTextContent to re-fetch all prompt files. Optional —
   * production hosts that never change content can omit it.
   */
  contentVersion?: number;
  /**
   * Optional setter for `selectedTreatmentIndex`. When provided, the
   * header renders a dropdown letting the researcher switch which
   * treatment is being previewed. Omit to keep the static label.
   */
  onTreatmentIndexChange?: (index: number) => void;
  /**
   * Optional setter for `selectedIntroIndex`. When provided AND the
   * treatment file has 2+ intro sequences, the header renders a
   * dropdown for picking which intro to preview. The schema requires
   * a non-empty `introSequences` array, so the only suppressed case
   * is the single-intro-sequence file (the typical shape) — there
   * the dropdown is omitted entirely (no static label, since the
   * intro is implicit context for the visible stages).
   */
  onIntroIndexChange?: (index: number) => void;
}

export function Viewer({
  treatmentFile,
  getTextContent,
  getAssetURL,
  selectedIntroIndex,
  selectedTreatmentIndex,
  onBack,
  onRefresh,
  contentVersion,
  onTreatmentIndexChange,
  onIntroIndexChange,
}: ViewerProps) {
  const treatment = treatmentFile.treatments[selectedTreatmentIndex];
  const introSequence = treatmentFile.introSequences[selectedIntroIndex];

  // Whether to render the treatment/intro selectors as dropdowns.
  // When the host doesn't pass setters the viewer is uncontrolled
  // and falls back to the static-label layout. With only one
  // treatment the dropdown collapses to a static name label
  // (researchers still want to see *which* treatment they're
  // looking at). With only one intro sequence the picker is
  // omitted entirely — the intro is implicit context, not
  // foreground UI worth labeling.
  const showTreatmentPicker =
    !!onTreatmentIndexChange && treatmentFile.treatments.length > 1;
  const showIntroPicker =
    !!onIntroIndexChange && treatmentFile.introSequences.length > 1;

  const steps = useMemo(
    () => flattenSteps(introSequence, treatment),
    [introSequence, treatment],
  );

  const [stageIndex, setStageIndex] = useState(0);
  // Bumped when the researcher clicks "Reset stage" in the inspector;
  // included in the <Stage> key below so a bump forces a full remount.
  // Lets components like Timeline (which read store values once on mount
  // and then own them locally) re-read after the inspector clears or
  // overrides a value. (Issue #170.)
  const [stageResetVersion, setStageResetVersion] = useState(0);
  const handleResetStage = useCallback(() => {
    setStageResetVersion((v) => v + 1);
  }, []);
  const [position, setPosition] = useState(0);
  const [store] = useState(() => new ViewerStateStore());
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  // `<main>` is the scroll container in the viewer's host-owns-scroll
  // model (see <Stage scrollMode="host"> below). `useScrollAwareness`
  // observes it for content growth and produces the indicator visibility
  // — same UX as Stage's old internal scroll, just hosted by us.
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const { showIndicator: showScrollIndicator } =
    useScrollAwareness(mainScrollRef);

  // Clamp stageIndex if the treatment was edited to have fewer stages
  // (e.g. researcher deleted a stage while the preview was open). Without
  // this, steps[stageIndex] returns undefined and the viewer blanks.
  useEffect(() => {
    if (steps.length > 0 && stageIndex >= steps.length) {
      setStageIndex(steps.length - 1);
    }
  }, [steps.length, stageIndex]);

  // Subscribe to store changes so the UI re-renders.
  // The version is included in ctx memo deps below so that
  // StagebookProvider gets a new context value on store changes.
  const storeVersion = useSyncExternalStore(
    useCallback((cb: () => void) => store.onChange(cb), [store]),
    useCallback(() => store.getVersion(), [store]),
  );

  const currentStep = steps[stageIndex];
  const isSubmitted = store.getSubmitted(stageIndex);

  const handleSubmit = useCallback(() => {
    store.setSubmitted(stageIndex, true);
  }, [store, stageIndex]);

  const handleNext = useCallback(() => {
    if (stageIndex < steps.length - 1) {
      setStageIndex(stageIndex + 1);
    }
  }, [stageIndex, steps.length]);

  const handleTimeChange = useCallback(
    (seconds: number) => store.setElapsedTime(stageIndex, seconds),
    [store, stageIndex],
  );

  const ctx = useMemo(
    () =>
      createViewerContext({
        store,
        position,
        stageIndex,
        playerCount: treatment.playerCount,
        onSubmit: handleSubmit,
        getTextContent,
        getAssetURL,
        contentVersion,
        renderers: createSkeletonRenderers(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      store,
      storeVersion,
      position,
      stageIndex,
      treatment.playerCount,
      handleSubmit,
      getTextContent,
      getAssetURL,
      contentVersion,
    ],
  );

  if (!currentStep) return null;

  const stageConfig = {
    name: currentStep.name,
    duration: currentStep.duration,
    elements: currentStep.elements,
    discussion: currentStep.discussion,
    conditions: currentStep.conditions,
  };

  return (
    <div style={layoutStyle}>
      {/* Header */}
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          {onBack && (
            <button aria-label="Back" onClick={onBack} style={backButtonStyle}>
              &larr;
            </button>
          )}
          {onRefresh && (
            <button
              aria-label="Refresh preview"
              title="Refresh preview"
              onClick={onRefresh}
              style={refreshButtonStyle}
            >
              &#x21bb;
            </button>
          )}
          {showTreatmentPicker ? (
            <select
              aria-label="Treatment"
              title="Treatment"
              value={selectedTreatmentIndex}
              onChange={(e) => onTreatmentIndexChange?.(Number(e.target.value))}
              style={treatmentSelectStyle}
            >
              {(treatmentFile.treatments as TreatmentType[]).map((t, i) => (
                <option key={i} value={i}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <span style={treatmentNameStyle}>{treatment.name}</span>
          )}
          {showIntroPicker && (
            <select
              aria-label="Intro sequence"
              title="Intro sequence"
              value={selectedIntroIndex}
              onChange={(e) => onIntroIndexChange?.(Number(e.target.value))}
              style={treatmentSelectStyle}
            >
              {(treatmentFile.introSequences as IntroSequenceType[]).map(
                (seq, i) => (
                  <option key={i} value={i}>
                    {seq.name ?? `Intro ${i}`}
                  </option>
                ),
              )}
            </select>
          )}
          <span style={headerDividerStyle} aria-hidden="true" />
          <StageNav
            steps={steps}
            currentIndex={stageIndex}
            onSelect={setStageIndex}
          />
        </div>
        <TimeScrubber
          currentStep={currentStep}
          elapsedTime={store.getElapsedTime(stageIndex)}
          onTimeChange={handleTimeChange}
        />
        <div style={positionSwitcherStyle}>
          <label htmlFor="position-select" style={positionLabelStyle}>
            Position
          </label>
          <select
            id="position-select"
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            style={positionSelectStyle}
          >
            {Array.from({ length: treatment.playerCount }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div style={bodyStyle}>
        <aside style={sidebarStyle}>
          <StateInspector
            store={store}
            currentStep={currentStep}
            stageIndex={stageIndex}
            position={position}
            playerCount={treatment.playerCount}
            onResetStage={handleResetStage}
          />
        </aside>

        {/* Main content */}
        <main ref={mainScrollRef} style={mainStyle}>
          {isSubmitted ? (
            <div style={submittedOverlayStyle}>
              <p style={submittedTextStyle}>
                Waiting for other participants...
              </p>
              <button onClick={handleNext} style={nextButtonStyle}>
                Next &rarr;
              </button>
              <button
                onClick={() => store.setSubmitted(stageIndex, false)}
                style={toggleSubmitStyle}
              >
                Show stage again
              </button>
            </div>
          ) : (
            <>
              <div ref={stageContainerRef} style={stageContainerStyle}>
                <StagebookProvider value={ctx}>
                  <Stage
                    key={`stage-${String(stageIndex)}-${String(stageResetVersion)}`}
                    stage={stageConfig}
                    onSubmit={handleSubmit}
                    scrollMode="host"
                  />
                </StagebookProvider>
                <NotesIconsOverlay
                  containerRef={stageContainerRef}
                  currentStep={currentStep}
                />
              </div>
              {/* Bottom-of-stage breathing room — see comment on
                  stageBottomSpacerStyle. aria-hidden because it has no
                  semantic content. */}
              <div aria-hidden="true" style={stageBottomSpacerStyle} />
              {/* The indicator is `position: sticky; bottom: 0`, so it
                  pins to the bottom of <main> as content scrolls past. */}
              <ScrollIndicator visible={showScrollIndicator} />
            </>
          )}
        </main>
      </div>
    </div>
  );
}

// --- Styles ---

const layoutStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0.5rem 1rem",
  borderBottom: "1px solid #e5e7eb",
  backgroundColor: "white",
  gap: "1rem",
  flexShrink: 0,
};

const headerLeftStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  flexShrink: 0,
};

const headerDividerStyle: React.CSSProperties = {
  width: "1px",
  height: "1rem",
  backgroundColor: "#e5e7eb",
  marginLeft: "0.25rem",
  marginRight: "0.25rem",
};

const backButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "1.25rem",
  color: "#6b7280",
  padding: "0.25rem",
};

const refreshButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: "1.1rem",
  color: "#6b7280",
  padding: "0.25rem",
  lineHeight: 1,
};

const treatmentNameStyle: React.CSSProperties = {
  fontWeight: 600,
  fontSize: "0.875rem",
  color: "#1f2937",
};

const treatmentSelectStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #d1d5db",
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "#1f2937",
  maxWidth: "16rem",
};

const positionSwitcherStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
};

const positionLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#6b7280",
};

const positionSelectStyle: React.CSSProperties = {
  padding: "0.25rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid #d1d5db",
  fontSize: "0.75rem",
};

const bodyStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const sidebarStyle: React.CSSProperties = {
  width: "var(--viewer-sidebar-width)",
  flexShrink: 0,
  borderRight: "1px solid #e5e7eb",
  backgroundColor: "#fafafa",
  overflow: "auto",
  padding: "1rem",
};

const mainStyle: React.CSSProperties = {
  flex: 1,
  // The viewer is a host-owns-scroll consumer of Stagebook (see
  // <Stage scrollMode="host"> in the render): `<main>` is the actual
  // scroll container, and we mount the publicly exported
  // `useScrollAwareness` + `<ScrollIndicator>` against it. This lets
  // the host page flow naturally — the bottom spacer at the end of the
  // stage actually scrolls into view, which it couldn't when Stage's
  // own internal div was the scroller.
  overflow: "auto",
  padding: "1.5rem",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  position: "relative",
};

const stageContainerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  // `flex: 1` + `min-height: 0` makes this fill `<main>`'s remaining
  // vertical space (after the bottom spacer), giving Stage a
  // definite-height parent. Stage's discussion-page CSS does
  // `height: 100%` (post-stagebook#356) and resolves to auto when its
  // parent has no definite height — which would let the discussion
  // column grow past the viewport instead of pinning the video tile
  // and scrolling the right-hand elements column. Mirrors what
  // deliberation-lab's `<div className="fixed top-12 left-0 right-0
  // bottom-0">` provides at its level (see Game.jsx).
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

// Bottom-of-stage breathing room (#234). Without this, long stages end
// at a hard scroll-stop and participants have no signal they've reached
// the end. 8rem matches the annotator's spacer (deliberation-lab/
// annotator#138) so the visual rhythm is consistent across hosts.
const stageBottomSpacerStyle: React.CSSProperties = {
  flexShrink: 0,
  height: "8rem",
};

const submittedOverlayStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  height: "100%",
  width: "100%",
};

const submittedTextStyle: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "0.875rem",
};

const nextButtonStyle: React.CSSProperties = {
  padding: "0.5rem 1.5rem",
  borderRadius: "0.375rem",
  border: "none",
  backgroundColor: "#3b82f6",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
  fontWeight: 500,
};

const toggleSubmitStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#9ca3af",
  fontSize: "0.75rem",
  cursor: "pointer",
  textDecoration: "underline",
};
