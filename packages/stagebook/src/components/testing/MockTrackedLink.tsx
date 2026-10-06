/**
 * Wrapper around `TrackedLink` that captures every `save` call and renders
 * the resulting saves into a hidden `data-testid="save-log"` div as JSON.
 * Component tests read this back to assert event semantics + accumulated
 * `totalTimeAwaySeconds` (issue #232).
 */
import React, { useState } from "react";
import { TrackedLink, type TrackedLinkProps } from "../elements/TrackedLink.js";

export function MockTrackedLink({
  elapsedTime = 0,
  ...props
}: Omit<TrackedLinkProps, "save" | "getElapsedTime"> & {
  elapsedTime?: number;
}) {
  const [saves, setSaves] = useState<{ key: string; value: unknown }[]>([]);
  return (
    <>
      <TrackedLink
        {...props}
        // Playwright's Node-to-browser callback bridge cannot return a
        // synchronous clock value. Keep this callback inside the browser.
        getElapsedTime={() => elapsedTime}
        save={(key, value) => setSaves((prev) => [...prev, { key, value }])}
      />
      <div data-testid="save-log" style={{ display: "none" }}>
        {JSON.stringify(saves)}
      </div>
    </>
  );
}
