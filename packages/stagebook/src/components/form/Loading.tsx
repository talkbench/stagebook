import React from "react";
import { useMessages } from "../StagebookProvider.js";

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

  return (
    <div
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
        aria-label={messages.loadingLabel}
        style={{
          animation: "stagebook-spin 0.75s linear infinite",
        }}
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
      <style>{`
        @keyframes stagebook-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
