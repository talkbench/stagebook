import React from "react";
import { Button } from "../form/Button.js";
import { useMessages } from "../StagebookProvider.js";

export interface SubmitButtonProps {
  onSubmit: () => void;
  name: string;
  buttonText?: string;
  save: (key: string, value: unknown) => void;
  /** Stage clock for the saved `time`; always supplied by Element. */
  getElapsedTime?: () => number;
}

export function SubmitButton({
  onSubmit,
  name,
  buttonText,
  save,
  getElapsedTime,
}: SubmitButtonProps) {
  const messages = useMessages();
  // Researcher-set `buttonText` wins in any locale; otherwise the active
  // locale's default (never an English default under a non-English locale).
  const label = buttonText ?? messages.submitButtonDefault;

  const handleClick = () => {
    save(
      `submitButton_${name}`,
      getElapsedTime ? { time: getElapsedTime() } : {},
    );
    onSubmit();
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      <Button onClick={handleClick} data-testid="submitButton">
        {label}
      </Button>
    </div>
  );
}
