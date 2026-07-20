import { describe, test, expect } from "vitest";
import {
  getReferencedAssets,
  collectAssetPrefixes,
  getMarkdownImageReferences,
  type ReferencedAsset,
  type MarkdownImageReference,
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

describe("getMarkdownImageReferences — defensive input", () => {
  test("returns [] for empty string", () => {
    expect(getMarkdownImageReferences("")).toEqual([]);
  });

  test("returns [] for markdown with no images", () => {
    expect(
      getMarkdownImageReferences(
        "# Heading\n\nSome **bold** text and a [link](x).",
      ),
    ).toEqual([]);
  });

  test("returns [] for non-string input", () => {
    // Callers pass raw prompt bodies; be defensive like getReferencedAssets.
    expect(getMarkdownImageReferences(null as unknown as string)).toEqual([]);
    expect(getMarkdownImageReferences(undefined as unknown as string)).toEqual(
      [],
    );
    expect(getMarkdownImageReferences(42 as unknown as string)).toEqual([]);
  });
});

describe("getMarkdownImageReferences — basic collection", () => {
  test("collects a single inline image with path and alt", () => {
    const refs = getMarkdownImageReferences("![A diagram](images/flow.png)");
    expect(refs).toEqual<MarkdownImageReference[]>([
      { path: "images/flow.png", alt: "A diagram", line: 0, column: 0 },
    ]);
  });

  test("collects an image with empty alt", () => {
    const refs = getMarkdownImageReferences("![](logo.png)");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ path: "logo.png", alt: "" });
  });

  test("collects multiple images across lines in document order", () => {
    const md = [
      "Intro paragraph.",
      "",
      "![first](a.png)",
      "",
      "Middle text ![second](sub/b.jpg) inline.",
    ].join("\n");
    const refs = getMarkdownImageReferences(md);
    expect(refs.map((r) => r.path)).toEqual(["a.png", "sub/b.jpg"]);
    expect(refs[0]).toMatchObject({ line: 2, column: 0 });
    // "Middle text " is 12 chars, so the image starts at column 12.
    expect(refs[1]).toMatchObject({ line: 4, column: 12 });
  });

  test("collects two images on the same line with correct columns", () => {
    const refs = getMarkdownImageReferences("![a](x.png) ![b](y.png)");
    expect(refs.map((r) => r.path)).toEqual(["x.png", "y.png"]);
    expect(refs.map((r) => r.column)).toEqual([0, 12]);
  });
});

describe("getMarkdownImageReferences — destination forms", () => {
  test("strips a title after a bare destination", () => {
    const refs = getMarkdownImageReferences('![a](images/x.png "My title")');
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("images/x.png");
  });

  test("handles an angle-bracket destination with a space", () => {
    const refs = getMarkdownImageReferences("![a](<my pic.png>)");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("my pic.png");
  });

  test("handles an angle-bracket destination followed by a title", () => {
    const refs = getMarkdownImageReferences("![a](<my pic.png> 'cap')");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("my pic.png");
  });

  test("trims whitespace around a bare destination inside the parens", () => {
    const refs = getMarkdownImageReferences("![a](  images/x.png  )");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("images/x.png");
  });
});

describe("getMarkdownImageReferences — exclusions", () => {
  test("excludes http, https, and protocol-relative URLs", () => {
    const md = [
      "![a](http://example.com/a.png)",
      "![b](https://example.com/b.png)",
      "![c](//cdn.example.com/c.png)",
    ].join("\n");
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("excludes data: URIs (embedded, not a local file)", () => {
    const md =
      "![placeholder](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)";
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("excludes asset:// and opaque asset: references", () => {
    const md = ["![a](asset://diagrams/flow.png)", "![b](asset:flow.png)"].join(
      "\n",
    );
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("excludes paths containing a ${…} template placeholder", () => {
    const md = ["![a](${region}/logo.png)", "![b](img/${variant}.png)"].join(
      "\n",
    );
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("excludes an empty destination", () => {
    expect(getMarkdownImageReferences("![alt]()")).toEqual([]);
  });

  test("keeps a local path alongside excluded ones", () => {
    const md = [
      "![remote](https://example.com/a.png)",
      "![local](images/b.png)",
      "![embedded](data:image/png;base64,AAAA)",
    ].join("\n");
    const refs = getMarkdownImageReferences(md);
    expect(refs.map((r) => r.path)).toEqual(["images/b.png"]);
  });
});

describe("getMarkdownImageReferences — fenced code blocks", () => {
  test("skips images inside a fenced code block", () => {
    const md = [
      "Here is how to embed an image:",
      "",
      "```markdown",
      "![example](images/should-not-count.png)",
      "```",
      "",
      "![real](images/counts.png)",
    ].join("\n");
    const refs = getMarkdownImageReferences(md);
    expect(refs.map((r) => r.path)).toEqual(["images/counts.png"]);
    expect(refs[0].line).toBe(6);
  });

  test("a fence with an info string still toggles code mode", () => {
    const md = ["```js", "// ![nope](x.png)", "```", "![yes](y.png)"].join(
      "\n",
    );
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "y.png",
    ]);
  });

  test("skips images inside a ~~~ (tilde) fenced code block", () => {
    const md = [
      "~~~",
      "![inside](images/nope.png)",
      "~~~",
      "![outside](images/yes.png)",
    ].join("\n");
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "images/yes.png",
    ]);
  });

  test("a shorter inner fence does not close a longer outer fence", () => {
    // A 3-backtick line can't close a 4-backtick fence (CommonMark), so
    // everything between the ```` fences is code.
    const md = [
      "````",
      "![a](inside-code.png)",
      "```",
      "![b](still-inside.png)",
      "````",
      "![c](real.png)",
    ].join("\n");
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "real.png",
    ]);
  });

  test("an unclosed fence swallows the rest of the document", () => {
    const md = ["```", "![a](x.png)", "still code, no close"].join("\n");
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });
});

describe("getMarkdownImageReferences — title forms and edge cases", () => {
  test("strips a parenthesised title", () => {
    const refs = getMarkdownImageReferences("![d](x.png (Figure 1))");
    expect(refs.map((r) => r.path)).toEqual(["x.png"]);
  });

  test("a closing paren inside a title does not truncate the path", () => {
    const refs = getMarkdownImageReferences(
      '![chart](results.png "Results (final)")',
    );
    expect(refs.map((r) => r.path)).toEqual(["results.png"]);
  });

  test("an angle-bracket destination may contain both spaces and parens", () => {
    const refs = getMarkdownImageReferences("![a](<screenshot (1).png>)");
    expect(refs.map((r) => r.path)).toEqual(["screenshot (1).png"]);
  });

  test("captures alt text verbatim including punctuation and escaped brackets", () => {
    const refs = getMarkdownImageReferences(
      '![Figure 1: "cats" \\] end](x.png)',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      alt: 'Figure 1: "cats" \\] end',
      path: "x.png",
    });
  });

  test("a whitespace-only destination is not a match", () => {
    expect(getMarkdownImageReferences("![a](   )")).toEqual([]);
  });

  test("column of a second image accounts for a title on the first", () => {
    const md = '![a](x.png "t") ![b](y.png)';
    const refs = getMarkdownImageReferences(md);
    expect(refs.map((r) => r.path)).toEqual(["x.png", "y.png"]);
    // `![a](x.png "t") ` is 16 chars, so the second image starts at column 16.
    expect(refs.map((r) => r.column)).toEqual([0, 16]);
  });
});

describe("getMarkdownImageReferences — documented non-goals", () => {
  test("reference-style images are not matched", () => {
    const md = ["![alt][ref]", "", "[ref]: real.png"].join("\n");
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("raw <img> HTML is not matched (renderer loads no rehype-raw)", () => {
    expect(getMarkdownImageReferences('<img src="pic.png" alt="x">')).toEqual(
      [],
    );
  });

  test("excludes an uppercase ASSET:// scheme", () => {
    expect(
      getMarkdownImageReferences("![a](ASSET://diagrams/flow.png)"),
    ).toEqual([]);
  });

  test("excludes a non-data, non-asset URI scheme (mailto:)", () => {
    // Exercises URI_SCHEME_PATTERN independently of isCollectableLocalPath.
    expect(getMarkdownImageReferences("![a](mailto:foo@example.com)")).toEqual(
      [],
    );
  });
});

describe("getMarkdownImageReferences — line endings and positions", () => {
  test("handles CRLF line endings without leaking \\r into paths", () => {
    const md = "![a](x.png)\r\n![b](y.png)";
    const refs = getMarkdownImageReferences(md);
    expect(refs).toEqual<MarkdownImageReference[]>([
      { path: "x.png", alt: "a", line: 0, column: 0 },
      { path: "y.png", alt: "b", line: 1, column: 0 },
    ]);
  });

  test("detects a CRLF fenced block and its close", () => {
    const md = "```md\r\n![no](a.png)\r\n```\r\n![yes](b.png)";
    const refs = getMarkdownImageReferences(md);
    expect(refs.map((r) => r.path)).toEqual(["b.png"]);
    expect(refs[0].line).toBe(3);
  });

  test("column is a UTF-16 offset (a surrogate pair counts as two)", () => {
    // A leading emoji occupies two UTF-16 code units.
    const refs = getMarkdownImageReferences("😀![a](x.png)");
    expect(refs).toHaveLength(1);
    expect(refs[0].column).toBe(2);
  });
});

describe("getMarkdownImageReferences — resistance to adversarial input", () => {
  test("an unterminated image with a long whitespace run resolves quickly", () => {
    // Regression guard for the quadratic-backtracking ReDoS: a single line
    // `![](x` + a huge space run with no closing `)` must not blow up.
    const line = "![](x" + " ".repeat(100_000);
    const start = performance.now();
    const refs = getMarkdownImageReferences(line);
    const elapsedMs = performance.now() - start;
    expect(refs).toEqual([]);
    // Linear matching finishes in well under 100ms; the quadratic bug took
    // ~16s at this size.
    expect(elapsedMs).toBeLessThan(1000);
  });
});
