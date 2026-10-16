import { useRef, useState, type RefObject } from "react";
import { SubmitButton } from "../elements/SubmitButton.js";
import { useScrollAwareness } from "./useScrollAwareness.js";

function Awareness({
  containerRef,
  resetKey,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  resetKey: string;
}) {
  const { showIndicator } = useScrollAwareness(containerRef, { resetKey });
  return <output data-testid="indicator">{String(showIndicator)}</output>;
}

/** Keep the scroll node mounted when detaching the hook to detect stale work. */
export function ScrollLifecycleHarness({
  resetKey = "first",
  observing = true,
  smooth = false,
}: {
  resetKey?: string;
  observing?: boolean;
  smooth?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(2);
  const [saves, setSaves] = useState(0);
  const [submits, setSubmits] = useState(0);
  return (
    <div>
      <button onClick={() => setLines(30)}>Warm up</button>
      <button onClick={() => setLines(60)}>Reveal Complete</button>
      <output data-testid="saves">{saves}</output>
      <output data-testid="submits">{submits}</output>
      <div
        ref={containerRef}
        tabIndex={0}
        data-testid="scroller"
        style={{
          height: 200,
          overflow: "auto",
          scrollBehavior: smooth ? "smooth" : "auto",
        }}
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} style={{ height: 24 }}>
            Line {i + 1}
          </div>
        ))}
        {lines === 60 && (
          <SubmitButton
            name="complete"
            buttonText="Complete"
            save={() => setSaves((n) => n + 1)}
            onSubmit={() => setSubmits((n) => n + 1)}
          />
        )}
      </div>
      {observing && (
        <Awareness containerRef={containerRef} resetKey={resetKey} />
      )}
    </div>
  );
}
