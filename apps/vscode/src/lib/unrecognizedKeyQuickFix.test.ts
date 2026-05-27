import { describe, it, expect } from "vitest";
import { safeParseTreatmentFile } from "stagebook";
import { UNRECOGNIZED_KEY_DID_YOU_MEAN_RE } from "stagebook/validate";

// Regression test: the quick-fix provider extracts the bad key + the
// suggested replacement by regex-matching the diagnostic message. The
// regex and the message text are owned by different files (the regex
// here, the message format in stagebook's safeParseTreatmentFile), so
// these tests pin them together — if the message format drifts the
// quick-fix would silently stop offering replacements, and these tests
// catch it. See PR #221 / issue #123 review.

describe("UNRECOGNIZED_KEY_DID_YOU_MEAN_RE matches stagebook's emitted messages", () => {
  it("matches a 'Did you mean ...' message and captures bad key + suggestion", () => {
    // Provoke a real diagnostic by feeding a treatment with a typo'd
    // key on a survey element.
    const input = {
      treatments: [
        {
          name: "t",
          playerCount: 1,
          gameStages: [
            {
              name: "s",
              duration: 60,
              elements: [
                {
                  type: "survey",
                  surveyNme: "TIPI", // typo: extra 'm' missing
                },
              ],
            },
          ],
        },
      ],
    };

    const result = safeParseTreatmentFile(input);
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find(
      (i) => i.code === "custom" && i.message.startsWith("Unrecognized key"),
    );
    expect(issue).toBeDefined();

    const match = UNRECOGNIZED_KEY_DID_YOU_MEAN_RE.exec(issue!.message);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("surveyNme");
    expect(match![2]).toBe("surveyName");
  });

  it("does NOT match when the message has no suggestion (no close Levenshtein hit)", () => {
    // A bad key that's too far from any valid key — wrapper emits the
    // shorter "Unrecognized key 'X' on …. Valid keys: …" without the
    // "Did you mean" clause. The quick-fix should NOT offer an action.
    const input = {
      treatments: [
        {
          name: "t",
          playerCount: 1,
          gameStages: [
            {
              name: "s",
              duration: 60,
              elements: [
                {
                  type: "submitButton",
                  zzzzzzzzzzz: 1,
                },
              ],
            },
          ],
        },
      ],
    };

    const result = safeParseTreatmentFile(input);
    expect(result.success).toBe(false);
    if (result.success) return;

    const issue = result.error.issues.find(
      (i) => i.code === "custom" && i.message.startsWith("Unrecognized key"),
    );
    expect(issue).toBeDefined();
    // The "Did you mean" regex requires that fragment — should not match.
    expect(UNRECOGNIZED_KEY_DID_YOU_MEAN_RE.test(issue!.message)).toBe(false);
  });
});
