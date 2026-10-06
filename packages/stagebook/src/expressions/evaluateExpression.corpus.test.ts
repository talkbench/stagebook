import { describe, expect, test, vi } from "vitest";
import {
  evaluateExpression,
  type ExpressionReference,
} from "./evaluateExpression.js";
import { Missing } from "./missing.js";

/**
 * Runtime corpus for the stable IDs in
 * docs/decisions/2026-10-missing-answers-in-conditions-cases.md.
 *
 * These fixtures are ready snapshots at the evaluator boundary. Blank prompt
 * answers and unanswered numeric inputs are already Missing; readReference's
 * source-specific normalization has its own tests. A conditions array is written
 * as its explicit `all` expression here, without testing the consumer adapter.
 * A2/A4 use explicit self/value paths instead of their legacy omitted position.
 *
 * A4's original cross-type condition and every F1 row are authoring errors, so
 * their rejection belongs to the expression schema/static-typing corpus. A4
 * below tests its documented corrections, not acceptance of the invalid form.
 */
type Snapshot = Readonly<Record<string, unknown>>;
type Moment = readonly [
  moment: string,
  snapshot: Snapshot,
  expected: readonly unknown[],
];

function referenceKey(reference: ExpressionReference): string {
  if (typeof reference === "string") return reference;
  return [
    reference.position,
    reference.source,
    reference.name,
    ...(reference.path ?? ["value"]),
  ]
    .filter((part) => part !== undefined)
    .join(".");
}

function evaluate(expression: unknown, snapshot: Snapshot) {
  return evaluateExpression(expression, {
    readReference: (reference) => snapshot[referenceKey(reference)] ?? Missing,
  });
}

function corpus(
  id: string,
  title: string,
  expressions: readonly unknown[],
  moments: readonly Moment[],
) {
  describe(`${id} · ${title}`, () => {
    test.each(moments)("%s", (_moment, snapshot, expected) => {
      expect(
        expressions.map((expression) => evaluate(expression, snapshot)),
      ).toEqual(expected);
    });
  });
}

function atSeats(name: string, values: readonly unknown[]): Snapshot {
  return {
    [`everyone.prompt.${name}.value`]: values,
    ...Object.fromEntries(
      values.map((value, seat) => [`${seat}.prompt.${name}.value`, value]),
    ),
  };
}

corpus(
  "A1",
  "continue once answered",
  [{ reference: "self.prompt.continue_together", comparator: "exists" }],
  [
    ["not answered", {}, [false]],
    ["answered No", { "self.prompt.continue_together": "No" }, [true]],
  ],
);

corpus(
  "A2",
  "minimum length uses raw text after prompt blank normalization",
  [
    {
      reference: "self.prompt.reflection.value",
      comparator: "hasLengthAtLeast",
      value: 300,
    },
  ],
  [
    ["untouched", {}, [false]],
    [
      "120 characters",
      { "self.prompt.reflection.value": "a".repeat(120) },
      [false],
    ],
    [
      "300 characters",
      { "self.prompt.reflection.value": "a".repeat(300) },
      [true],
    ],
    [
      "290 characters and 10 trailing spaces",
      { "self.prompt.reflection.value": "a".repeat(290) + " ".repeat(10) },
      [true],
    ],
    [
      "typed then cleared",
      { "self.prompt.reflection.value": Missing },
      [false],
    ],
    [
      "300 spaces normalized to Missing",
      { "self.prompt.reflection.value": Missing },
      [false],
    ],
  ],
);

const practiceCorrect = {
  all: [
    {
      reference: "self.prompt.practiceChoice",
      comparator: "includes",
      value: "Red",
    },
    {
      reference: "self.prompt.practiceChoice",
      comparator: "hasLengthAtMost",
      value: 1,
    },
  ],
};
corpus(
  "A3",
  "practice feedback on a multi-select: correct and incorrect gates",
  [
    practiceCorrect,
    {
      all: [
        {
          reference: "self.prompt.practiceChoice",
          comparator: "hasLengthAtLeast",
          value: 1,
        },
        { none: [practiceCorrect] },
      ],
    },
  ],
  [
    ["nothing ticked", {}, [false, false]],
    ["Red only", { "self.prompt.practiceChoice": ["Red"] }, [true, false]],
    [
      "Red and Blue",
      { "self.prompt.practiceChoice": ["Red", "Blue"] },
      [false, true],
    ],
    ["Blue only", { "self.prompt.practiceChoice": ["Blue"] }, [false, true]],
    [
      "unticked everything",
      { "self.prompt.practiceChoice": Missing },
      [false, false],
    ],
    [
      "membership normalizes text",
      { "self.prompt.practiceChoice": [" red "] },
      [true, false],
    ],
  ],
);

corpus(
  "A4",
  "corrected text choice comparison",
  [
    {
      reference: "self.prompt.comp_count.value",
      comparator: "equals",
      value: "4",
    },
  ],
  [
    ["picked text 4", { "self.prompt.comp_count.value": "4" }, [true]],
    ["picked text 2", { "self.prompt.comp_count.value": "2" }, [false]],
    [
      "numeric-looking text retains spelling",
      { "self.prompt.comp_count.value": "4.0" },
      [false],
    ],
  ],
);
corpus(
  "A4",
  "alternative correction uses a numeric-mode choice",
  [
    {
      reference: "self.prompt.comp_count.value",
      comparator: "equals",
      value: 4,
    },
  ],
  [
    ["picked number 4", { "self.prompt.comp_count.value": 4 }, [true]],
    ["picked number 2", { "self.prompt.comp_count.value": 2 }, [false]],
  ],
);

corpus(
  "A5",
  "fallback unless Yes",
  [
    {
      reference: "self.prompt.continue",
      comparator: "doesNotEqual",
      value: "Yes",
    },
  ],
  [
    ["unanswered", {}, [true]],
    ["Yes", { "self.prompt.continue": "Yes" }, [false]],
    ["No", { "self.prompt.continue": "No" }, [true]],
    ["yes with trailing space", { "self.prompt.continue": "yes " }, [false]],
  ],
);

corpus(
  "A6",
  "optional comment with a length limit",
  [
    {
      any: [
        { reference: "self.prompt.comments.value", comparator: "doesNotExist" },
        {
          reference: "self.prompt.comments.value",
          comparator: "hasLengthAtMost",
          value: 200,
        },
      ],
    },
  ],
  [
    ["untouched", {}, [true]],
    [
      "150 characters",
      { "self.prompt.comments.value": "x".repeat(150) },
      [true],
    ],
    [
      "250 characters",
      { "self.prompt.comments.value": "x".repeat(250) },
      [false],
    ],
    ["typed then cleared", { "self.prompt.comments.value": Missing }, [true]],
  ],
);

corpus(
  "A7",
  "timeline selection accuracy",
  [
    {
      all: [
        {
          reference: "self.timeline.storySegment.0.start",
          comparator: "isAtLeast",
          value: 15,
        },
        {
          reference: "self.timeline.storySegment.0.start",
          comparator: "isAtMost",
          value: 19,
        },
      ],
    },
  ],
  [
    ["no selection", {}, [false]],
    [
      "starts at 16 seconds",
      { "self.timeline.storySegment.0.start": 16 },
      [true],
    ],
    [
      "starts at 22 seconds",
      { "self.timeline.storySegment.0.start": 22 },
      [false],
    ],
  ],
);

corpus(
  "A8",
  "tracked link visited",
  [
    {
      reference: "self.trackedLink.signup_link.totalTimeAwaySeconds",
      comparator: "isAbove",
      value: 0,
    },
  ],
  [
    ["not clicked", {}, [false]],
    [
      "clicked and returned",
      { "self.trackedLink.signup_link.totalTimeAwaySeconds": 2.5 },
      [true],
    ],
  ],
);

const bothContinue = {
  all: [
    {
      reference: "0.prompt.continue_together",
      comparator: "equals",
      value: "Yes",
    },
    {
      reference: "1.prompt.continue_together",
      comparator: "equals",
      value: "Yes",
    },
  ],
};
const followupMoments: readonly Moment[] = [
  [
    "both Yes",
    {
      "0.prompt.continue_together": "Yes",
      "1.prompt.continue_together": "Yes",
    },
    [true],
  ],
  [
    "one No",
    { "0.prompt.continue_together": "Yes", "1.prompt.continue_together": "No" },
    [false],
  ],
  ["one never answered", { "0.prompt.continue_together": "Yes" }, [false]],
  ["neither answered", {}, [false]],
];
corpus(
  "B1",
  "skip a stage based on earlier answers",
  [bothContinue],
  followupMoments,
);

corpus(
  "B2",
  "remain in a stage until a decision arrives, in both spellings",
  [
    { reference: "shared.prompt.decision.value", comparator: "doesNotExist" },
    {
      none: [
        {
          reference: "shared.prompt.status.value",
          comparator: "equals",
          value: "Done",
        },
      ],
    },
  ],
  [
    ["stage starts empty: both gates stay true", {}, [true, true]],
    [
      "decision recorded and status Done: both gates advance",
      {
        "shared.prompt.decision.value": "chosen",
        "shared.prompt.status.value": "Done",
      },
      [false, false],
    ],
  ],
);

const labelsMatch = {
  allEqual: { reference: "everyone.prompt.recall_1.value" },
};
corpus(
  "C1",
  "labels match in a later stage: match and not-match gates",
  [labelsMatch, { none: [labelsMatch] }],
  [
    [
      "all red car",
      atSeats("recall_1", ["red car", "red car", "red car"]),
      [true, false],
    ],
    [
      "one blue bike",
      atSeats("recall_1", ["red car", "red car", "blue bike"]),
      [false, true],
    ],
    [
      "different labels and one absent",
      atSeats("recall_1", ["red car", "blue bike", Missing]),
      [false, true],
    ],
    [
      "matching labels and one absent",
      atSeats("recall_1", ["red car", "red car", Missing]),
      [false, true],
    ],
    [
      "third label cleared",
      atSeats("recall_1", ["red car", "red car", Missing]),
      [false, true],
    ],
    [
      "nobody typed",
      atSeats("recall_1", [Missing, Missing, Missing]),
      [false, true],
    ],
    [
      "case and surrounding whitespace ignored",
      atSeats("recall_1", ["Red car", "red car ", "RED CAR"]),
      [true, false],
    ],
    [
      "internal spaces count",
      atSeats("recall_1", ["red car", "red car", "red  car"]),
      [false, true],
    ],
  ],
);

function deal(
  answers: readonly unknown[],
  payoff: readonly unknown[] = [100, 100, 100],
): Snapshot {
  return {
    ...atSeats("dealsheet1", answers),
    ...atSeats("dealsheet3", payoff),
    ...atSeats("dealsheet4", [200, 200, 200]),
    ...atSeats("dealsheet5", [300, 300, 300]),
  };
}
corpus(
  "C2",
  "negotiation: submit and disagreement-warning gates",
  [
    {
      all: [
        {
          all: {
            reference: "everyone.prompt.dealsheet1.value",
            comparator: "equals",
            value: "Yes",
          },
        },
        { allEqual: { reference: "everyone.prompt.dealsheet3.value" } },
        { allEqual: { reference: "everyone.prompt.dealsheet4.value" } },
        { allEqual: { reference: "everyone.prompt.dealsheet5.value" } },
      ],
    },
    {
      all: [
        {
          all: {
            reference: "everyone.prompt.dealsheet1.value",
            comparator: "exists",
          },
        },
        {
          none: [
            { allEqual: { reference: "everyone.prompt.dealsheet1.value" } },
          ],
        },
      ],
    },
  ],
  [
    [
      "nobody answered",
      {
        ...atSeats("dealsheet1", [Missing, Missing, Missing]),
        ...atSeats("dealsheet3", [Missing, Missing, Missing]),
        ...atSeats("dealsheet4", [Missing, Missing, Missing]),
        ...atSeats("dealsheet5", [Missing, Missing, Missing]),
      },
      [false, false],
    ],
    [
      "two Yes, third absent, payoffs agree",
      deal(["Yes", "Yes", Missing]),
      [false, false],
    ],
    [
      "all Yes and identical payoffs",
      deal(["Yes", "Yes", "Yes"]),
      [true, false],
    ],
    [
      "one payoff differs",
      deal(["Yes", "Yes", "Yes"], [100, 90, 100]),
      [false, false],
    ],
    [
      "one has not entered payoff",
      deal(["Yes", "Yes", "Yes"], [100, Missing, 100]),
      [false, false],
    ],
    [
      "100 and 100.00 both saved as numbers",
      deal(["Yes", "Yes", "Yes"], [100, 100.0, 100]),
      [true, false],
    ],
    [
      "unfinished 100- has no saved numeric value",
      deal(["Yes", "Yes", "Yes"], [100, Missing, 100]),
      [false, false],
    ],
    [
      "two disagree and third absent",
      deal(["Yes", "No", Missing]),
      [false, false],
    ],
    ["all answered, not unanimous", deal(["Yes", "No", "Yes"]), [false, true]],
  ],
);

const anyCorrectGuess = {
  any: {
    reference: "everyone.prompt.guess_1.value",
    comparator: "equals",
    value: "lion",
  },
};
corpus(
  "C3",
  "guessing-game incorrect feedback and equivalent correct-guess spellings",
  [
    {
      all: [
        {
          any: {
            reference: "everyone.prompt.guess_1.value",
            comparator: "exists",
          },
        },
        {
          none: {
            reference: "everyone.prompt.guess_1.value",
            comparator: "equals",
            value: "lion",
          },
        },
        {
          none: {
            reference: "everyone.prompt.continue_1.value",
            comparator: "exists",
          },
        },
      ],
    },
    anyCorrectGuess,
    {
      includes: {
        container: { reference: "everyone.prompt.guess_1.value" },
        members: ["lion"],
      },
    },
  ],
  [
    [
      "no guess",
      {
        ...atSeats("guess_1", [Missing, Missing]),
        ...atSeats("continue_1", [Missing, Missing]),
      },
      [false, false, false],
    ],
    [
      "guesser right",
      {
        ...atSeats("guess_1", [Missing, "lion"]),
        ...atSeats("continue_1", [Missing, Missing]),
      },
      [false, true, true],
    ],
    [
      "guesser wrong",
      {
        ...atSeats("guess_1", [Missing, "tiger"]),
        ...atSeats("continue_1", [Missing, Missing]),
      },
      [true, false, false],
    ],
    [
      "describer continued",
      {
        ...atSeats("guess_1", [Missing, "tiger"]),
        ...atSeats("continue_1", ["continue", Missing]),
      },
      [false, false, false],
    ],
  ],
);

corpus(
  "C4",
  "follow-up and no-follow-up gates",
  [
    bothContinue,
    {
      any: [
        {
          reference: "0.prompt.continue_together",
          comparator: "doesNotEqual",
          value: "Yes",
        },
        {
          reference: "1.prompt.continue_together",
          comparator: "doesNotEqual",
          value: "Yes",
        },
      ],
    },
  ],
  [
    [
      "both Yes",
      {
        "0.prompt.continue_together": "Yes",
        "1.prompt.continue_together": "Yes",
      },
      [true, false],
    ],
    [
      "one No",
      {
        "0.prompt.continue_together": "Yes",
        "1.prompt.continue_together": "No",
      },
      [false, true],
    ],
    [
      "one never answered",
      { "0.prompt.continue_together": "Yes" },
      [false, true],
    ],
    ["neither answered", {}, [false, true]],
  ],
);

corpus(
  "C5",
  "at least four of six said Yes",
  [
    {
      nonDecreasing: [
        4,
        {
          countTrue: {
            reference: "everyone.prompt.agree.value",
            comparator: "equals",
            value: "Yes",
          },
        },
      ],
    },
  ],
  [
    [
      "nobody answered",
      atSeats("agree", [Missing, Missing, Missing, Missing, Missing, Missing]),
      [false],
    ],
    [
      "three Yes, three absent",
      atSeats("agree", ["Yes", "Yes", "Yes", Missing, Missing, Missing]),
      [false],
    ],
    [
      "four Yes, two absent",
      atSeats("agree", ["Yes", "Yes", "Yes", "Yes", Missing, Missing]),
      [true],
    ],
    [
      "four Yes, two No",
      atSeats("agree", ["Yes", "Yes", "Yes", "Yes", "No", "No"]),
      [true],
    ],
    [
      "three Yes, three No",
      atSeats("agree", ["Yes", "Yes", "Yes", "No", "No", "No"]),
      [false],
    ],
  ],
);

corpus(
  "C6",
  "nobody above fifty versus everyone at most fifty",
  [
    {
      none: {
        reference: "everyone.prompt.rating.value",
        comparator: "isAbove",
        value: 50,
      },
    },
    {
      all: {
        reference: "everyone.prompt.rating.value",
        comparator: "isAtMost",
        value: 50,
      },
    },
  ],
  [
    [
      "nobody rated: only explicit wait hides",
      atSeats("rating", [Missing, Missing, Missing]),
      [true, false],
    ],
    ["all at most fifty", atSeats("rating", [50, 40, 0]), [true, true]],
    ["one rated sixty", atSeats("rating", [50, 60, 0]), [false, false]],
    ["one still absent", atSeats("rating", [50, 40, Missing]), [true, false]],
  ],
);

corpus(
  "C7",
  "group total so far versus once everyone contributes",
  [
    {
      nonIncreasing: [
        { sumExisting: { reference: "everyone.prompt.contribution.value" } },
        20,
      ],
    },
    {
      nonIncreasing: [
        { sum: { reference: "everyone.prompt.contribution.value" } },
        20,
      ],
    },
  ],
  [
    [
      "nobody contributed",
      atSeats("contribution", [Missing, Missing, Missing]),
      [false, false],
    ],
    [
      "twelve only",
      atSeats("contribution", [12, Missing, Missing]),
      [false, false],
    ],
    [
      "twelve and nine",
      atSeats("contribution", [12, Missing, 9]),
      [true, false],
    ],
    ["twelve, three, nine", atSeats("contribution", [12, 3, 9]), [true, true]],
    ["five, three, seven", atSeats("contribution", [5, 3, 7]), [false, false]],
    [
      "middle answer cleared",
      atSeats("contribution", [12, Missing, 9]),
      [true, false],
    ],
  ],
);

const newMatch = {
  all: [
    { allEqual: { reference: "everyone.prompt.label_5.value" } },
    {
      none: [
        {
          allEqual: [
            { reference: "0.prompt.label_1.value" },
            { reference: "1.prompt.label_1.value" },
            { reference: "0.prompt.label_5.value" },
          ],
        },
        {
          allEqual: [
            { reference: "0.prompt.label_2.value" },
            { reference: "1.prompt.label_2.value" },
            { reference: "0.prompt.label_5.value" },
          ],
        },
        {
          allEqual: [
            { reference: "0.prompt.label_3.value" },
            { reference: "1.prompt.label_3.value" },
            { reference: "0.prompt.label_5.value" },
          ],
        },
        {
          allEqual: [
            { reference: "0.prompt.label_4.value" },
            { reference: "1.prompt.label_4.value" },
            { reference: "0.prompt.label_5.value" },
          ],
        },
      ],
    },
  ],
};
corpus(
  "C8",
  "new matches exclude only earlier matching rounds on that label",
  [newMatch],
  [
    [
      "lion match and no earlier matches",
      atSeats("label_5", ["lion", "lion"]),
      [true],
    ],
    [
      "round two already matched lion",
      {
        ...atSeats("label_5", ["lion", "lion"]),
        ...atSeats("label_2", ["lion", "lion"]),
      },
      [false],
    ],
    [
      "round three lion and tiger did not match",
      {
        ...atSeats("label_5", ["lion", "lion"]),
        ...atSeats("label_3", ["lion", "tiger"]),
      },
      [true],
    ],
    [
      "round four had one absent answer",
      {
        ...atSeats("label_5", ["lion", "lion"]),
        ...atSeats("label_4", ["lion", Missing]),
      },
      [true],
    ],
    [
      "round four had both absent",
      {
        ...atSeats("label_5", ["lion", "lion"]),
        ...atSeats("label_4", [Missing, Missing]),
      },
      [true],
    ],
    [
      "current answers disagree",
      atSeats("label_5", ["lion", "tiger"]),
      [false],
    ],
    [
      "current second answer absent",
      atSeats("label_5", ["lion", Missing]),
      [false],
    ],
    [
      "current and earlier labels normalize equally",
      {
        ...atSeats("label_5", ["Lion ", "lion"]),
        ...atSeats("label_2", ["LION", "LION"]),
      },
      [false],
    ],
  ],
);

corpus(
  "C9",
  "ten points per matching round",
  [
    {
      product: [
        10,
        {
          countTrue: [
            { allEqual: { reference: "everyone.prompt.recall_1.value" } },
            { allEqual: { reference: "everyone.prompt.recall_2.value" } },
            { allEqual: { reference: "everyone.prompt.recall_3.value" } },
          ],
        },
      ],
    },
  ],
  [
    [
      "before round one",
      {
        ...atSeats("recall_1", [Missing, Missing]),
        ...atSeats("recall_2", [Missing, Missing]),
        ...atSeats("recall_3", [Missing, Missing]),
      },
      [0],
    ],
    [
      "round one matched",
      {
        ...atSeats("recall_1", ["lion", "lion"]),
        ...atSeats("recall_2", [Missing, Missing]),
        ...atSeats("recall_3", [Missing, Missing]),
      },
      [10],
    ],
    [
      "round two did not match",
      {
        ...atSeats("recall_1", ["lion", "lion"]),
        ...atSeats("recall_2", ["lion", "tiger"]),
        ...atSeats("recall_3", [Missing, Missing]),
      },
      [10],
    ],
    [
      "round three one player timed out",
      {
        ...atSeats("recall_1", ["lion", "lion"]),
        ...atSeats("recall_2", ["lion", "tiger"]),
        ...atSeats("recall_3", ["bear", Missing]),
      },
      [10],
    ],
    [
      "round three matched with different case",
      {
        ...atSeats("recall_1", ["lion", "lion"]),
        ...atSeats("recall_2", ["lion", "tiger"]),
        ...atSeats("recall_3", ["Bear", "bear "]),
      },
      [20],
    ],
  ],
);

corpus(
  "D1",
  "eligibility by role, including negative variants",
  [
    { reference: "self.prompt.role", comparator: "equals", value: "a" },
    { reference: "self.prompt.role", comparator: "doesNotEqual", value: "a" },
    {
      reference: "self.prompt.role",
      comparator: "isNotOneOf",
      value: ["a", "c"],
    },
  ],
  [
    ["answered a", { "self.prompt.role": "a" }, [true, false, false]],
    ["answered A", { "self.prompt.role": "A" }, [true, false, false]],
    ["answered b", { "self.prompt.role": "b" }, [false, true, true]],
    ["never answered", {}, [false, true, true]],
  ],
);

const extraversion = {
  average: [
    { reference: "self.prompt.tipi_q1.value" },
    {
      subtract: { from: 8, value: { reference: "self.prompt.tipi_q6.value" } },
    },
  ],
};
corpus(
  "E1",
  "TIPI extraversion",
  [extraversion],
  [
    [
      "q1 five and q6 two",
      { "self.prompt.tipi_q1.value": 5, "self.prompt.tipi_q6.value": 2 },
      [5.5],
    ],
    ["q6 unanswered", { "self.prompt.tipi_q1.value": 5 }, [Missing]],
  ],
);
test("E1 · text saved by a numeric prompt produces Missing and a sanitized violation", () => {
  const onViolation = vi.fn();
  const snapshot: Snapshot = {
    "self.prompt.tipi_q1.value": "5",
    "self.prompt.tipi_q6.value": 2,
  };
  expect(
    evaluateExpression(extraversion, {
      readReference: (reference) =>
        snapshot[referenceKey(reference)] ?? Missing,
      onViolation,
    }),
  ).toBe(Missing);
  expect(onViolation).toHaveBeenCalledTimes(1);
  expect(onViolation).toHaveBeenCalledWith({
    kind: "typeMismatch",
    reference: "self.prompt.tipi_q1.value",
    expected: "number",
    actual: "string",
  });
});

corpus(
  "E2",
  "scale score from at least two of three items",
  [
    {
      averageExisting: {
        inputs: [
          { reference: "self.prompt.q1.value" },
          { reference: "self.prompt.q2.value" },
          { reference: "self.prompt.q3.value" },
        ],
        atLeast: 2,
      },
    },
  ],
  [
    [
      "six, four, two",
      {
        "self.prompt.q1.value": 6,
        "self.prompt.q2.value": 4,
        "self.prompt.q3.value": 2,
      },
      [4],
    ],
    [
      "six, Missing, two",
      { "self.prompt.q1.value": 6, "self.prompt.q3.value": 2 },
      [4],
    ],
    ["only six", { "self.prompt.q1.value": 6 }, [Missing]],
    ["all Missing", {}, [Missing]],
  ],
);

corpus(
  "E3",
  "first answered branch in authored order",
  [
    {
      firstExisting: [
        { reference: "self.prompt.routeA_answer.value" },
        { reference: "self.prompt.routeB_answer.value" },
      ],
    },
  ],
  [
    [
      "only B answered",
      { "self.prompt.routeB_answer.value": "B answer" },
      ["B answer"],
    ],
    [
      "both answered",
      {
        "self.prompt.routeA_answer.value": "A answer",
        "self.prompt.routeB_answer.value": "B answer",
      },
      ["A answer"],
    ],
    [
      "A cleared and B answered",
      {
        "self.prompt.routeA_answer.value": Missing,
        "self.prompt.routeB_answer.value": "B answer",
      },
      ["B answer"],
    ],
    ["neither answered", {}, [Missing]],
  ],
);

const bandRules = [
  {
    when: {
      reference: "self.prompt.score.value",
      comparator: "isAtLeast",
      value: 80,
    },
    value: "high",
  },
  {
    when: {
      reference: "self.prompt.score.value",
      comparator: "isAtLeast",
      value: 50,
    },
    value: "medium",
  },
  {
    when: {
      reference: "self.prompt.score.value",
      comparator: "isBelow",
      value: 50,
    },
    value: "low",
  },
];
corpus(
  "E4",
  "every score band is explicit, with and without the Missing default",
  [
    { case: { rules: [...bandRules, { default: true, value: null }] } },
    { case: { rules: bandRules } },
  ],
  [
    ["ninety", { "self.prompt.score.value": 90 }, ["high", "high"]],
    ["sixty-five", { "self.prompt.score.value": 65 }, ["medium", "medium"]],
    ["thirty-five", { "self.prompt.score.value": 35 }, ["low", "low"]],
    ["unanswered", {}, [Missing, Missing]],
    [
      "exactly eighty selects the first matching rule",
      { "self.prompt.score.value": 80 },
      ["high", "high"],
    ],
    ["exactly fifty", { "self.prompt.score.value": 50 }, ["medium", "medium"]],
  ],
);

describe("E5 · strict calculations, Existing reductions, and counts", () => {
  test.each([
    ["countUnique drops Missing", { countUnique: ["a", null, "b"] }, 2],
    ["countUnique all Missing", { countUnique: [null, null, null] }, 0],
    ["countExisting drops Missing", { countExisting: ["a", null, "b"] }, 2],
    [
      "missing answer has no length",
      { length: { reference: "self.prompt.answer.value" } },
      Missing,
    ],
    ["product remains strict even with zero", { product: [0, null] }, Missing],
    ["minExisting drops Missing", { minExisting: [3, null, 5] }, 3],
    [
      "sumExisting minimum not met",
      { sumExisting: { inputs: [4, null, null], atLeast: 2 } },
      Missing,
    ],
    [
      "divide by a data-derived count of zero",
      {
        divide: { numerator: 7, denominator: { countExisting: [null, null] } },
      },
      Missing,
    ],
    ["zero is a present fallback", { firstExisting: [null, 0] }, 0],
    ["strict sum", { sum: [3, null, 5] }, Missing],
    ["lenient sum", { sumExisting: [3, null, 5] }, 8],
    ["strict average", { average: [3, null, 5] }, Missing],
    ["lenient average", { averageExisting: [3, null, 5] }, 4],
    ["strict minimum", { min: [3, null, 5] }, Missing],
    ["strict maximum", { max: [3, null, 5] }, Missing],
    ["lenient maximum", { maxExisting: [3, null, 5] }, 5],
    [
      "counts preserve present zero false and literal blank",
      { countExisting: [0, false, "", null] },
      3,
    ],
    ["countTrue never waits", { countTrue: [true, null, false] }, 1],
    ["countTrue all Missing", { countTrue: [null, null] }, 0],
    ["countExisting all Missing", { countExisting: [null, null] }, 0],
    ["countUnique normalizes text", { countUnique: ["Red", " red ", null] }, 1],
    ["literal empty list is present", { length: { literal: [] } }, 0],
    ["literal empty text is present", { firstExisting: ["", "fallback"] }, ""],
  ])("%s", (_moment, expression, expected) => {
    expect(evaluate(expression, {})).toEqual(expected);
  });
});

test("D1 · structured references read the same snapshot as dotted references", () => {
  const snapshot = { "self.prompt.role.value": " A " };
  expect(
    evaluate(
      {
        reference: {
          position: "self",
          source: "prompt",
          name: "role",
          path: ["value"],
        },
        comparator: "equals",
        value: "a",
      },
      snapshot,
    ),
  ).toBe(true);
  expect(
    evaluate(
      { reference: "self.prompt.role.value", comparator: "equals", value: "a" },
      snapshot,
    ),
  ).toBe(true);
});
