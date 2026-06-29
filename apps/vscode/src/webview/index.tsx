import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { TreatmentFileType } from "stagebook";
import { PreviewHost } from "stagebook-viewer/preview";

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

function createWebviewContentFns(webviewBaseUri: string) {
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
      const base = webviewBaseUri.endsWith("/")
        ? webviewBaseUri
        : webviewBaseUri + "/";
      return base + assetPath.replace(/^\/+/, "");
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
    () => createWebviewContentFns(webviewBaseUri),
    [webviewBaseUri, contentVersion],
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
    />
  );
}

// Mount
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
