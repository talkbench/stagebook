import React, { useEffect, useMemo, useRef } from "react";

export interface ResolvedParam {
  key: string;
  value: string;
}

export interface QualtricsProps {
  url: string;
  resolvedParams?: ResolvedParam[];
  /**
   * The anonymized, release-safe participant id (#473). Appended to the
   * survey URL as `stableParticipantId` so Qualtrics responses can be linked
   * back to the participant's exported data. Sourced from
   * `attributes.stableParticipantId` — NOT the internal `playerId`. (Replaces
   * the legacy `deliberationId` URL param; Qualtrics surveys must read the
   * embedded data field `stableParticipantId`.)
   */
  stableParticipantId?: string;
  /**
   * The per-assignment data-row id (#473), appended as `sampleId`. Absent
   * until the game phase, so it may be empty.
   */
  sampleId?: string;
  /**
   * Telemetry hook (#473) fired when `stableParticipantId` is empty — i.e.
   * this survey would launch without participant linkage, silently
   * orphaning the response. This is the one place stagebook consumes the id,
   * so it's the one place the missing-id contract is checked (lazily, at use,
   * not eagerly at mount). Notification only — the survey still renders.
   */
  onContractViolation?: (info: {
    kind: "missingStableParticipantId";
    message: string;
  }) => void;
  save: (key: string, value: unknown) => void;
  onComplete: () => void;
}

export function Qualtrics({
  url,
  resolvedParams = [],
  stableParticipantId = "",
  sampleId = "",
  onContractViolation,
  save,
  onComplete,
}: QualtricsProps) {
  // Trim before any presence test so behavior matches `hasStableParticipantId`
  // (a whitespace-only id counts as absent). The trimmed values are what we
  // both check and append, so the contract warning and the outbound URL stay
  // consistent.
  const trimmedStableId = stableParticipantId.trim();
  const trimmedSampleId = sampleId.trim();

  // The contract check for `stableParticipantId` lives here, not at provider
  // mount: a Qualtrics survey always wants the `stableParticipantId` URL param
  // to link its response back to the participant, so an empty id is a real
  // (silent) data loss. Surface it loudly. Studies without Qualtrics never hit
  // this.
  useEffect(() => {
    if (trimmedStableId) return;
    const message =
      "Stagebook: a Qualtrics survey is rendering without a " +
      "stableParticipantId, so its response will not carry the " +
      "stableParticipantId link back to the participant. The host must populate " +
      "`attributes.stableParticipantId` before reaching a Qualtrics stage.";
    console.error(message);
    onContractViolation?.({ kind: "missingStableParticipantId", message });
  }, [trimmedStableId, onContractViolation]);
  // Ref unstable callbacks so the listener-registration effect below
  // doesn't tear down and re-add on every parent re-render (#105).
  const saveRef = useRef(save);
  saveRef.current = save;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const urlRef = useRef(url);
  urlRef.current = url;

  // Listen for Qualtrics end-of-survey message.
  // Validates origin to prevent spoofed messages from non-Qualtrics sources.
  // Checks *.qualtrics.com to handle datacenter redirects.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Validate origin — only accept messages from Qualtrics domains
      try {
        const originHost = new URL(event.origin).hostname;
        if (!originHost.endsWith("qualtrics.com")) return;
      } catch {
        return;
      }

      const data: unknown = event.data;
      if (typeof data === "string" && data.startsWith("QualtricsEOS")) {
        const [, surveyId, sessionId] = data.split("|");
        saveRef.current("qualtricsDataReady", {
          surveyURL: urlRef.current,
          surveyId,
          sessionId,
        });
        onCompleteRef.current();
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Build the full URL with resolved params + standard identifiers
  const fullURL = useMemo(() => {
    const urlObj = new URL(url);
    resolvedParams.forEach(({ key, value }) =>
      urlObj.searchParams.append(key, value),
    );
    if (trimmedStableId) {
      urlObj.searchParams.append("stableParticipantId", trimmedStableId);
    }
    if (trimmedSampleId) {
      urlObj.searchParams.append("sampleId", trimmedSampleId);
    }
    return urlObj.toString();
  }, [url, resolvedParams, trimmedStableId, trimmedSampleId]);

  return (
    <div
      style={{
        height: "100%",
        minWidth: "800px",
        maxWidth: "56rem",
        overflowX: "auto",
      }}
    >
      <iframe
        title={`qualtrics_${url}`}
        src={fullURL}
        style={{
          position: "relative",
          height: "100%",
          minHeight: "100vh",
          width: "100%",
          border: "none",
        }}
      />
    </div>
  );
}
