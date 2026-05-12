import React, { useState, useEffect } from "react";

export interface SliderProps {
  min?: number;
  max?: number;
  interval?: number;
  labelPts?: number[];
  labels?: string[];
  value?: number;
  onChange?: (value: number) => void;
}

export function Slider({
  min = 0,
  max = 100,
  interval = 1,
  labelPts = [],
  labels = [],
  value,
  onChange,
}: SliderProps) {
  const [localValue, setLocalValue] = useState<number | undefined>(value);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    setLocalValue(newValue);
    onChange?.(newValue);
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only set value on click if no value is set yet (avoids anchoring)
    if (localValue !== undefined && localValue !== null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const rawValue = min + percentage * (max - min);
    const newValue = Math.round(rawValue / interval) * interval;
    const clampedValue = Math.max(min, Math.min(max, newValue));
    setLocalValue(clampedValue);
    onChange?.(clampedValue);
  };

  const getPosition = (pt: number) => ((pt - min) / (max - min)) * 100;

  const hasValue = localValue !== undefined && localValue !== null;

  return (
    <div
      data-testid="slider"
      data-state={hasValue ? "anchored" : "unanchored"}
      style={{ marginTop: "1rem", width: "100%" }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          paddingTop: "0.5rem",
          paddingBottom: "2.5rem",
          paddingLeft: "0.5rem",
          paddingRight: "0.5rem",
        }}
      >
        {/* Clickable track — no thumb until first interaction */}
        <div
          onClick={handleClick}
          role="presentation"
          data-testid="slider-track"
          style={{
            position: "relative",
            width: "100%",
            height: "8px",
            backgroundColor: "var(--stagebook-bg-track, #e5e7eb)",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {/* Ticks */}
          {labelPts.map((pt) => (
            <div
              key={`tick-${pt}`}
              style={{
                position: "absolute",
                left: `${getPosition(pt)}%`,
                top: 0,
                width: "2px",
                height: "12px",
                backgroundColor: "var(--stagebook-text-faint, #9ca3af)",
              }}
            />
          ))}

          {/* Custom thumb — only rendered after first interaction. Sits in
              the same coordinate space as the ticks (positioned via the
              same getPosition() that places the ticks), which fixes the
              half-thumb-width offset that native range inputs reserve and
              that previously caused thumb/tick misalignment at non-center
              values (#326). pointer-events: none routes clicks/drags
              through to the invisible native input behind it. */}
          {hasValue && (
            <div
              data-testid="slider-thumb"
              style={{
                position: "absolute",
                left: `${getPosition(localValue)}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                // box-sizing: border-box keeps the visible thumb at 20×20
                // including the 2px white border, so the bounding box (and
                // the tick-alignment math in tests) matches the declared
                // size. Default content-box would render at 24×24.
                boxSizing: "border-box",
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "var(--stagebook-primary, #3b82f6)",
                border: "2px solid white",
                // Match the focus-ring token used by RadioGroup/CheckboxGroup/
                // Select so hosts can retheme focus visuals consistently.
                boxShadow: isFocused
                  ? "0 0 0 2px var(--stagebook-focus-ring, rgba(59, 130, 246, 0.25)), 0 2px 4px rgba(0,0,0,0.2)"
                  : "0 2px 4px rgba(0,0,0,0.2)",
                pointerEvents: "none",
              }}
            />
          )}
        </div>

        {/* Instruction when no value set — avoids anchoring */}
        {!hasValue && (
          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: "-0.75rem",
              fontSize: "0.75rem",
              color: "var(--stagebook-text-muted, #6b7280)",
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            Click the bar to select a value, then drag to adjust.
          </div>
        )}

        {/* Range input — only rendered after first interaction. Visually
            invisible (opacity: 0) but still handles keyboard and pointer
            interaction. The native thumb is forced to 0×0 so the browser
            doesn't reserve the half-thumb-width padding that previously
            broke tick alignment; the visible thumb is drawn separately
            above. */}
        {hasValue && (
          <input
            type="range"
            min={min}
            max={max}
            step={interval}
            value={localValue}
            onChange={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            style={{
              position: "absolute",
              top: "8px",
              left: "0.5rem",
              width: "calc(100% - 1rem)",
              height: "8px",
              background: "transparent",
              cursor: "pointer",
              WebkitAppearance: "none",
              MozAppearance: "none",
              opacity: 0,
              margin: 0,
              padding: 0,
            }}
            aria-label="Slider"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={localValue}
          />
        )}

        {/* Labels — positioned below ticks */}
        <div style={{ position: "relative", width: "100%", marginTop: "6px" }}>
          {labelPts.map((pt, idx) => {
            const pos = getPosition(pt);
            // Prevent edge labels from clipping off-screen
            let transform = "translateX(-50%)";
            let textAlign: React.CSSProperties["textAlign"] = "center";
            if (pos <= 5) {
              transform = "translateX(0)";
              textAlign = "left";
            } else if (pos >= 95) {
              transform = "translateX(-100%)";
              textAlign = "right";
            }
            return (
              <div
                key={`label-${pt}`}
                style={{
                  position: "absolute",
                  left: `${pos}%`,
                  transform,
                  textAlign,
                  maxWidth: "80px",
                  fontSize: "0.75rem",
                  color: "var(--stagebook-text-muted, #6b7280)",
                }}
              >
                {labels[idx]}
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 0;
          height: 0;
          background: transparent;
          border: none;
        }
        input[type="range"]::-moz-range-thumb {
          width: 0;
          height: 0;
          background: transparent;
          border: none;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          width: 100%;
          height: 0;
          background: transparent;
        }
        input[type="range"]::-moz-range-track {
          width: 100%;
          height: 0;
          background: transparent;
        }
        input[type="range"]:focus {
          outline: none;
        }
      `}</style>
    </div>
  );
}
