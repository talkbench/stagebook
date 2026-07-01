import { useState, useCallback, useEffect, useRef } from "react";
import type { TreatmentFileType } from "stagebook";
import { loadTreatmentFromUrl } from "./lib/loader";
import type { ViewerDiagnostic } from "./lib/diagnostics";
import { createUrlContentFns } from "./lib/contentFns";
import { needsOverviewPicker } from "./lib/selection";
import {
  exampleCatalog,
  createExampleContentFns,
  prepareExampleTreatment,
  type ExampleEntry,
} from "./lib/exampleCatalog";
import { LandingPage } from "./components/LandingPage";
import { OverviewPage } from "./components/OverviewPage";
import { PreviewHost } from "./components/PreviewHost";
import {
  DiagnosticsDrawer,
  DiagnosticsList,
} from "./components/DiagnosticsPanel";

type ContentFns = ReturnType<typeof createUrlContentFns>;

type AppState =
  | { phase: "landing" }
  | { phase: "loading"; url: string }
  | {
      phase: "overview";
      treatmentFile: TreatmentFileType;
      contentFns: ContentFns;
      readmeContent: string | null;
      diagnostics: ViewerDiagnostic[];
    }
  | {
      phase: "viewing";
      treatmentFile: TreatmentFileType;
      contentFns: ContentFns;
      selectedIntroIndex: number;
      selectedTreatmentIndex: number;
      diagnostics: ViewerDiagnostic[];
    }
  | {
      // File has errors that prevent rendering — show a placeholder plus the
      // diagnostics that caused it (#440).
      phase: "unrenderable";
      diagnostics: ViewerDiagnostic[];
      url?: string;
    }
  | {
      phase: "error";
      message: string;
      url?: string;
    };

export function App() {
  const [state, setState] = useState<AppState>({ phase: "landing" });

  // Monotonic token — incremented on every load request so a slower README
  // fetch from an earlier click can't overwrite state set by a later one.
  const loadSeqRef = useRef(0);

  const enterTreatment = useCallback(
    async (
      treatmentFile: TreatmentFileType,
      contentFns: ContentFns,
      seq: number,
      diagnostics: ViewerDiagnostic[],
    ) => {
      const readmeContent = await contentFns
        .getTextContent("README.md")
        .catch(() => null);
      // A newer load started while we were awaiting README — drop this one.
      if (seq !== loadSeqRef.current) return;

      const needsPicker = needsOverviewPicker(treatmentFile);

      if (needsPicker || readmeContent !== null) {
        setState({
          phase: "overview",
          treatmentFile,
          contentFns,
          readmeContent,
          diagnostics,
        });
      } else {
        setState({
          phase: "viewing",
          treatmentFile,
          contentFns,
          selectedIntroIndex: 0,
          selectedTreatmentIndex: 0,
          diagnostics,
        });
      }
    },
    [],
  );

  const handleLoad = useCallback(
    async (url: string) => {
      const seq = ++loadSeqRef.current;
      setState({ phase: "loading", url });
      try {
        const { treatmentFile, diagnostics, rawBaseUrl } =
          await loadTreatmentFromUrl(url);
        if (seq !== loadSeqRef.current) return;
        if (treatmentFile === null) {
          setState({ phase: "unrenderable", diagnostics, url });
          return;
        }
        await enterTreatment(
          treatmentFile,
          createUrlContentFns(rawBaseUrl),
          seq,
          diagnostics,
        );
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
          url,
        });
      }
    },
    [enterTreatment],
  );

  const handleLoadExample = useCallback(
    async (entry: ExampleEntry) => {
      const seq = ++loadSeqRef.current;
      try {
        const treatmentFile = prepareExampleTreatment(entry);
        // Bundled examples are curated and validated in CI, so they carry no
        // load-time diagnostics.
        await enterTreatment(
          treatmentFile,
          createExampleContentFns(entry),
          seq,
          [],
        );
      } catch (err) {
        if (seq !== loadSeqRef.current) return;
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [enterTreatment],
  );

  // Auto-load from ?url= parameter
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("url");
    if (url && state.phase === "landing") {
      handleLoad(url);
    }
  }, [handleLoad, state.phase]);

  switch (state.phase) {
    case "landing":
      return (
        <LandingPage
          onLoad={handleLoad}
          examples={exampleCatalog}
          onLoadExample={handleLoadExample}
        />
      );

    case "loading":
      return <LoadingScreen url={state.url} />;

    case "error":
      return (
        <ErrorScreen
          message={state.message}
          onRetry={state.url ? () => handleLoad(state.url!) : undefined}
          onBack={() => setState({ phase: "landing" })}
        />
      );

    case "unrenderable":
      return (
        <UnrenderableScreen
          diagnostics={state.diagnostics}
          onRetry={state.url ? () => handleLoad(state.url!) : undefined}
          onBack={() => setState({ phase: "landing" })}
        />
      );

    case "overview": {
      const { treatmentFile, contentFns, readmeContent, diagnostics } = state;
      return (
        <>
          <OverviewPage
            treatmentFile={treatmentFile}
            readmeContent={readmeContent}
            onBack={() => setState({ phase: "landing" })}
            onSelect={(introIndex, treatmentIndex) => {
              setState({
                phase: "viewing",
                treatmentFile,
                contentFns,
                selectedIntroIndex: introIndex,
                selectedTreatmentIndex: treatmentIndex,
                diagnostics,
              });
            }}
          />
          <DiagnosticsDrawer diagnostics={diagnostics} />
        </>
      );
    }

    case "viewing":
      return (
        <>
          <ViewingPhase
            treatmentFile={state.treatmentFile}
            contentFns={state.contentFns}
            selectedIntroIndex={state.selectedIntroIndex}
            selectedTreatmentIndex={state.selectedTreatmentIndex}
            onBack={() => setState({ phase: "landing" })}
          />
          <DiagnosticsDrawer diagnostics={state.diagnostics} />
        </>
      );
  }
}

/**
 * Wrapper component for the viewing phase — enables useMemo for
 * stable content function references (can't use hooks in switch cases).
 */
function ViewingPhase({
  treatmentFile,
  contentFns,
  selectedIntroIndex,
  selectedTreatmentIndex,
  onBack,
}: {
  treatmentFile: TreatmentFileType;
  contentFns: ContentFns;
  selectedIntroIndex: number;
  selectedTreatmentIndex: number;
  onBack: () => void;
}) {
  return (
    <PreviewHost
      treatmentFile={treatmentFile}
      getTextContent={contentFns.getTextContent}
      getAssetURL={contentFns.getAssetURL}
      selectedIntroIndex={selectedIntroIndex}
      selectedTreatmentIndex={selectedTreatmentIndex}
      onBack={onBack}
    />
  );
}

function LoadingScreen({ url }: { url: string }) {
  return (
    <div style={centeredStyle}>
      <p style={{ color: "#6b7280" }}>Loading treatment file...</p>
      <p style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>
        {url}
      </p>
    </div>
  );
}

/**
 * Terminal failure that isn't a file-content problem — a network error, a
 * bad URL, or a failed import fetch. Shows the raw message.
 */
function ErrorScreen({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry?: () => void;
  onBack: () => void;
}) {
  return (
    <div style={centeredStyle}>
      <div style={{ maxWidth: "36rem", width: "100%", padding: "2rem" }}>
        <p style={{ color: "#ef4444", fontWeight: 600 }}>Failed to load</p>
        <p
          style={{
            color: "#6b7280",
            fontSize: "0.875rem",
            marginTop: "0.5rem",
            wordBreak: "break-word",
          }}
        >
          {message}
        </p>
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          {onRetry && (
            <button onClick={onRetry} style={buttonStyle}>
              Retry
            </button>
          )}
          <button
            onClick={onBack}
            style={{ ...buttonStyle, backgroundColor: "#6b7280" }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The file loaded but has validation errors that prevent rendering (YAML
 * syntax, schema violations). Shows a placeholder plus the diagnostics that
 * caused it — the same diagnostics the VS Code extension would flag (#440).
 */
function UnrenderableScreen({
  diagnostics,
  onRetry,
  onBack,
}: {
  diagnostics: ViewerDiagnostic[];
  onRetry?: () => void;
  onBack: () => void;
}) {
  return (
    <div style={centeredStyle}>
      <div style={{ maxWidth: "40rem", width: "100%", padding: "2rem" }}>
        <p style={{ color: "#ef4444", fontWeight: 600 }}>
          This file can’t be previewed until the problems below are fixed
        </p>
        <p
          style={{
            color: "#6b7280",
            fontSize: "0.875rem",
            margin: "0.5rem 0 0.75rem",
          }}
        >
          {diagnostics.length === 1
            ? "1 problem found:"
            : `${diagnostics.length} problems found:`}
        </p>
        <DiagnosticsList diagnostics={diagnostics} />
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          {onRetry && (
            <button onClick={onRetry} style={buttonStyle}>
              Retry
            </button>
          )}
          <button
            onClick={onBack}
            style={{ ...buttonStyle, backgroundColor: "#6b7280" }}
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}

const centeredStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  height: "100vh",
};

const buttonStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderRadius: "0.375rem",
  border: "none",
  backgroundColor: "#3b82f6",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
};
