// @vitest-environment jsdom
import { describe, test, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Qualtrics } from "./Qualtrics.js";

// The `stableParticipantId` contract is checked at the use site (#473): a
// Qualtrics survey always wants `stableParticipantId` linkage, so a missing id
// is real (silent) data loss and is surfaced loudly. Studies without Qualtrics
// never reach this check.

function render(el: React.ReactElement): void {
  const container = document.createElement("div");
  act(() => {
    createRoot(container).render(el);
  });
}

describe("Qualtrics stableParticipantId contract check (#473)", () => {
  test("reports a violation (console.error + onContractViolation) when stableParticipantId is empty", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onContractViolation = vi.fn();

    render(
      <Qualtrics
        url="https://upenn.qualtrics.com/jfe/form/SV_x"
        onContractViolation={onContractViolation}
        save={() => {}}
        onComplete={() => {}}
      />,
    );

    expect(onContractViolation).toHaveBeenCalledTimes(1);
    expect(onContractViolation).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "missingStableParticipantId" }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("without a stableParticipantId"),
    );
    consoleError.mockRestore();
  });

  test("reports a violation for a whitespace-only stableParticipantId (treated as absent)", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onContractViolation = vi.fn();

    render(
      <Qualtrics
        url="https://upenn.qualtrics.com/jfe/form/SV_x"
        stableParticipantId="   "
        onContractViolation={onContractViolation}
        save={() => {}}
        onComplete={() => {}}
      />,
    );

    expect(onContractViolation).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  test("does not report a violation when stableParticipantId is present", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onContractViolation = vi.fn();

    render(
      <Qualtrics
        url="https://upenn.qualtrics.com/jfe/form/SV_x"
        stableParticipantId="stable-1"
        onContractViolation={onContractViolation}
        save={() => {}}
        onComplete={() => {}}
      />,
    );

    expect(onContractViolation).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("without a stableParticipantId"),
    );
    consoleError.mockRestore();
  });
});
