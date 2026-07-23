import { describe, test, expect } from "vitest";
import {
  getMarkdownImageReferences,
  type MarkdownImageReference,
} from "./markdownImageReferences.js";

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

describe("getMarkdownImageReferences — destination forms (CommonMark semantics)", () => {
  // The enumerator parses the SAME CommonMark grammar the renderer uses (#576),
  // so it reports the destination the renderer actually requests — titles
  // stripped, `<…>` unwrapped, balanced parens kept, whitespace trimmed.

  test("a bare (unescaped) space destination is NOT an image", () => {
    // CommonMark stops a non-`<…>` destination at the first space, so
    // `![photo](folder/my pic.jpg)` renders as literal text, not an image —
    // the renderer requests nothing, so neither do we. Use `<…>` for spaces.
    expect(getMarkdownImageReferences("![photo](folder/my pic.jpg)")).toEqual(
      [],
    );
  });

  test("an angle-bracket destination unwraps to the path (spaces allowed)", () => {
    // Mirrors the renderer's space-in-path component test: `<folder/my pic.jpg>`
    // resolves to `.../folder/my%20pic.jpg`, so the unwrapped path is the real
    // dependency.
    const refs = getMarkdownImageReferences("![a](<folder/my pic.jpg>)");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("folder/my pic.jpg");
  });

  test("matches bracketed alt text (balanced `]` inside the label)", () => {
    const refs = getMarkdownImageReferences("![Figure [A]](images/a.png)");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ alt: "Figure [A]", path: "images/a.png" });
  });

  test("trims surrounding whitespace inside the parens", () => {
    const refs = getMarkdownImageReferences("![a](  images/x.png  )");
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe("images/x.png");
  });

  test("a padded URL/scheme is still excluded", () => {
    const md = [
      "![a](  https://cdn.example.com/x.png  )",
      "![b](  asset://kit/y.png  )",
      "![c](   )",
    ].join("\n");
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("strips a title — the destination is the path, not the whole capture", () => {
    // A titled image now resolves against the asset base (the renderer parses
    // the title out), so we report the clean path — not the old verbatim
    // `images/x.png "My title"` that used to 404.
    const refs = getMarkdownImageReferences('![a](images/x.png "My title")');
    expect(refs.map((r) => r.path)).toEqual(["images/x.png"]);
  });

  test("unwraps an angle-bracket destination", () => {
    const refs = getMarkdownImageReferences("![a](<my pic.png>)");
    expect(refs.map((r) => r.path)).toEqual(["my pic.png"]);
  });

  test("keeps balanced parens inside a bare destination", () => {
    const refs = getMarkdownImageReferences("![a](image(1).png)");
    expect(refs.map((r) => r.path)).toEqual(["image(1).png"]);
  });

  test("alt text may wrap across lines (still one image)", () => {
    const refs = getMarkdownImageReferences(
      "![alt spanning\ntwo lines](x.png)",
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      alt: "alt spanning\ntwo lines",
      path: "x.png",
    });
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

  test("recognizes a fence indented up to 3 spaces", () => {
    const md = [
      "   ```markdown",
      "   ![indented](images/nope.png)",
      "   ```",
      "![after](images/yes.png)",
    ].join("\n");
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "images/yes.png",
    ]);
  });

  test("4+ spaces is an indented code block, not a fence", () => {
    // A 4-space indent is an indented code block, so the `` ``` `` lines are
    // literal code and never open a fence; the unindented image line in between
    // is an ordinary paragraph and is collected (correct CommonMark).
    const md = ["    ```", "![a](x.png)", "    ```"].join("\n");
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "x.png",
    ]);
  });
});

describe("getMarkdownImageReferences — alt text and edge cases", () => {
  test("captures alt text with punctuation; a `\\]` escape renders as `]`", () => {
    // CommonMark resolves the escape, so the reported alt is the rendered text
    // (`]`), matching what a screen reader would announce.
    const refs = getMarkdownImageReferences(
      '![Figure 1: "cats" \\] end](x.png)',
    );
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      alt: 'Figure 1: "cats" ] end',
      path: "x.png",
    });
  });

  test("a whitespace-only destination is not a match", () => {
    expect(getMarkdownImageReferences("![a](   )")).toEqual([]);
  });

  test("a very long alt (accessibility description) does not drop the image", () => {
    // A paragraph-length alt (well under the body length cap) still resolves its
    // destination — the file is a real dependency regardless of alt length.
    const longAlt = "A ".repeat(2000).trim();
    const refs = getMarkdownImageReferences(`![${longAlt}](images/chart.png)`);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ alt: longAlt, path: "images/chart.png" });
  });

  test("skips an escaped bang (\\![…] renders as literal text)", () => {
    expect(getMarkdownImageReferences("\\![a](missing.png)")).toEqual([]);
  });

  test("an even backslash run before the bang does NOT escape it", () => {
    // `\\` is an escaped backslash, so the `!` is live and the image counts.
    const refs = getMarkdownImageReferences("\\\\![a](real.png)");
    expect(refs.map((r) => r.path)).toEqual(["real.png"]);
  });

  test("column of a second image accounts for a title on the first", () => {
    const md = '![a](x.png "t") ![b](y.png)';
    const refs = getMarkdownImageReferences(md);
    // The first image's title is parsed out, so its path is the clean `x.png`.
    expect(refs.map((r) => r.path)).toEqual(["x.png", "y.png"]);
    // `![a](x.png "t") ` is 16 chars, so the second image starts at column 16.
    expect(refs.map((r) => r.column)).toEqual([0, 16]);
  });
});

describe("getMarkdownImageReferences — reference-style images", () => {
  // The renderer (react-markdown) resolves reference-style images against their
  // `[id]: url` definition, so the enumerator must too (#576 lockstep).

  test("full reference `![alt][id]` resolves to its definition", () => {
    const md = "![Figure 1][fig1]\n\n[fig1]: diagrams/figure1.png";
    expect(getMarkdownImageReferences(md)).toEqual<MarkdownImageReference[]>([
      { path: "diagrams/figure1.png", alt: "Figure 1", line: 0, column: 0 },
    ]);
  });

  test("collapsed `![id][]` and shortcut `![id]` resolve too", () => {
    expect(
      getMarkdownImageReferences("![fig][]\n\n[fig]: a.png").map((r) => r.path),
    ).toEqual(["a.png"]);
    expect(
      getMarkdownImageReferences("![fig]\n\n[fig]: b.png").map((r) => r.path),
    ).toEqual(["b.png"]);
  });

  test("reference matches its definition case-insensitively", () => {
    // mdast normalizes identifiers, so `[Fig1]` resolves against `[fig1]:`.
    const refs = getMarkdownImageReferences("![x][Fig1]\n\n[fig1]: c.png");
    expect(refs.map((r) => r.path)).toEqual(["c.png"]);
  });

  test("first definition wins when an identifier is defined twice", () => {
    const md = "![x][r]\n\n[r]: first.png\n\n[r]: second.png";
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "first.png",
    ]);
  });

  test("an unresolved reference (no definition) is not matched", () => {
    expect(getMarkdownImageReferences("![alt][missing]")).toEqual([]);
  });

  test("a reference whose definition is a URL/scheme is excluded", () => {
    const md = "![a][r]\n\n[r]: https://cdn.example.com/x.png";
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });
});

describe("getMarkdownImageReferences — documented non-goals", () => {
  test("raw <img> HTML is not matched (renderer loads no rehype-raw)", () => {
    expect(getMarkdownImageReferences('<img src="pic.png" alt="x">')).toEqual(
      [],
    );
  });

  test("an image inside an inline code span is not matched", () => {
    // The image syntax is inside a `` `code span` ``, so it's literal text —
    // the renderer shows it, doesn't request it. (A behavior the old scan
    // couldn't see; the CommonMark parse excludes it for free.)
    expect(getMarkdownImageReferences("Use `![a](x.png)` inline")).toEqual([]);
  });

  test("an image on a 4-space-indented (code block) line is not matched", () => {
    // A 4-space indent is an indented code block, so `![a](x.png)` is literal
    // code, not an image request.
    expect(getMarkdownImageReferences("    ![a](x.png)")).toEqual([]);
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

  test("excludes a javascript: destination", () => {
    expect(getMarkdownImageReferences("![a](javascript:alert(1))")).toEqual([]);
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

describe("getMarkdownImageReferences — perf guards", () => {
  // micromark has super-linear worst cases on adversarial input. Two guards
  // bound them server-side (see the constants): a 50 KB length cap for the
  // milder/unknown vectors, and an emphasis-marker count cap for the sharpest
  // one (the attention resolver on a `*_*_…` run). An over-cap body is not
  // enumerated — an accepted false negative (enumeration is advisory; a missed
  // image surfaces as a runtime 404, and the renderer would choke on the same
  // oversized body regardless). A realistic prompt trips neither.

  test("a body over the length cap yields [] even if it holds a valid image", () => {
    const image = "\n![a](real.png)";
    const md = "x".repeat(50_001 - image.length) + image;
    expect(md.length).toBeGreaterThan(50_000);
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("a valid image in a body at the length cap is still collected", () => {
    const image = "\n\n![a](real.png)";
    const md = "x".repeat(50_000 - image.length) + image;
    expect(md.length).toBe(50_000);
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "real.png",
    ]);
  });

  test("a body over the emphasis-marker cap yields [] (even under the length cap)", () => {
    // 18 000 `*_` markers in 18 001 chars — under the 50 KB length cap, over the
    // 15 000 emphasis-marker cap, so the emphasis guard (not the length one)
    // short-circuits before the expensive attention resolve.
    const md = "*_".repeat(9_000) + "![a](real.png)";
    expect(md.length).toBeLessThan(50_000);
    expect(getMarkdownImageReferences(md)).toEqual([]);
  });

  test("a long, heavily-formatted but legitimate body is still enumerated", () => {
    // ~40 KB of prose with ~7 000 *resolving* bold/italic markers — well under
    // both caps, so its image is collected (the whole point of the two-guard
    // split: length alone would have to be tiny to bound the emphasis vector).
    const para =
      "This is **important** guidance about the _study_ procedures. ";
    const md = para.repeat(650) + "\n\n![diagram](figures/flow.png)";
    expect(md.length).toBeGreaterThan(35_000);
    expect(md.length).toBeLessThan(50_000);
    expect((md.match(/[*_]/g) || []).length).toBeLessThan(15_000);
    expect(getMarkdownImageReferences(md).map((r) => r.path)).toEqual([
      "figures/flow.png",
    ]);
  });
});

describe("getMarkdownImageReferences — resistance to adversarial input", () => {
  // A real CommonMark parse handles the `![…`/`![](x…` multi-start patterns (that
  // make a backtracking regex O(n²)) in near-linear time, and the two perf guards
  // bound micromark's OWN super-linear cases — most sharply the emphasis resolver
  // on a `*_*_…` run (unbounded, this hangs ~14s at 50 KB, ~90s at 100 KB). Each
  // body below trips a guard (length or emphasis-marker count), so it
  // short-circuits before parsing. The `*_`×20 000 case is the key one: 40 KB is
  // UNDER the length cap, so only the emphasis-marker guard catches it.
  test.each([
    ["long whitespace run, no close", "![](x" + " ".repeat(100_000)],
    ["repeated `![` with no `]`", "![".repeat(80_000)],
    ["repeated `![](x` with no `)`", "![](x".repeat(50_000)],
    ["emphasis `*_` run over the length cap", "*_".repeat(50_000)],
    [
      "emphasis `*_` run under length cap, over marker cap",
      "*_".repeat(20_000),
    ],
    ["`)` then many `![` starts", "](x)" + "![".repeat(80_000)],
  ])("over-cap adversarial body resolves instantly: %s", (_label, line) => {
    const start = performance.now();
    const refs = getMarkdownImageReferences(line);
    const elapsedMs = performance.now() - start;
    expect(refs).toEqual([]);
    expect(elapsedMs).toBeLessThan(1000);
  });

  test("a large under-cap emphasis run stays bounded (the cap's whole point)", () => {
    // `*_*_…` is remark's sharpest super-linear input. Sized well under the cap
    // so the guard does NOT fire and the real parse runs; it must stay bounded.
    const line = "*_".repeat(4_000); // 8_000 chars < the length cap
    const start = performance.now();
    const refs = getMarkdownImageReferences(line);
    const elapsedMs = performance.now() - start;
    expect(refs).toEqual([]);
    expect(elapsedMs).toBeLessThan(3000);
  });
});
