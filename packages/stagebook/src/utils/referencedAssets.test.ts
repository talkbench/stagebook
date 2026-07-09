import { describe, test, expect } from "vitest";
import {
  getReferencedAssets,
  collectAssetPrefixes,
  type ReferencedAsset,
} from "./referencedAssets.js";

// Helper: wrap a set of elements into a minimal treatmentFile-shaped object so
// tests exercise the real tree-walk (top level → treatments → gameStages →
// elements) rather than passing elements in isolation.
function treatmentWithElements(elements: unknown[]): unknown {
  return {
    introSequences: [],
    treatments: [
      {
        name: "t1",
        playerCount: 1,
        gameStages: [
          {
            name: "stage1",
            duration: 60,
            elements,
          },
        ],
      },
    ],
  };
}

describe("getReferencedAssets — defensive input handling", () => {
  test("returns [] for null", () => {
    expect(getReferencedAssets(null)).toEqual([]);
  });

  test("returns [] for undefined", () => {
    expect(getReferencedAssets(undefined)).toEqual([]);
  });

  test("returns [] for primitive", () => {
    expect(getReferencedAssets("foo")).toEqual([]);
    expect(getReferencedAssets(42)).toEqual([]);
    expect(getReferencedAssets(true)).toEqual([]);
  });

  test("returns [] for empty object", () => {
    expect(getReferencedAssets({})).toEqual([]);
  });
});

describe("getReferencedAssets — element type allowlist", () => {
  test("prompt.file is collected", () => {
    const tree = treatmentWithElements([
      { type: "prompt", file: "intro.prompt.md" },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      path: "intro.prompt.md",
      field: "file",
      elementType: "prompt",
    });
  });

  test("image.file is collected", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "assets/diagram.png", name: "diagram" },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets).toEqual<ReferencedAsset[]>([
      {
        path: "assets/diagram.png",
        field: "file",
        elementType: "image",
        elementName: "diagram",
        pathInTree: ["treatments", 0, "gameStages", 0, "elements", 0, "file"],
      },
    ]);
  });

  test("audio.file is collected", () => {
    const tree = treatmentWithElements([
      { type: "audio", file: "sounds/bell.mp3" },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      path: "sounds/bell.mp3",
      field: "file",
      elementType: "audio",
    });
  });

  test("mediaPlayer.file and mediaPlayer.captionsFile are both collected", () => {
    const tree = treatmentWithElements([
      {
        type: "mediaPlayer",
        file: "videos/intro.mp4",
        captionsFile: "videos/intro.vtt",
      },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets.map((a) => ({ path: a.path, field: a.field }))).toEqual([
      { path: "videos/intro.mp4", field: "file" },
      { path: "videos/intro.vtt", field: "captionsFile" },
    ]);
    expect(assets.every((a) => a.elementType === "mediaPlayer")).toBe(true);
  });

  test("timeline has no file-like fields — source is a name ref, not collected", () => {
    const tree = treatmentWithElements([
      {
        type: "timeline",
        name: "annots",
        source: "someElementName",
        selectionType: "point",
      },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("element types not in the allowlist contribute nothing", () => {
    const tree = treatmentWithElements([
      {
        type: "trackedLink",
        name: "followUp",
        url: "https://example.com/f",
        displayText: "Go",
      },
      { type: "qualtrics", url: "https://example.com/q" },
      { type: "survey", surveyName: "bigFive" },
      { type: "submitButton" },
      { type: "separator" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });
});

describe("getReferencedAssets — exclusions", () => {
  test("excludes entries with ${…} placeholder in the path", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "${region}/logo.png" },
      { type: "prompt", file: "prompts/${variant}.prompt.md" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("excludes mediaPlayer.file when the value is a full https URL", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "https://example.com/foo.mp4" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("excludes full http and protocol-relative URLs", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "http://example.com/a.mp4" },
      { type: "mediaPlayer", file: "//cdn.example.com/b.mp4" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("excludes asset:// platform-provided references (#188)", () => {
    const tree = treatmentWithElements([
      {
        type: "mediaPlayer",
        file: "asset://group_recordings/training_video.mp4",
      },
      { type: "image", file: "asset://diagrams/flow.png" },
      { type: "audio", file: "asset://stings/intro.mp3" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("is case-insensitive on the asset:// scheme", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "ASSET://clip.mp4" },
      { type: "mediaPlayer", file: "Asset://clip.mp4" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("excludes malformed opaque `asset:` form too (no //)", () => {
    // Guard against an `asset:clip.mp4` slipping through as a "local
    // file" when `fileSchema` would have rejected it upstream.
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "asset:clip.mp4" },
      { type: "image", file: "asset:diagram.png" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("excludes empty string paths", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "" },
      { type: "mediaPlayer", file: "", captionsFile: "" },
    ]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("keeps local paths that merely contain a placeholder-like substring without braces", () => {
    // Only ${...} with braces counts as a template placeholder; a literal "$"
    // in a filename is fine.
    const tree = treatmentWithElements([
      { type: "image", file: "assets/price_$_99.png" },
    ]);
    expect(getReferencedAssets(tree)).toHaveLength(1);
  });
});

describe("getReferencedAssets — structural walk", () => {
  test("collects from intro sequences, game stages, and exit sequence in file order", () => {
    const tree = {
      introSequences: [
        {
          name: "seq1",
          introSteps: [
            {
              name: "welcome",
              elements: [{ type: "image", file: "intro/banner.png" }],
            },
          ],
        },
      ],
      treatments: [
        {
          name: "t1",
          playerCount: 1,
          gameStages: [
            {
              name: "stage1",
              duration: 60,
              elements: [
                { type: "audio", file: "stage/ping.mp3" },
                { type: "image", file: "stage/diagram.png" },
              ],
            },
          ],
          exitSequence: [
            {
              name: "goodbye",
              elements: [{ type: "prompt", file: "exit/thanks.prompt.md" }],
            },
          ],
        },
      ],
    };

    const assets = getReferencedAssets(tree);
    expect(assets.map((a) => a.path)).toEqual([
      "intro/banner.png",
      "stage/ping.mp3",
      "stage/diagram.png",
      "exit/thanks.prompt.md",
    ]);
  });

  test("returns correct pathInTree for an asset deep inside a gameStages array", () => {
    const tree = {
      introSequences: [],
      treatments: [
        {
          name: "t1",
          playerCount: 1,
          gameStages: [
            { name: "s0", duration: 60, elements: [{ type: "separator" }] },
            {
              name: "s1",
              duration: 60,
              elements: [
                { type: "separator" },
                { type: "image", file: "deep/nested.png", name: "target" },
              ],
            },
          ],
        },
      ],
    };

    const assets = getReferencedAssets(tree);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      path: "deep/nested.png",
      field: "file",
      elementType: "image",
      elementName: "target",
      pathInTree: ["treatments", 0, "gameStages", 1, "elements", 1, "file"],
    });
  });

  test("walks into templates so templated element trees contribute assets", () => {
    const tree = {
      templates: [
        {
          name: "introTpl",
          contentType: "elements",
          content: [{ type: "image", file: "templated/img.png" }],
        },
      ],
      introSequences: [],
      treatments: [],
    };
    const assets = getReferencedAssets(tree);
    expect(assets.map((a) => a.path)).toEqual(["templated/img.png"]);
  });

  test("mediaPlayer captionsFile is collected even when url is a full URL", () => {
    // Under-validation regression guard: the reason this utility exists is
    // that the VS Code extension only checked `file`, missing captionsFile.
    const tree = treatmentWithElements([
      {
        type: "mediaPlayer",
        file: "https://example.com/foo.mp4",
        captionsFile: "captions/foo.vtt",
      },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      path: "captions/foo.vtt",
      field: "captionsFile",
    });
  });

  test("order within a single element follows field-declaration order (file before captionsFile)", () => {
    const tree = treatmentWithElements([
      {
        // Author wrote captionsFile first, file second — utility order is
        // governed by the allowlist table, not YAML key order.
        captionsFile: "cap.vtt",
        file: "video.mp4",
        type: "mediaPlayer",
      },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets.map((a) => a.field)).toEqual(["file", "captionsFile"]);
  });

  test("omits elementName when the element has no name", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "assets/unnamed.png" },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets).toHaveLength(1);
    expect(assets[0].elementName).toBeUndefined();
  });

  test("pathInTree for mediaPlayer points at the specific field, not the element", () => {
    // Regression guard: pathInTree must include the field name so that
    // consumers can do source mapping directly without appending `field`.
    const tree = treatmentWithElements([
      {
        type: "mediaPlayer",
        file: "videos/x.mp4",
        captionsFile: "videos/x.vtt",
      },
    ]);
    const assets = getReferencedAssets(tree);
    expect(assets[0].pathInTree).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
      "file",
    ]);
    expect(assets[1].pathInTree).toEqual([
      "treatments",
      0,
      "gameStages",
      0,
      "elements",
      0,
      "captionsFile",
    ]);
  });
});

describe("getReferencedAssets — bare strings inside elements are not collected", () => {
  // Prompt shorthand was removed in #245. Bare strings inside an `elements`
  // array now fail schema validation rather than silently becoming prompts;
  // the walker no longer recognises them, even though it runs pre-validation.
  test("bare .prompt.md string inside elements is not collected", () => {
    const tree = treatmentWithElements(["intro.prompt.md"]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });

  test("non-.prompt.md strings inside elements are not collected", () => {
    const tree = treatmentWithElements(["not-a-prompt.txt", 42, null]);
    expect(getReferencedAssets(tree)).toEqual([]);
  });
});

describe("getReferencedAssets — malformed input safety", () => {
  test("element with a prototype-chain `type` value doesn't crash the walker", () => {
    // `type in FILE_FIELDS_BY_ELEMENT_TYPE` would match built-in
    // Object.prototype keys like `toString`; using Object.hasOwn keeps the
    // walker safe from untrusted YAML that sets `type: "toString"`.
    const tree = treatmentWithElements([
      { type: "toString", file: "whatever" },
      { type: "constructor", file: "whatever" },
      { type: "__proto__", file: "whatever" },
    ]);
    expect(() => getReferencedAssets(tree)).not.toThrow();
    expect(getReferencedAssets(tree)).toEqual([]);
  });
});

describe("collectAssetPrefixes (#192)", () => {
  test("returns [] for non-object / empty input", () => {
    expect(collectAssetPrefixes(null)).toEqual([]);
    expect(collectAssetPrefixes(undefined)).toEqual([]);
    expect(collectAssetPrefixes("asset://x/y.mp4")).toEqual([]);
    expect(collectAssetPrefixes({})).toEqual([]);
  });

  test("collects the prefix from a single asset:// reference", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "asset://group_recordings/session.mp4" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual(["group_recordings"]);
  });

  test("collects across every asset://-bearing field/element type", () => {
    const tree = treatmentWithElements([
      { type: "prompt", file: "asset://prompts/intro.prompt.md" },
      { type: "image", file: "asset://diagrams/flow.png" },
      { type: "audio", file: "asset://clips/intro.mp3" },
      {
        type: "mediaPlayer",
        file: "asset://videos/a.mp4",
        captionsFile: "asset://captions/a.vtt",
      },
    ]);
    expect(collectAssetPrefixes(tree).sort()).toEqual([
      "captions",
      "clips",
      "diagrams",
      "prompts",
      "videos",
    ]);
  });

  test("dedupes a prefix used by multiple references", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "asset://recordings/a.mp4" },
      { type: "mediaPlayer", file: "asset://recordings/b.mp4" },
      { type: "audio", file: "asset://recordings/c.mp3" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual(["recordings"]);
  });

  test("preserves prefix case (mount key is looked up exactly)", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "ASSET://Group_Recordings/x.png" },
    ]);
    // Scheme match is case-insensitive; the prefix case is preserved.
    expect(collectAssetPrefixes(tree)).toEqual(["Group_Recordings"]);
  });

  test("ignores relative paths and http(s) URLs (only asset://)", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "images/logo.png" },
      { type: "audio", file: "https://cdn.example/clip.mp3" },
      { type: "mediaPlayer", file: "//cdn.example/v.mp4" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual([]);
  });

  test("ignores an opaque asset: URI with no //host (not mountable)", () => {
    const tree = treatmentWithElements([
      { type: "image", file: "asset:clip.png" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual([]);
  });

  test("skips a prefix that is still a ${…} placeholder", () => {
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "asset://${clipset}/x.mp4" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual([]);
  });

  test("collects a concrete prefix even when the REST holds a ${…}", () => {
    // Only the prefix must be concrete to mount; the path can bind later.
    const tree = treatmentWithElements([
      { type: "mediaPlayer", file: "asset://recordings/${clip}.mp4" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual(["recordings"]);
  });

  test("does not treat a name-reference field (timeline.source) as an asset", () => {
    const tree = treatmentWithElements([
      { type: "timeline", source: "asset://x/y.mp4" },
    ]);
    expect(collectAssetPrefixes(tree)).toEqual([]);
  });

  test("finds prefixes in introSequences, not just game stages", () => {
    const tree = {
      introSequences: [
        {
          name: "intro",
          introSteps: [
            {
              name: "welcome",
              elements: [
                { type: "image", file: "asset://onboarding/welcome.png" },
              ],
            },
          ],
        },
      ],
      treatments: [],
    };
    expect(collectAssetPrefixes(tree)).toEqual(["onboarding"]);
  });
});
