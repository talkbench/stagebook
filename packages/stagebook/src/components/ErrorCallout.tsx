import React from "react";
import { useIsRTL, useMessages } from "./StagebookProvider.js";
import { focusOutlineCss } from "./focusRing.js";

export interface ErrorCalloutProps {
  /** Participant-facing explanation of the failure. */
  children: React.ReactNode;
  /** Optional short title, without imposing a page heading level. */
  title?: string;
  /** Optional plain-text diagnostic, collapsed initially. Never pass secrets. */
  details?: string;
  id?: string;
  dir?: "ltr" | "rtl" | "auto";
  "data-testid"?: string;
}

/**
 * A failure alert, usable without a StagebookProvider. The provider supplies
 * direction and the localized disclosure label when present. Character limits
 * and correctable field validation are separate from this failure treatment.
 */
export function ErrorCallout({
  children,
  title,
  details,
  id,
  dir,
  "data-testid": testId,
}: ErrorCalloutProps) {
  const isRTL = useIsRTL();
  const messages = useMessages();
  return (
    <div
      id={id}
      role="alert"
      dir={dir ?? (isRTL ? "rtl" : "ltr")}
      data-testid={testId}
      className="stagebook-error-callout"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "0.625rem",
        padding: "0.875rem 1rem",
        border: "1px solid var(--stagebook-danger-border, #fecaca)",
        borderRadius: "0.375rem",
        color: "var(--stagebook-danger, #b91c1c)",
        backgroundColor: "var(--stagebook-danger-bg, #fef2f2)",
        fontSize: "0.875rem",
        lineHeight: 1.5,
        overflowWrap: "anywhere",
        minWidth: 0,
      }}
    >
      <style>{`
        .stagebook-error-callout summary {
          cursor: pointer;
          box-sizing: border-box;
          min-height: var(--stagebook-row-min-height, 2.75rem);
          padding-block: 0.6875rem;
        }
        .stagebook-error-callout summary:focus-visible { ${focusOutlineCss()} }
      `}</style>
      <svg
        aria-hidden="true"
        focusable="false"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ flexShrink: 0, marginTop: "0.0625rem" }}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6M12 17h.01" />
      </svg>
      <div style={{ minWidth: 0, flex: 1 }}>
        {title && (
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>
            {title}
          </div>
        )}
        <div>{children}</div>
        {details && (
          <details style={{ marginTop: "0.25rem", fontSize: "0.75rem" }}>
            <summary>{messages.errorTechnicalDetails}</summary>
            <p dir="auto" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
              {details}
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
