import React from "react";
import { Loading } from "../form/Loading.js";
import { useMessages, useIsRTL } from "../StagebookProvider.js";

export interface SubmissionConditionalRenderProps {
  isSubmitted: boolean;
  playerCount: number | undefined;
  children: React.ReactNode;
}

export function SubmissionConditionalRender({
  isSubmitted,
  playerCount,
  children,
}: SubmissionConditionalRenderProps) {
  const messages = useMessages();
  const isRTL = useIsRTL();
  if (isSubmitted) {
    if (!playerCount || playerCount <= 1) {
      return (
        <div
          data-testid="submission-state"
          data-state="loading"
          style={{ textAlign: "center" }}
        >
          <Loading />
        </div>
      );
    }
    return (
      <div
        data-testid="submission-state"
        data-state="waiting"
        dir={isRTL ? "rtl" : "ltr"}
        style={{ textAlign: "center", color: "#9ca3af", pointerEvents: "none" }}
      >
        {messages.submissionWaiting}
      </div>
    );
  }

  return <>{children}</>;
}
