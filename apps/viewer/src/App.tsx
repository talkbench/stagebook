import { useState, useCallback, useEffect, useRef } from "react";
import type { TreatmentFileType } from "stagebook";
import {
  PreviewHost,
  createUrlContentFns,
  type TaskParameterSource,
} from "stagebook/viewer";
import { loadTreatmentFromUrl } from "./lib/loader";
import type { ViewerDiagnostic } from "./lib/diagnostics";
import { needsOverviewPicker } from "./lib/selection";
import {
  exampleCatalog,
  createExampleContentFns,
  prepareExampleTreatment,
  type ExampleEntry,
} from "./lib/exampleCatalog";
import { LandingPage } from "./components/LandingPage";
import { OverviewPage } from "./components/OverviewPage";
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
      taskParameters: TaskParameterSource | null;
    }
  | {
      phase: "viewing";
      treatmentFile: TreatmentFileType;
      contentFns: ContentFns;
      selectedIntroIndex: number;
      selectedTreatmentIndex: number;
      diagnostics: ViewerDiagnostic[];
      // A task file the example ships (#815), preloaded into the preview.
      taskParameters: TaskParameterSource | null;
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
      taskParameters: TaskParameterSource | null = null,
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
          taskParameters,
        });
      } else {
        setState({
          phase: "viewing",
          treatmentFile,
          contentFns,
          selectedIntroIndex: 0,
          selectedTreatmentIndex: 0,
          diagnostics,
          taskParameters,
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
          entry.taskParameters === undefined
            ? null
            : { name: "tasks.json", text: entry.taskParameters },
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
      const {
        treatmentFile,
        contentFns,
        readmeContent,
        diagnostics,
        taskParameters,
      } = state;
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
                taskParameters,
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
            initialTaskParameters={state.taskParameters}
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
 *
 * Also holds the local task parameter file (#815). A browser can't re-read a
 * picked file after it changes on disk, so choosing the file again is how its
 * edits come in: that keeps the selected task, while choosing a file with a
 * different name starts over.
 */
function ViewingPhase({
  treatmentFile,
  contentFns,
  selectedIntroIndex,
  selectedTreatmentIndex,
  initialTaskParameters,
  onBack,
}: {
  treatmentFile: TreatmentFileType;
  contentFns: ContentFns;
  selectedIntroIndex: number;
  selectedTreatmentIndex: number;
  initialTaskParameters: TaskParameterSource | null;
  onBack: () => void;
}) {
  const [taskParameterSource, setTaskParameterSource] =
    useState<TaskParameterSource | null>(initialTaskParameters);
  const [taskParameterKey, setTaskParameterKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadTaskParameterFile = async (file: File) => {
    let source: TaskParameterSource;
    try {
      source = { name: file.name, text: await file.text() };
    } catch (err) {
      source = {
        name: file.name,
        readError: err instanceof Error ? err.message : String(err),
      };
    }
    if (source.name !== taskParameterSource?.name) setTaskParameterKey(null);
    setTaskParameterSource(source);
  };

  return (
    <>
      <PreviewHost
        treatmentFile={treatmentFile}
        getTextContent={contentFns.getTextContent}
        getAssetURL={contentFns.getAssetURL}
        selectedIntroIndex={selectedIntroIndex}
        selectedTreatmentIndex={selectedTreatmentIndex}
        onBack={onBack}
        taskParameters={{
          source: taskParameterSource,
          selectedKey: taskParameterKey,
          onSelect: setTaskParameterKey,
          onLoad: () => fileInputRef.current?.click(),
          onClear: () => {
            setTaskParameterSource(null);
            setTaskParameterKey(null);
          },
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="task-parameter-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so choosing the same file again (after editing it) fires
          // another change.
          e.target.value = "";
          if (file) void loadTaskParameterFile(file);
        }}
      />
    </>
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
  // Accent token (fallback = blue-600) so app chrome tracks the palette.
  backgroundColor: "var(--stagebook-primary, #2563eb)",
  color: "white",
  cursor: "pointer",
  fontSize: "0.875rem",
};
