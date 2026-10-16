import { useRef, useState } from "react";
import { SubmitButton } from "../elements/SubmitButton.js";
import { useScrollAwareness } from "./useScrollAwareness.js";

/** Grow below a persistent, already-visible button without moving focus. */
export function PointerScrollHarness({
  phase = "initial",
}: {
  phase?: "initial" | "warm" | "grown";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { showIndicator } = useScrollAwareness(containerRef, {
    resetKey: "same-stage",
  });
  const [saves, setSaves] = useState(0);
  const [submits, setSubmits] = useState(0);

  return (
    <div>
      <output data-testid="saves">{saves}</output>
      <output data-testid="submits">{submits}</output>
      <output data-testid="indicator">{String(showIndicator)}</output>
      <div
        ref={containerRef}
        data-testid="scroller"
        style={{ height: 200, overflow: "auto" }}
      >
        <div>
          {Array.from({ length: phase === "initial" ? 2 : 25 }, (_, i) => (
            <div key={i} style={{ height: 24 }}>
              Line {i + 1}
            </div>
          ))}
        </div>
        <SubmitButton
          name="complete"
          buttonText="Complete"
          save={() => setSaves((count) => count + 1)}
          onSubmit={() => setSubmits((count) => count + 1)}
        />
        <div style={{ height: 80 }} />
        {phase === "grown" && <div style={{ height: 600 }}>New content</div>}
      </div>
    </div>
  );
}
