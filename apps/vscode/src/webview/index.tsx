import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { TreatmentFileType } from "stagebook";
import { PreviewHost } from "stagebook/viewer";
import stagebookStyles from "stagebook/styles";
import { buildAssetURL } from "./resolveAsset.js";

// Declare the VS Code API injected by the webview
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

// --- Content functions via postMessage bridge ---

let requestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (value: string) => void; reject: (err: Error) => void }
>();

// Listen for responses from the extension host
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "treatment") {
    // Treatment data from extension host — handled by App state
    return;
  }
  if (msg.type === "fileContent") {
    const pending = pendingRequests.get(msg.requestId);
    if (pending) {
      pendingRequests.delete(msg.requestId);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.content);
      }
    }
  }
});

function createWebviewContentFns(
  webviewBaseUri: string,
  assetRoots: Record<string, string>,
) {
  const cache = new Map<string, Promise<string>>();

  return {
    getTextContent(path: string): Promise<string> {
      const cached = cache.get(path);
      if (cached) return cached;

      const id = requestId++;
      const promise = new Promise<string>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        vscode.postMessage({ type: "readFile", requestId: id, path });
      }).catch((err) => {
        cache.delete(path);
        throw err;
      }) as Promise<string>;

      cache.set(path, promise);
      return promise;
    },

    getAssetURL(assetPath: string): string {
      // Platform asset:// references resolve against the configured local
      // mounts (#192); an unmapped or unsafe one passes through unchanged so
      // the renderer shows the #191 placeholder rather than a broken URL.
      return buildAssetURL(assetPath, webviewBaseUri, assetRoots);
    },
  };
}

// --- App ---

function App() {
  const [treatmentFile, setTreatmentFile] = useState<TreatmentFileType | null>(
    null,
  );
  const [introIndex, setIntroIndex] = useState(0);
  const [treatmentIndex, setTreatmentIndex] = useState(0);
  const [webviewBaseUri, setWebviewBaseUri] = useState("");
  // #192: prefix → webview-URI base for each mounted asset root, plus the
  // discovered prefixes that have no mount yet (drive the picker card).
  // useState (not a fresh literal) keeps `assetRoots` referentially stable
  // between treatment messages, which matters for the contentFns memo.
  const [assetRoots, setAssetRoots] = useState<Record<string, string>>({});
  const [unmappedAssetPrefixes, setUnmappedAssetPrefixes] = useState<string[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  // Bumped on each treatment message so that `contentFns` is recreated
  // with a fresh cache, forcing prompt files to re-fetch from disk.
  const [contentVersion, setContentVersion] = useState(0);

  // Tracks whether we've received any `treatment` message yet. On the
  // first load we honor `msg.{treatment,intro}Index` (today always 0;
  // a future "open at cursor" command can send a non-zero starting
  // index). On subsequent refreshes we ignore those fields and
  // preserve the user's current picker selection.
  const hasReceivedTreatmentRef = useRef(false);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "treatment") {
        const incoming = msg.treatmentFile as TreatmentFileType;
        const isFirstLoad = !hasReceivedTreatmentRef.current;
        hasReceivedTreatmentRef.current = true;

        setTreatmentFile(incoming);
        // On first load: take msg.{treatment,intro}Index if provided.
        // On refresh: preserve the user's current picker selection.
        // Always clamp to the (new) bounds in case the researcher
        // edited the file to remove the previously-selected entry.
        setTreatmentIndex((prev) => {
          const desired = isFirstLoad
            ? ((msg.treatmentIndex as number | undefined) ?? prev)
            : prev;
          // `treatments` is optional in the schema (an intro-only file is a
          // valid mid-development state) — guard the bound so a refresh of
          // such a file doesn't crash (#476).
          return Math.min(
            desired,
            Math.max(0, (incoming.treatments?.length ?? 1) - 1),
          );
        });
        setIntroIndex((prev) => {
          const desired = isFirstLoad
            ? ((msg.introIndex as number | undefined) ?? prev)
            : prev;
          return Math.min(
            desired,
            Math.max(0, (incoming.introSequences?.length ?? 1) - 1),
          );
        });
        setWebviewBaseUri(msg.webviewBaseUri ?? "");
        setAssetRoots(
          (msg.assetRoots as Record<string, string> | undefined) ?? {},
        );
        setUnmappedAssetPrefixes(
          (msg.unmappedAssetPrefixes as string[] | undefined) ?? [],
        );
        setContentVersion((v) => v + 1);
        setError(null);
      } else if (msg.type === "error") {
        setError(msg.message);
        setTreatmentFile(null);
      }
    };
    window.addEventListener("message", handler);

    // Tell the extension host we're ready
    vscode.postMessage({ type: "ready" });

    return () => window.removeEventListener("message", handler);
  }, []);

  // `contentVersion` is deliberately part of the deps so a refresh creates
  // a fresh cache — forcing prompt files to re-fetch from disk.
  const contentFns = useMemo(
    () => createWebviewContentFns(webviewBaseUri, assetRoots),
    [webviewBaseUri, assetRoots, contentVersion],
  );

  if (error) {
    return (
      <div style={{ padding: "2rem", color: "#ef4444" }}>
        <h2>Preview Error</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!treatmentFile) {
    return (
      <div style={{ padding: "2rem", color: "#6b7280" }}>
        <p>Loading treatment preview...</p>
      </div>
    );
  }

  return (
    <PreviewHost
      treatmentFile={treatmentFile}
      getTextContent={contentFns.getTextContent}
      getAssetURL={contentFns.getAssetURL}
      selectedIntroIndex={introIndex}
      selectedTreatmentIndex={treatmentIndex}
      onTreatmentIndexChange={setTreatmentIndex}
      onIntroIndexChange={setIntroIndex}
      onRefresh={() => vscode.postMessage({ type: "refresh" })}
      contentVersion={contentVersion}
      hostNotice={
        unmappedAssetPrefixes.length > 0 ? (
          <AssetMountCard
            prefixes={unmappedAssetPrefixes}
            onPick={(prefix) =>
              vscode.postMessage({ type: "pickAssetFolder", prefix })
            }
          />
        ) : undefined
      }
    />
  );
}

// --- Asset-mount picker card (#192) ---
//
// A NON-BLOCKING notice rendered above the live preview (via PreviewHost's
// `hostNotice` → Viewer's `notice` slot) listing every `asset://<prefix>/…`
// reference with no local mount yet. Each row's button asks the extension to
// open a folder picker for that prefix; the preview keeps rendering (unmapped
// assets show the #191 placeholder) rather than gating on the pick.
//
// vscode-webview-only: local mounting is meaningless in the browser viewer or
// TalkBench, so this lives here, not in the shared harness. Colors match the
// preview's light chrome (cf. the locale-mismatch banner) rather than the
// editor theme, since the preview emulates the participant experience.
function AssetMountCard({
  prefixes,
  onPick,
}: {
  prefixes: string[];
  onPick: (prefix: string) => void;
}) {
  return (
    <div data-testid="asset-mount-card" role="region" style={cardWrapStyle}>
      <strong style={cardTitleStyle}>
        {prefixes.length === 1
          ? "1 asset folder isn't mapped"
          : `${prefixes.length} asset folders aren't mapped`}
      </strong>
      <p style={cardSubtitleStyle}>
        These <code style={codeChipStyle}>asset://</code> references point at
        files on your machine. Choose a local folder for each prefix to preview
        its media — until then a placeholder is shown. Your choice is remembered
        for this workspace and is never written to the study.
      </p>
      <ul style={cardListStyle}>
        {prefixes.map((prefix) => (
          <li key={prefix} style={cardRowStyle}>
            <code style={cardPrefixStyle}>asset://{prefix}/</code>
            <button
              type="button"
              style={cardButtonStyle}
              onClick={() => onPick(prefix)}
            >
              Choose folder…
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const cardWrapStyle: React.CSSProperties = {
  padding: "0.75rem 1rem",
  borderBottom: "1px solid #bfdbfe",
  backgroundColor: "#eff6ff",
  color: "#1e3a8a",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.875rem",
};

const cardTitleStyle: React.CSSProperties = {
  fontWeight: 600,
};

const cardSubtitleStyle: React.CSSProperties = {
  margin: "0.25rem 0 0.5rem",
  color: "#1e40af",
};

const cardListStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const cardRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.75rem",
  flexWrap: "wrap",
};

// `<code>` chips in the webview's own chrome. The extension used to style bare
// `<code>` globally; that rule was removed with the hand-copied CSS (#560), and
// styles.css has no bare `code` rule (library code styling is inline in the
// Markdown component), so this chrome must style its own chips.
const codeChipStyle: React.CSSProperties = {
  fontFamily: "monospace",
  backgroundColor: "rgba(0, 0, 0, 0.06)",
  // Inherit the card's text color rather than VS Code's amber `code` default.
  color: "inherit",
  padding: "0.125rem 0.25rem",
  borderRadius: "0.25rem",
};

const cardPrefixStyle: React.CSSProperties = {
  ...codeChipStyle,
  fontSize: "0.8125rem",
};

const cardButtonStyle: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  border: "none",
  // Accent token (fallback = blue-600) so this webview chrome tracks the
  // palette instead of pinning the retired blue-500.
  backgroundColor: "var(--stagebook-primary, #2563eb)",
  color: "#ffffff",
  cursor: "pointer",
  fontSize: "0.8125rem",
  fontWeight: 500,
  whiteSpace: "nowrap",
};

// Render previewed components with stagebook's REAL stylesheet: inject the
// library's styles.css (bundled as text) so every token + reset comes from the
// library itself, never a hand-maintained copy in the extension that can drift
// from what participants actually see. The preview is a development inspection
// surface — it must mirror the library exactly (#560). Injected before mount so
// tokens are present when components render. The @font-face is stripped: its
// relative asset URL can't resolve in the webview, so Inter falls back to the
// system stack (as it already did); wiring the bundled font via asWebviewUri is
// a follow-up.
const stagebookStyleEl = document.createElement("style");
stagebookStyleEl.dataset.stagebookStyles = "";
stagebookStyleEl.textContent = stagebookStyles.replace(
  /@font-face\s*\{[^}]*\}/g,
  "",
);
document.head.appendChild(stagebookStyleEl);

// Mount
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
