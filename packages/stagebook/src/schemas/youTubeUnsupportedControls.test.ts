import { describe, it, expect } from "vitest";
import { collectYouTubeUnsupportedControls } from "./youTubeUnsupportedControls.js";
import { validateTreatmentSource } from "../validate/validateTreatment.js";
import { expandAndValidate } from "../validate/expandAndValidate.js";
import { safeParseTreatmentFile } from "./safeParseTreatmentFile.js";

const YOUTUBE = "https://www.youtube.com/watch?v=QC8iQqtG0hg";
const UPLOADED = "shared/clip.mp4";

/** A one-stage treatment file holding a single mediaPlayer. */
function fileWith(file: string, controls?: Record<string, boolean>) {
  return {
    treatments: [
      {
        name: "t",
        playerCount: 1,
        compatibleIntroSequences: [],
        gameStages: [
          {
            name: "s1",
            duration: 60,
            elements: [
              {
                type: "mediaPlayer",
                name: "clip",
                file,
                ...(controls ? { controls } : {}),
              },
              { type: "submitButton" },
            ],
          },
        ],
      },
    ],
  };
}

const NO_VISIBLE_CONTROL = /no on-screen control/i;

describe("collectYouTubeUnsupportedControls (#723)", () => {
  it("returns nothing for empty/invalid input", () => {
    expect(collectYouTubeUnsupportedControls(undefined)).toEqual([]);
    expect(collectYouTubeUnsupportedControls(null)).toEqual([]);
    expect(collectYouTubeUnsupportedControls("not an object")).toEqual([]);
    expect(collectYouTubeUnsupportedControls({})).toEqual([]);
  });

  it.each([
    [{ step: true }, "step"],
    [{ speed: true }, "speed"],
    [{ step: true, speed: true }, "step"],
  ])(
    "warns for YouTube + %o, saying participants see no on-screen control",
    (controls, named) => {
      const issues = collectYouTubeUnsupportedControls(
        fileWith(YOUTUBE, controls),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toEqual([
        "treatments",
        0,
        "gameStages",
        0,
        "elements",
        0,
        "controls",
      ]);
      expect(issues[0].message).toMatch(/YouTube/);
      expect(issues[0].message).toContain(named);
      expect(issues[0].message).toMatch(NO_VISIBLE_CONTROL);
    },
  );

  it("names both step and speed when both are on", () => {
    const [issue] = collectYouTubeUnsupportedControls(
      fileWith(YOUTUBE, { step: true, speed: true }),
    );
    expect(issue.message).toContain("`controls.step`");
    expect(issue.message).toContain("`controls.speed`");
  });

  it.each([
    [{ playPause: true, step: true }],
    [{ seek: true, speed: true }],
    [{ playPause: true, seek: true, step: true, speed: true }],
  ])(
    "warns for YouTube + %o without the no-visible-control wording",
    (controls) => {
      const issues = collectYouTubeUnsupportedControls(
        fileWith(YOUTUBE, controls),
      );
      expect(issues).toHaveLength(1);
      expect(issues[0].message).toMatch(/YouTube/);
      expect(issues[0].message).not.toMatch(NO_VISIBLE_CONTROL);
    },
  );

  it.each([
    ["YouTube + playPause", YOUTUBE, { playPause: true }],
    ["YouTube + seek", YOUTUBE, { seek: true }],
    ["YouTube + step: false", YOUTUBE, { playPause: true, step: false }],
    ["YouTube with no controls", YOUTUBE, undefined],
    ["an uploaded file with step", UPLOADED, { step: true }],
    ["an uploaded file with speed", UPLOADED, { speed: true }],
  ])("is silent for %s", (_label, file, controls) => {
    expect(collectYouTubeUnsupportedControls(fileWith(file, controls))).toEqual(
      [],
    );
  });

  it("skips an unfilled ${field} placeholder file without crashing", () => {
    expect(
      collectYouTubeUnsupportedControls(
        fileWith("${videoUrl}", { step: true }),
      ),
    ).toEqual([]);
  });

  it("skips a non-string file without crashing", () => {
    const data = fileWith(YOUTUBE, { step: true });
    (data.treatments[0].gameStages[0].elements[0] as { file: unknown }).file =
      42;
    expect(collectYouTubeUnsupportedControls(data)).toEqual([]);
  });

  it("scans exit sequences, intro sequences, and consent arms", () => {
    const player = {
      type: "mediaPlayer",
      file: YOUTUBE,
      controls: { speed: true },
    };
    const data = {
      introSequences: [
        { name: "i1", introSteps: [{ name: "s", elements: [player] }] },
      ],
      consent: [{ name: "c1", steps: [{ name: "s", elements: [player] }] }],
      treatments: [
        {
          name: "t1",
          gameStages: [],
          exitSequence: [{ name: "s", elements: [player] }],
        },
      ],
    };
    const issues = collectYouTubeUnsupportedControls(data);
    expect(issues.map((i) => i.path[0]).sort()).toEqual([
      "consent",
      "introSequences",
      "treatments",
    ]);
  });
});

describe("YouTube step/speed is a WARNING, never a schema failure (#723)", () => {
  it.each([
    [{ step: true }],
    [{ speed: true }],
    [{ step: true, speed: true }],
    [{ playPause: true, step: true }],
  ])("safeParseTreatmentFile still succeeds for YouTube + %o", (controls) => {
    expect(safeParseTreatmentFile(fileWith(YOUTUBE, controls)).success).toBe(
      true,
    );
  });

  const src = (file: string) => `treatments:
  - name: t
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - name: s1
        duration: 60
        elements:
          - type: mediaPlayer
            name: clip
            file: ${file}
            controls:
              speed: true
          - type: submitButton
`;

  it("validateTreatmentSource surfaces it as a WARNING", () => {
    const { diagnostics } = validateTreatmentSource(src(YOUTUBE));
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const warn = diagnostics.find((d) => /YouTube/.test(d.message));
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("warning");
    expect(diagnostics.filter((d) => /YouTube/.test(d.message))).toHaveLength(
      1,
    );
  });

  it("validateTreatmentSource is silent for an uploaded file", () => {
    const { diagnostics } = validateTreatmentSource(src(UPLOADED));
    expect(diagnostics).toEqual([]);
  });

  it("fires on the expanded pass when `file` comes from a template field", () => {
    const source = `templates:
  - name: clipStage
    contentType: stage
    content:
      name: stage1
      duration: 60
      elements:
        - type: mediaPlayer
          name: clip
          file: \${videoUrl}
          controls:
            step: true
        - type: submitButton
treatments:
  - name: study1
    playerCount: 1
    compatibleIntroSequences: []
    gameStages:
      - template: clipStage
        fields:
          videoUrl: ${YOUTUBE}`;
    const result = expandAndValidate(source);
    expect(result.expandError).toBeNull();
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    const warn = result.diagnostics.find((d) => /YouTube/.test(d.message));
    expect(warn).toBeDefined();
    expect(warn!.severity).toBe("warning");
  });
});
