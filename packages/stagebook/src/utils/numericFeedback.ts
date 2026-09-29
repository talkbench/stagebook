import type { NumberFormat, StagebookMessages } from "../messages/types.js";
import { checkResponse } from "./checkResponse.js";
import {
  couldBecomeValidByAppending,
  formatNumericPlain,
  parseNumericEntry,
  type NumericConstraints,
} from "./numericResponse.js";

export interface NumericFeedback {
  state: "neutral" | "valid" | "problem";
  /** Plain catalog text including its non-color status symbol. */
  text: string;
}

/** The caller owns focus history: only an accepted own edit clears reveal. */
export function getNumericFeedback(
  entry: string,
  constraints: NumericConstraints,
  numberFormat: NumberFormat,
  revealProblems: boolean,
  messages: StagebookMessages,
): NumericFeedback {
  const plain = (value: number | undefined) =>
    value === undefined ? undefined : formatNumericPlain(value, numberFormat);
  const guidance = messages.numericGuidance(
    constraints.integer === true,
    plain(constraints.min),
    plain(constraints.max),
  );
  const check = checkResponse(entry, {
    ...constraints,
    type: "numericResponse",
    numberFormat,
  });
  if (check.blank) return { state: "neutral", text: guidance };
  if (check.isValid) return { state: "valid", text: `✓ ${guidance}` };
  if (
    !revealProblems &&
    couldBecomeValidByAppending(entry, constraints, numberFormat)
  ) {
    return { state: "neutral", text: guidance };
  }
  const parsed = parseNumericEntry(entry, numberFormat);
  let problem = messages.numericNotNumber;
  switch (check.failed) {
    case "unfinished":
      problem = messages.numericUnfinished;
      break;
    case "tooLong":
      problem = messages.numericTooLong;
      break;
    case "tooManyDigits":
      problem = messages.numericTooManyDigits;
      break;
    case "integer":
      problem = messages.numericWholeNumber;
      break;
    case "min":
      if (parsed.status === "parsed" && constraints.min !== undefined)
        problem = messages.numericLessThan(
          formatNumericPlain(parsed.value, numberFormat),
          formatNumericPlain(constraints.min, numberFormat),
        );
      break;
    case "max":
      if (parsed.status === "parsed" && constraints.max !== undefined)
        problem = messages.numericMoreThan(
          formatNumericPlain(parsed.value, numberFormat),
          formatNumericPlain(constraints.max, numberFormat),
        );
      break;
  }
  return { state: "problem", text: `ⓘ ${problem}` };
}
