import React, { useState } from "react";
import { Select, type SelectOption } from "../form/Select.js";

export interface MockSelectProps {
  options: SelectOption[];
  initialValue?: string;
  placeholder?: string;
  label?: string;
}

export function MockSelect({
  options,
  initialValue,
  placeholder,
  label,
}: MockSelectProps) {
  const [value, setValue] = useState(initialValue);

  return (
    <div>
      <Select
        options={options}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        label={label}
        placeholder={placeholder}
      />
      <div data-testid="selected-value" style={{ display: "none" }}>
        {value ?? ""}
      </div>
    </div>
  );
}
