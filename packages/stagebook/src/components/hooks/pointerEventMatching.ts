interface PointerClickEvidence {
  pointerId: number;
  pointerType: string;
  isTrusted: boolean;
  release: {
    timestamp: number;
    x: number;
    y: number;
    isTrusted: boolean;
  } | null;
}

interface ClickEvidence {
  pointerId?: number;
  pointerType?: string;
  isTrusted: boolean;
  clientX: number;
  clientY: number;
  detail: number;
}

/** Call only after checking that the press/release and click share a control. */
export function matchesPointerClick(
  pointer: PointerClickEvidence,
  click: ClickEvidence,
  now: number,
): boolean {
  const release = pointer.release;
  if (
    !release ||
    release.isTrusted !== pointer.isTrusted ||
    click.isTrusted !== pointer.isTrusted
  )
    return false;
  if (click.pointerId === undefined) return click.detail > 0;
  if (click.pointerId < 0) return false;
  if (click.pointerId === pointer.pointerId) return true;

  // Some engines dispatch a compatibility mouse click with a new pointer ID
  // after touchend. Keep this exception narrow; .click() and arbitrary ID
  // mismatches must not borrow a previous touch's coordinates or provenance.
  const elapsed = now - release.timestamp;
  return (
    pointer.pointerType === "touch" &&
    pointer.isTrusted &&
    click.pointerType === "mouse" &&
    click.detail > 0 &&
    elapsed >= 0 &&
    elapsed <= 1000 &&
    Math.abs(click.clientX - release.x) <= 1 &&
    Math.abs(click.clientY - release.y) <= 1
  );
}
