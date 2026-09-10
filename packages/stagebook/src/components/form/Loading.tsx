import React, { useId } from "react";
import { useMessages, useIsRTL } from "../StagebookProvider.js";

export interface LoadingProps {
  size?: "sm" | "md" | "lg";
}

const sizeMap = {
  sm: 16,
  md: 20,
  lg: 32,
};

export function Loading({ size = "md" }: LoadingProps) {
  const px = sizeMap[size];
  const messages = useMessages();
  const isRTL = useIsRTL();
  const id = useId();
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "");
  const loadingClass = `stagebook-loading-${safeId}`;

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        role="img"
        aria-label={messages.loadingLabel}
        className={`${loadingClass}-spinner`}
      >
        {/* Track — full circle, light gray */}
        <circle
          cx="12"
          cy="12"
          r="10"
          style={{ stroke: "var(--stagebook-spinner-track, #e5e7eb)" }}
          strokeWidth="3"
          fill="none"
        />
        {/* Spinning arc — quarter circle on the same path */}
        <circle
          cx="12"
          cy="12"
          r="10"
          style={{ stroke: "var(--stagebook-spinner-arc, #9ca3af)" }}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="15.7 47.1"
        />
      </svg>
      {/* The SVG already supplies the accessible name. This visible copy
          explains the static indicator without announcing the label twice. */}
      <span
        className={`${loadingClass}-text`}
        aria-hidden="true"
        style={{
          marginInlineStart: "0.5rem",
          color: "var(--stagebook-text, #1f2937)",
          fontFamily:
            'var(--stagebook-font, "Inter", ui-sans-serif, system-ui, sans-serif)',
          fontSize: "0.875rem",
          lineHeight: "1.25rem",
        }}
      >
        {messages.loadingLabel}
      </span>
      <style>{`
        .${loadingClass}-spinner {
          animation: stagebook-spin 0.75s linear infinite;
        }
        .${loadingClass}-text {
          display: none;
        }
        @media (prefers-reduced-motion: reduce) {
          .${loadingClass}-spinner {
            animation: none;
          }
          .${loadingClass}-text {
            display: inline;
          }
        }
        @keyframes stagebook-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
