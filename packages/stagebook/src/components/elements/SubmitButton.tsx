import React from "react";
import { Button } from "../form/Button.js";
import { useMessages } from "../StagebookProvider.js";

export interface SubmitButtonProps {
  onSubmit: () => void;
  name: string;
  buttonText?: string;
  save: (key: string, value: unknown) => void;
}

export function SubmitButton({
  onSubmit,
  name,
  buttonText,
  save,
}: SubmitButtonProps) {
  const messages = useMessages();
  // Researcher-set `buttonText` wins in any locale; otherwise the active
  // locale's default (never an English default under a non-English locale).
  const label = buttonText ?? messages.submitButtonDefault;

  const handleClick = () => {
    save(`submitButton_${name}`, {});
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
