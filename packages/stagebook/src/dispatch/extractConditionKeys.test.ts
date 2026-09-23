import { describe, test, expect } from "vitest";
import { extractConditionKeys } from "./extractConditionKeys.js";
import type { Treatment } from "./types.js";

describe("extractConditionKeys", () => {
  test("returns empty set for treatments with no groupComposition", () => {
    const treatments: Treatment[] = [
      { name: "t0", playerCount: 2 },
      { name: "t1", playerCount: 3 },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set());
  });

  test("returns empty set when groupComposition slots have no conditions", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [{ position: 0 }, { position: 1 }],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set());
  });

  test("collects storage-keys from flat-array condition lists", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "moderator",
              },
            ],
          },
          {
            position: 1,
            conditions: [
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "participant",
              },
            ],
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set(["prompt_role"]));
  });

  test("descends into all/any/none operator nodes", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: {
              any: [
                {
                  reference: "self.prompt.role",
                  comparator: "equals",
                  value: "a",
                },
                {
                  none: [
                    {
                      reference: "self.qualtrics.tipi",
                      comparator: "exists",
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(
      new Set(["prompt_role", "qualtrics_tipi"]),
    );
  });

  test("collects external-source keys (entryUrl) as their bare source name", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: [
              {
                reference: "self.entryUrl.params.condition",
                comparator: "equals",
                value: "treatment",
              },
            ],
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set(["entryUrl"]));
  });

  test("skips numeric / shared / all selectors (not resolvable from candidate alone)", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [
          {
            position: 0,
            conditions: [
              { reference: "0.prompt.role", comparator: "equals", value: "a" },
              { reference: "shared.prompt.x", comparator: "exists" },
              { reference: "all.prompt.y", comparator: "exists" },
            ],
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set());
  });

  test("silently skips malformed references (validator surfaces them)", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: [
              { reference: "self", comparator: "exists" },
              {
                reference: "self.prompt.role",
                comparator: "equals",
                value: "x",
              },
            ],
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set(["prompt_role"]));
  });

  test("deduplicates across treatments and slots", () => {
    const treatments: Treatment[] = [
      {
        name: "t0",
        playerCount: 2,
        groupComposition: [
          {
            position: 0,
            conditions: [
              { reference: "self.prompt.role", comparator: "exists" },
            ],
          },
          {
            position: 1,
            conditions: [
              { reference: "self.prompt.role", comparator: "exists" },
            ],
          },
        ],
      },
      {
        name: "t1",
        playerCount: 1,
        groupComposition: [
          {
            position: 0,
            conditions: [
              { reference: "self.prompt.role", comparator: "exists" },
            ],
          },
        ],
      },
    ];
    expect(extractConditionKeys(treatments)).toEqual(new Set(["prompt_role"]));
  });
});
