import { describe, it, expect } from "vitest";
import { resolveReferencePosition } from "./StateInspector.js";

/**
 * Focused unit test for the position-resolution helper that closes
 * #349. The bug was: the inspector used the *current participant's*
 * position for every store lookup/edit, so references that named a
 * different position (`0.prompt.X` while viewing as participant 1)
 * read and wrote the wrong position's bucket.
 *
 * The helper translates a reference's position prefix to the
 * `PositionKey` (or "all"-aggregator marker) the store should use.
 */
describe("resolveReferencePosition (#349)", () => {
  it("maps `self.X` to the current participant's position", () => {
    expect(resolveReferencePosition("self.prompt.q1", 0)).toEqual({
      kind: "single",
      position: 0,
    });
    expect(resolveReferencePosition("self.prompt.q1", 1)).toEqual({
      kind: "single",
      position: 1,
    });
  });

  it("maps `shared.X` to the shared bucket regardless of current position", () => {
    expect(resolveReferencePosition("shared.survey.tipi", 0)).toEqual({
      kind: "single",
      position: "shared",
    });
    expect(resolveReferencePosition("shared.survey.tipi", 1)).toEqual({
      kind: "single",
      position: "shared",
    });
  });

  it("maps numeric position prefixes to that exact position (#349 core)", () => {
    // The headline bug: `0.prompt.X` viewed while current participant
    // is position 1 must still read position 0's bucket.
    expect(
      resolveReferencePosition("0.prompt.continue_with_partner", 1),
    ).toEqual({ kind: "single", position: 0 });
    expect(
      resolveReferencePosition("1.prompt.continue_with_partner", 0),
    ).toEqual({ kind: "single", position: 1 });
    expect(resolveReferencePosition("2.prompt.foo", 0)).toEqual({
      kind: "single",
      position: 2,
    });
  });

  it("maps `all.X` to the aggregator marker (read across all positions)", () => {
    expect(resolveReferencePosition("all.prompt.q1", 0)).toEqual({
      kind: "all",
    });
    expect(resolveReferencePosition("all.prompt.q1", 5)).toEqual({
      kind: "all",
    });
  });

  it("returns null for an invalid reference (caller renders disabled placeholder)", () => {
    expect(resolveReferencePosition("not-a-reference", 0)).toBeNull();
    expect(resolveReferencePosition("urlParams.foo", 0)).toBeNull();
    expect(resolveReferencePosition("", 0)).toBeNull();
  });
});
