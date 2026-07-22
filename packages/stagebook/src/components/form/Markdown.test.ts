import { describe, expect, test } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeSafeRel, resolveImageSrc, Markdown } from "./Markdown.js";

// External-link `rel` contract: markdown links that open in a new
// tab (target="_blank") must receive `rel="noopener noreferrer"`
// so the new tab can't reach back to `window.opener` (tab-nabbing)
// and the destination doesn't receive a Referer header. The handler
// is invoked from inside react-markdown's `components.a`, where the
// only way to introduce `target="_blank"` without raw HTML is via
// rehype-raw — too much plumbing for one contract assertion. The
// helper is exported so the contract is unit-testable on its own.

describe("computeSafeRel", () => {
  test("no target → rel passes through unchanged (no rewrite)", () => {
    expect(computeSafeRel(undefined, undefined)).toBeUndefined();
    expect(computeSafeRel(undefined, "author")).toBe("author");
  });

  test("target=_self → rel passes through unchanged", () => {
    expect(computeSafeRel("_self", "author")).toBe("author");
  });

  test("target=_blank + no source rel → adds 'noopener noreferrer'", () => {
    expect(computeSafeRel("_blank", undefined)).toBe("noopener noreferrer");
  });

  test("target=_blank + existing rel → appends noopener noreferrer to the source", () => {
    // Researcher-provided `rel="author"` is preserved.
    expect(computeSafeRel("_blank", "author")).toBe(
      "author noopener noreferrer",
    );
  });

  test("target=_blank with already-present noopener → still safe (no harm in duplicate tokens)", () => {
    // Browsers tokenize `rel`, so duplicate `noopener` is a no-op.
    // The helper doesn't dedupe — duplicates aren't a bug, just
    // verbose. This test locks in the simple-concat behavior.
    const out = computeSafeRel("_blank", "noopener");
    expect(out).toContain("noopener");
    expect(out).toContain("noreferrer");
  });
});

// Image src resolution (#576, #431). `resolveImageSrc` runs on the `src`
// react-markdown hands the `img` component: titles / `<…>` / balanced parens
// already handled by remark, dangerous protocols already sanitized to `""`, and
// — crucial here — the destination already `encodeURI`-encoded (spaces and
// non-ASCII → `%XX`). So these tests pass react-markdown-STYLE inputs (with the
// space/non-ASCII already encoded); the function only finishes the URI-
// structural chars and resolves. End-to-end DOM behavior lives in Markdown.ct.tsx.
describe("resolveImageSrc", () => {
  const base = (p: string) => `https://cdn.example.com/dir/${p}`;

  test("no resolver → src passes through unchanged", () => {
    expect(resolveImageSrc("images/x.png", undefined)).toBe("images/x.png");
  });

  test("empty or undefined src → returned as-is (no resolver call)", () => {
    let called = false;
    const spy = (p: string) => {
      called = true;
      return base(p);
    };
    expect(resolveImageSrc("", spy)).toBe("");
    expect(resolveImageSrc(undefined, spy)).toBeUndefined();
    expect(called).toBe(false);
  });

  test("finishes encoding the URI-structural chars remark leaves raw (#431)", () => {
    // `#`, `?`, `+`, `&`, `=` … would corrupt the path as a URL.
    expect(resolveImageSrc("a/b/round#3.png", base)).toBe(
      "https://cdn.example.com/dir/a/b/round%233.png",
    );
    expect(resolveImageSrc("confused?.png", base)).toBe(
      "https://cdn.example.com/dir/confused%3F.png",
    );
    expect(resolveImageSrc("version+1.png", base)).toBe(
      "https://cdn.example.com/dir/version%2B1.png",
    );
    expect(resolveImageSrc("a&b=c.png", base)).toBe(
      "https://cdn.example.com/dir/a%26b%3Dc.png",
    );
  });

  test("encodes the full URL_TO_PATH_UNSAFE set: $ , ; @ : too", () => {
    // Guards the whole character class against an accidental narrowing. `:`
    // must not be in a leading scheme position (that would read as absolute),
    // so it sits mid-path here.
    expect(resolveImageSrc("dir/a$b,c;d@e:f.png", base)).toBe(
      "https://cdn.example.com/dir/dir/a%24b%2Cc%3Bd%40e%3Af.png",
    );
  });

  test("preserves `/` separators and does not touch balanced parens", () => {
    expect(resolveImageSrc("a/b/c/image.png", base)).toBe(
      "https://cdn.example.com/dir/a/b/c/image.png",
    );
    expect(resolveImageSrc("image(1).png", base)).toBe(
      "https://cdn.example.com/dir/image(1).png",
    );
  });

  test("does not re-encode remark's %XX (space / non-ASCII already encoded)", () => {
    // react-markdown gives `my pic.png` as `my%20pic.png` and `café.png` as
    // `caf%C3%A9.png`; re-encoding the `%` would 404 (the #431 double-encode).
    expect(resolveImageSrc("my%20pic.png", base)).toBe(
      "https://cdn.example.com/dir/my%20pic.png",
    );
    expect(resolveImageSrc("caf%C3%A9.png", base)).toBe(
      "https://cdn.example.com/dir/caf%C3%A9.png",
    );
  });

  test("encodes a literal `%` that isn't a valid %XX escape", () => {
    // react-markdown leaves an invalid escape (`50%off.png`) raw; without this
    // the server would choke on `%of`. A valid `%XX` is still preserved.
    expect(resolveImageSrc("50%off.png", base)).toBe(
      "https://cdn.example.com/dir/50%25off.png",
    );
    expect(resolveImageSrc("100%25done.png", base)).toBe(
      "https://cdn.example.com/dir/100%25done.png",
    );
  });

  test("does not double-encode a host's already-encoded base (#431)", () => {
    const resolved = resolveImageSrc(
      "images/test.png",
      (p) => `https://file%2B.example.cdn.net/${p}`,
    );
    expect(resolved).toContain("%2B");
    expect(resolved).not.toContain("%252B");
  });

  test("absolute http(s) src → passed through, not resolved against the base", () => {
    const spy = (p: string) => `SHOULD_NOT_RESOLVE/${p}`;
    expect(resolveImageSrc("http://other.example/a.png", spy)).toBe(
      "http://other.example/a.png",
    );
    expect(resolveImageSrc("https://other.example/a.png", spy)).toBe(
      "https://other.example/a.png",
    );
  });

  test("data: src → passed through unchanged (already absolute)", () => {
    const spy = (p: string) => `SHOULD_NOT_RESOLVE/${p}`;
    expect(resolveImageSrc("data:image/png;base64,AAAA", spy)).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  test("asset:// src → routed through resolveURL (mounts resolve, unmounted passes through)", () => {
    // A mounted prefix resolves to a loadable webview URL...
    const mounted = (p: string) =>
      p === "asset://kit/logo.png" ? "https://webview.example/kit/logo.png" : p;
    expect(resolveImageSrc("asset://kit/logo.png", mounted)).toBe(
      "https://webview.example/kit/logo.png",
    );
    // ...an unmounted prefix comes back unchanged (renders nothing, #191).
    const unmounted = (p: string) => p;
    expect(resolveImageSrc("asset://kit/logo.png", unmounted)).toBe(
      "asset://kit/logo.png",
    );
  });

  test("protocol-relative //host src → passed through unchanged", () => {
    const spy = (p: string) => `SHOULD_NOT_RESOLVE/${p}`;
    expect(resolveImageSrc("//cdn.example.com/a.png", spy)).toBe(
      "//cdn.example.com/a.png",
    );
  });

  test("resolver returning a non-http/data URL → falls back to the raw path", () => {
    // Defense in depth: react-markdown already strips `javascript:` to "", but
    // if a host resolver ever produced a non-fetchable URL we emit the raw path
    // rather than a surprising src.
    expect(resolveImageSrc("x.png", () => "javascript:alert(1)")).toBe("x.png");
    expect(resolveImageSrc("x.png", () => "ftp://h/x.png")).toBe("x.png");
  });

  test("resolver returning a data: URL is accepted", () => {
    expect(resolveImageSrc("x.png", () => "data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});

// Renderer ReDoS regression (#576). The deleted pre-render regex was O(n²) on a
// `![![![…` run (the issue measured ~2.3s at 60k, in the participant's browser).
// Resolving on the AST removes it; react-markdown parses the run in near-linear
// time. A node-side SSR render gives a reliable clock (unlike a browser CT),
// so we can assert a hard bound comfortably below the old cost. Keep the input
// as `![`×N — the exact pattern the old regex choked on; do NOT switch it to
// `![](x…`, which would instead exercise a pre-existing (out-of-scope) remark
// super-linear case and could hang the test.
describe("Markdown renderer perf", () => {
  test("a `![`×60000 run renders as text without the old regex blowup", () => {
    const start = performance.now();
    const html = renderToStaticMarkup(
      React.createElement(Markdown, { text: "![".repeat(60_000) }),
    );
    const elapsedMs = performance.now() - start;
    expect(html).not.toContain("<img");
    expect(elapsedMs).toBeLessThan(2000);
  });
});
