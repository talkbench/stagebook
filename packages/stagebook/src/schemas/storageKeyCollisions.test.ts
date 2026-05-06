import { describe, it, expect } from "vitest";
import { collectStorageKeyCollisions } from "./storageKeyCollisions.js";

describe("collectStorageKeyCollisions", () => {
  it("returns no collisions for an empty/invalid input", () => {
    expect(collectStorageKeyCollisions(undefined)).toEqual([]);
    expect(collectStorageKeyCollisions(null)).toEqual([]);
    expect(collectStorageKeyCollisions("not an object")).toEqual([]);
    expect(collectStorageKeyCollisions({})).toEqual([]);
  });

  it("returns no collisions when all storage keys are unique", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "q1", file: "a.prompt.md" },
                { type: "prompt", name: "q2", file: "b.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectStorageKeyCollisions(data)).toEqual([]);
  });

  it("flags duplicates within a single stage", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "q1", file: "a.prompt.md" },
                { type: "prompt", name: "q1", file: "b.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("prompt_q1");
    expect(collisions[0].paths).toHaveLength(2);
  });

  it("flags duplicates ACROSS game stages within a treatment", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "preTest",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
            {
              name: "postTest",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("prompt_q1");
    expect(collisions[0].paths).toHaveLength(2);
  });

  it("flags duplicates between game stages and exit sequence in the same treatment", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
          exitSequence: [
            {
              name: "exit1",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("prompt_shared");
  });

  it("flags duplicates between intro sequence and game stage (cross-pair)", () => {
    const data = {
      introSequences: [
        {
          name: "intro1",
          introSteps: [
            {
              name: "welcome",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("prompt_shared");
    expect(collisions[0].message).toContain("introSequence");
    expect(collisions[0].message).toContain("treatment");
  });

  it("does NOT flag duplicates across separate treatments (each participant only experiences one)", () => {
    const data = {
      treatments: [
        {
          name: "treatment_A",
          gameStages: [
            {
              name: "stage1",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
          ],
        },
        {
          name: "treatment_B",
          gameStages: [
            {
              name: "stage1",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
          ],
        },
      ],
    };
    expect(collectStorageKeyCollisions(data)).toEqual([]);
  });

  it("does NOT flag duplicates across separate intro sequences (each participant only goes through one)", () => {
    const data = {
      introSequences: [
        {
          name: "intro1",
          introSteps: [
            {
              name: "s1",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
          ],
        },
        {
          name: "intro2",
          introSteps: [
            {
              name: "s1",
              elements: [{ type: "prompt", name: "q1", file: "a.prompt.md" }],
            },
          ],
        },
      ],
    };
    expect(collectStorageKeyCollisions(data)).toEqual([]);
  });

  it("flags an intro key colliding with EVERY treatment as a separate cross-pair (since any pairing is possible)", () => {
    const data = {
      introSequences: [
        {
          name: "intro1",
          introSteps: [
            {
              name: "welcome",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "treatment_A",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
        {
          name: "treatment_B",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "shared", file: "a.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(2);
    expect(collisions[0].message).toContain("treatment");
    expect(collisions[1].message).toContain("treatment");
  });

  it("does not flag identical names on different element types as duplicates", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "X", file: "a.prompt.md" },
                { type: "audio", name: "X", file: "a.mp3" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectStorageKeyCollisions(data)).toEqual([]);
  });

  it("derives keys for audio (name OR file fallback)", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "audio", file: "intro.mp3" },
                { type: "audio", file: "intro.mp3" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("audio_intro.mp3");
  });

  it("derives keys for mediaPlayer (name OR file fallback) — matches Element.tsx runtime", () => {
    // Per Element.tsx:277, mediaPlayer falls back to the raw `file` field
    // (NOT `url` — that field was renamed to `file` in #249).
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "mediaPlayer", file: "intro.mp4" },
                { type: "mediaPlayer", file: "intro.mp4" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("mediaPlayer_intro.mp4");
  });

  it("flags any two qualtrics elements in the same scope as colliding (fixed key)", () => {
    // Qualtrics writes to a fixed `qualtricsDataReady` key regardless of
    // name/url (Qualtrics.tsx:50), so any two qualtrics elements in the
    // same scope silently overwrite each other.
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "qualtrics", url: "https://example.qualtrics.com/a" },
                { type: "qualtrics", url: "https://example.qualtrics.com/b" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].paths).toHaveLength(2);
  });

  it("flags qualtrics elements as colliding even across stages within a treatment", () => {
    // Different URLs, different stages — still collides because the key is fixed.
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "qualtrics", url: "https://example.qualtrics.com/a" },
              ],
            },
            {
              name: "stage2",
              elements: [
                { type: "qualtrics", url: "https://example.qualtrics.com/b" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].paths).toHaveLength(2);
  });

  it("derives keys for survey (name OR surveyName fallback)", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "survey", surveyName: "TIPI" },
                { type: "survey", surveyName: "TIPI" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].key).toBe("survey_TIPI");
  });

  it("skips elements without a derivable storage key (unnamed prompts/submitButtons)", () => {
    // Unnamed prompts derive their key from progressLabel + metadata at runtime,
    // which isn't statically derivable, so we don't check them.
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", file: "a.prompt.md" },
                { type: "prompt", file: "b.prompt.md" },
                { type: "submitButton" },
                { type: "submitButton" },
              ],
            },
          ],
        },
      ],
    };
    expect(collectStorageKeyCollisions(data)).toEqual([]);
  });

  it("groups three-or-more duplicates into one entry with all paths", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "q1", file: "a.prompt.md" },
                { type: "prompt", name: "q1", file: "b.prompt.md" },
              ],
            },
            {
              name: "stage2",
              elements: [{ type: "prompt", name: "q1", file: "c.prompt.md" }],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].paths).toHaveLength(3);
  });

  it("emits messages that mention the duplicated key", () => {
    const data = {
      treatments: [
        {
          name: "t1",
          gameStages: [
            {
              name: "stage1",
              elements: [
                { type: "prompt", name: "q1", file: "a.prompt.md" },
                { type: "prompt", name: "q1", file: "b.prompt.md" },
              ],
            },
          ],
        },
      ],
    };
    const collisions = collectStorageKeyCollisions(data);
    expect(collisions[0].message).toContain('"prompt_q1"');
  });
});
