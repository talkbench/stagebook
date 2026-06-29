import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
  useSyncExternalStore,
} from "react";
import type { TreatmentFileType } from "stagebook";
import {
  StagebookProvider,
  Stage,
  ScrollIndicator,
  useScrollAwareness,
  isRTLLocale,
} from "stagebook/components";
import { buildUnits, initialUnitKey, type ViewerUnit } from "../lib/steps";
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
   * Setter for the host's intro-sequence index. Intro sequences no longer have
   * a separate dropdown — they're selected through the unified "part to
   * preview" picker — but the viewer still calls this when an intro is picked
   * so the host's persisted selection (and thus the post-refresh restore in the
   * VS Code preview) tracks the active unit. `selectedIntroIndex` seeds the
   * initial unit when no treatment is selectable (e.g. an intro-only file).
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
  // The viewer walks ONE selectable unit at a time — an intro sequence OR a
  // treatment — rather than pairing an intro with a treatment. A single
  // <optgroup> picker switches between them; each unit declares its own locale
  // and ends with a transition screen narrating the platform's next phase.
  const units = useMemo(() => buildUnits(treatmentFile), [treatmentFile]);
  const introUnits = units.filter((u) => u.kind === "intro");
  const treatmentUnits = units.filter((u) => u.kind === "treatment");
  const [selectedUnitKey, setSelectedUnitKey] = useState(() =>
    initialUnitKey(units, selectedIntroIndex, selectedTreatmentIndex),
  );
  const unit: ViewerUnit | undefined =
    units.find((u) => u.key === selectedUnitKey) ?? units[0];
  const steps = unit?.steps ?? [];

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
  // When the file changes, keep the current selection if it still exists —
  // an in-place refresh (VS Code save, same study) must NOT yank the user off
  // the intro they were previewing back to a treatment (#485 review). Only when
  // the selected unit is gone (study swapped, or the researcher deleted it) do
  // we fall back to the host's landing selection.
  useEffect(() => {
    setSelectedUnitKey((prev) =>
      units.some((u) => u.key === prev)
        ? prev
        : initialUnitKey(units, selectedIntroIndex, selectedTreatmentIndex),
    );
  }, [treatmentFile, units, selectedIntroIndex, selectedTreatmentIndex]);
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

  // Restart at the first step whenever the selected unit changes, and give the
  // new unit a clean slate: submitted flags + elapsed time are keyed by numeric
  // stageIndex, so without clearing them an intro's submitted[0] would make the
  // treatment's first stage read as already-submitted (waiting overlay), and a
  // stale participant `position` could exceed the new unit's playerCount
  // (#485 review). The store wipe only fires on an actual unit switch — an
  // in-place refresh keeps the same key, so saved responses persist as before.
  useEffect(() => {
    setStageIndex(0);
    setPosition(0);
    store.clearAll();
  }, [selectedUnitKey, store]);

  // Subscribe to store changes so the UI re-renders.
  // The version is included in ctx memo deps below so that
  // StagebookProvider gets a new context value on store changes.
  const storeVersion = useSyncExternalStore(
    useCallback((cb: () => void) => store.onChange(cb), [store]),
    useCallback(() => store.getVersion(), [store]),
  );

  const currentStep = steps[stageIndex];
  const isSubmitted = store.getSubmitted(stageIndex);

  // Each unit declares its own locale (intro sequences run before treatment
  // assignment, so they carry their own); shown in the header so it's explicit.
  const locale = unit?.locale ?? "en";

  // Switching to a smaller unit (an intro is always 1 player; a treatment may
  // have fewer) can leave `position` past the new range for the render before
  // the unit-switch effect resets it. Clamp here so the position <select> never
  // shows a value with no matching option and the context never reports an
  // impossible participant index (#485 review).
  const playerCount = unit?.playerCount ?? 1;
  const clampedPosition = Math.min(position, Math.max(0, playerCount - 1));

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
        position: clampedPosition,
        stageIndex,
        playerCount,
        locale,
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
      clampedPosition,
      stageIndex,
      playerCount,
      locale,
      handleSubmit,
      getTextContent,
      getAssetURL,
      contentVersion,
    ],
  );

  // Host-owned navigation affordances (back to landing, refresh the preview).
  // Shared between the normal header and the empty-state header so neither
  // strands the user without a way back / a refresh after adding content.
  const hostControls = (
    <>
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
    </>
  );

  // Nothing to walk: a file with neither intro sequences nor treatments.
  // That's a valid empty-canvas / just-started state, not an error — so we
  // show a friendly placeholder rather than a blank screen or a crash. Keep
  // the header so back/refresh stay available — in VS Code you refresh here
  // after adding the first intro sequence or treatment (#485 review).
  if (units.length === 0) {
    return (
      <div style={layoutStyle}>
        <header style={headerStyle}>
          <div style={headerLeftStyle}>{hostControls}</div>
        </header>
        <div style={transitionPanelStyle}>
          <p data-testid="viewer-empty" style={transitionTextStyle}>
            Nothing to preview yet. Add an intro sequence or a treatment to this
            file and the walkthrough will appear here.
          </p>
        </div>
      </div>
    );
  }

  if (!unit || !currentStep) return null;

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
          {hostControls}
          {units.length > 1 ? (
            <select
              aria-label="Part to preview"
              title="Part of the study to preview"
              value={unit.key}
              onChange={(e) => {
                const key = e.target.value;
                setSelectedUnitKey(key);
                // Keep the host's persisted selection in sync so the VS Code
                // preview restores this unit (not the previous treatment) after
                // a refresh (#485 review).
                if (key.startsWith("treatment:")) {
                  onTreatmentIndexChange?.(
                    Number(key.slice("treatment:".length)),
                  );
                } else if (key.startsWith("intro:")) {
                  onIntroIndexChange?.(Number(key.slice("intro:".length)));
                }
              }}
              style={treatmentSelectStyle}
            >
              {introUnits.length > 0 && (
                <optgroup label="Intro sequences">
                  {introUnits.map((u) => (
                    <option key={u.key} value={u.key}>
                      {u.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Treatments">
                {treatmentUnits.map((u) => (
                  <option key={u.key} value={u.key}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            </select>
          ) : (
            <span style={treatmentNameStyle}>{unit.name}</span>
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
          {/* Read-only: the locale is whatever the current phase declares
              (intro sequence vs treatment) — explicit, never overridden. */}
          <span
            data-testid="viewer-locale-badge"
            title={`Locale declared by this ${unit.kind === "intro" ? "intro sequence" : "treatment"}`}
            style={localeBadgeStyle}
          >
            {locale}
          </span>
          <label htmlFor="position-select" style={positionLabelStyle}>
            Position
          </label>
          <select
            id="position-select"
            value={clampedPosition}
            onChange={(e) => setPosition(Number(e.target.value))}
            style={positionSelectStyle}
          >
            {Array.from({ length: playerCount }, (_, i) => (
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
            position={clampedPosition}
            playerCount={playerCount}
            onResetStage={handleResetStage}
          />
        </aside>

        {/* Main content */}
        <main
          ref={mainScrollRef}
          dir={isRTLLocale(locale) ? "rtl" : "ltr"}
          style={mainStyle}
        >
          {currentStep.isTransition ? (
            <div data-testid="viewer-transition" style={transitionPanelStyle}>
              <p style={transitionTextStyle}>{currentStep.transitionCopy}</p>
            </div>
          ) : isSubmitted ? (
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

const transitionPanelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: "60vh",
  padding: "2rem",
};

const transitionTextStyle: React.CSSProperties = {
  maxWidth: "32rem",
  textAlign: "center",
  fontSize: "0.9375rem",
  lineHeight: 1.6,
  color: "#4b5563",
  background: "#f9fafb",
  border: "1px dashed #d1d5db",
  borderRadius: "0.5rem",
  padding: "1.5rem 1.75rem",
};

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

const localeBadgeStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "#3730a3",
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  borderRadius: "0.25rem",
  padding: "0.0625rem 0.375rem",
  fontVariantNumeric: "tabular-nums",
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
