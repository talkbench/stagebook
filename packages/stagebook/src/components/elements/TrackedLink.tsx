import React, { useCallback, useEffect, useId, useMemo, useRef } from "react";

function ExternalLinkIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M11.5 2a.75.75 0 0 0 0 1.5h3.19L9.97 8.22a.75.75 0 1 0 1.06 1.06l4.72-4.72v3.19a.75.75 0 0 0 1.5 0V2.75A.75.75 0 0 0 16.5 2h-5z" />
      <path d="M5.25 4A2.25 2.25 0 0 0 3 6.25v8.5A2.25 2.25 0 0 0 5.25 17h8.5A2.25 2.25 0 0 0 16 14.75V11.5a.75.75 0 0 0-1.5 0v3.25c0 .414-.336.75-.75.75h-8.5a.75.75 0 0 1-.75-.75v-8.5c0-.414.336-.75.75-.75H9.5a.75.75 0 0 0 0-1.5H5.25z" />
    </svg>
  );
}

export interface ResolvedParam {
  key: string;
  value: string;
}

export interface TrackedLinkProps {
  name: string;
  url: string;
  displayText: string;
  helperText?: string;
  resolvedParams?: ResolvedParam[];
  save: (key: string, value: unknown) => void;
  getElapsedTime: () => number;
  progressLabel: string;
  setAllowIdle?: (allow: boolean) => void;
}

const DEFAULT_HELPER_TEXT =
  "Link opens in a new tab. Return to this tab to complete the study.";

interface LinkEvent {
  type: string;
  timestamp: number;
  stage: string;
  stageTimeSeconds: number;
  timeAwaySeconds?: number;
}

interface LinkRecord {
  name: string;
  url: string;
  displayText: string;
  events: LinkEvent[];
  totalTimeAwaySeconds: number;
  lastEventType?: string;
  lastTimeAwaySeconds?: number;
  lastUpdated?: number;
}

export function TrackedLink({
  name,
  url,
  displayText,
  helperText,
  resolvedParams = [],
  save,
  getElapsedTime,
  progressLabel,
  setAllowIdle,
}: TrackedLinkProps) {
  const resolvedHelperText = helperText ?? DEFAULT_HELPER_TEXT;
  const awayTrackerRef = useRef<{ startedAt: number; clickAt: number } | null>(
    null,
  );
  const lastClickRef = useRef<number | null>(null);
  const recordRef = useRef<LinkRecord>({
    name,
    url,
    displayText,
    events: [],
    totalTimeAwaySeconds: 0,
  });
  const recordKey = `trackedLink_${name}`;

  const buildEvent = useCallback(
    (type: string, extra: Record<string, unknown> = {}): LinkEvent => ({
      type,
      timestamp: Date.now(),
      stage: progressLabel,
      stageTimeSeconds: getElapsedTime(),
      ...extra,
    }),
    [getElapsedTime, progressLabel],
  );

  const logEvent = useCallback(
    (type: string, extra?: Record<string, unknown>) => {
      const event = buildEvent(type, extra);
      const prev = recordRef.current;
      const updatedEvents = [...prev.events, event];
      const totalTimeAwaySeconds =
        prev.totalTimeAwaySeconds + (event.timeAwaySeconds ?? 0);

      const updated: LinkRecord = {
        ...prev,
        events: updatedEvents,
        lastEventType: event.type,
        lastTimeAwaySeconds: event.timeAwaySeconds ?? prev.lastTimeAwaySeconds,
        totalTimeAwaySeconds,
        lastUpdated: event.timestamp,
      };
      recordRef.current = updated;
      save(recordKey, updated);
    },
    [buildEvent, recordKey, save],
  );

  const href = useMemo(() => {
    if (!resolvedParams.length) return url;
    const params = new URLSearchParams();
    resolvedParams.forEach(({ key, value }) => {
      params.append(key, value ?? "");
    });
    const queryString = params.toString();
    if (!queryString) return url;
    return url.includes("?")
      ? `${url}&${queryString}`
      : `${url}?${queryString}`;
  }, [resolvedParams, url]);

  const handleClick = useCallback(() => {
    lastClickRef.current = Date.now();
    logEvent("click");
  }, [logEvent]);

  const handleBlur = useCallback(() => {
    if (awayTrackerRef.current || !lastClickRef.current) return;
    awayTrackerRef.current = {
      startedAt: Date.now(),
      clickAt: lastClickRef.current,
    };
    lastClickRef.current = null;
    setAllowIdle?.(true);
    logEvent("blur");
  }, [logEvent, setAllowIdle]);

  const handleFocus = useCallback(() => {
    const awayContext = awayTrackerRef.current;
    if (awayContext) {
      awayTrackerRef.current = null;
      const timeAwaySeconds = (Date.now() - awayContext.startedAt) / 1000;
      logEvent("focus", { timeAwaySeconds });
    } else {
      logEvent("focus");
    }
    setAllowIdle?.(false);
  }, [logEvent, setAllowIdle]);

  useEffect(() => {
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, [handleBlur, handleFocus]);

  // Per-instance class for the hover / :focus-visible rules. Same
  // useId pattern as Button / Slider / Timeline. State-dependent
  // properties (hover color shift, focus ring) live in a scoped
  // <style> block so the inline structural styles can't block them.
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, "");
  const linkClass = `stagebook-trackedlink-${safeId}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      <style>{`
        /* Base color + hover color both live in CSS (not inline) so
           the hover rule can actually win — an inline color would
           outrank the :hover class selector on specificity (same
           trap as Slider / Button / TextArea). */
        .${linkClass} {
          color: var(--stagebook-primary, #3b82f6);
          transition: color 120ms ease-out;
        }
        .${linkClass}:hover {
          color: var(--stagebook-primary-hover, #2563eb);
        }
        /* :focus-visible (keyboard-only) ring. Mouse clicks don't
           leave a lingering ring around the link after release. */
        .${linkClass}:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25));
          border-radius: 0.125rem;
        }
        @media (prefers-reduced-motion: reduce) {
          .${linkClass} {
            transition: none;
          }
        }
      `}</style>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={handleClick}
        className={linkClass}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          fontWeight: 600,
          // Underline the visible text so the link still reads as
          // a link without relying on color alone (WCAG 1.4.1).
          // Applied to the <a> itself, not the icon — the
          // ExternalLinkIcon is decorative chrome.
          textDecoration: "none",
        }}
      >
        <span style={{ textDecoration: "underline" }}>{displayText}</span>
        <ExternalLinkIcon />
      </a>
      {resolvedHelperText && (
        <p
          style={{
            fontSize: "0.75rem",
            color: "var(--stagebook-text-muted, #6b7280)",
            margin: 0,
          }}
        >
          {resolvedHelperText}
        </p>
      )}
    </div>
  );
}
