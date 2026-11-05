import React, { useRef, useState } from "react";
import { Button } from "../form/Button.js";
import { RadioGroup } from "../form/RadioGroup.js";
import { CheckboxGroup } from "../form/CheckboxGroup.js";
import type { PointerStats } from "../../utils/pointerTelemetry.js";

/** Observe the snapshot available synchronously at the existing action. */
export function PointerControlsHarness({
  control,
  disabled = false,
}: {
  control: "button" | "radio" | "checkbox";
  disabled?: boolean;
}) {
  const current = useRef<PointerStats | null>(null);
  const [history, setHistory] = useState<(PointerStats | null)[]>([]);
  const [radioValue, setRadioValue] = useState<string>();
  const [checkboxValue, setCheckboxValue] = useState<string[]>([]);
  const options = ["Alpha", "Beta", "Gamma", "Delta"].map((value) => ({
    key: value,
    value,
  }));
  const observe = (stats: PointerStats) => {
    current.current = stats;
  };
  const record = () => {
    const snapshot = current.current;
    setHistory((previous) => [...previous, snapshot]);
  };
  return (
    <div style={{ width: 320 }}>
      {control === "button" ? (
        <Button
          disabled={disabled}
          onPointerSnapshot={observe}
          onClick={record}
        >
          <span data-testid="nested-button-content">Continue</span>
        </Button>
      ) : control === "radio" ? (
        <RadioGroup
          options={options}
          value={radioValue}
          onPointerSnapshot={observe}
          onChange={(event) => {
            setRadioValue(event.target.value);
            record();
          }}
        />
      ) : (
        <CheckboxGroup
          options={options}
          value={checkboxValue}
          onPointerSnapshot={observe}
          onChange={(value) => {
            setCheckboxValue(value);
            record();
          }}
        />
      )}
      <output data-testid="pointer-history">{JSON.stringify(history)}</output>
    </div>
  );
}
