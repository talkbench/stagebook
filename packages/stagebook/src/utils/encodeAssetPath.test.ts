import { describe, expect, test } from "vitest";
import { encodeAssetPath } from "./encodeAssetPath.js";

describe("encodeAssetPath", () => {
  test("plain ASCII filename unchanged", () => {
    expect(encodeAssetPath("photo.jpg")).toBe("photo.jpg");
  });

  test("preserves `/` separators", () => {
    expect(encodeAssetPath("a/b/c/image.png")).toBe("a/b/c/image.png");
  });

  test("encodes spaces", () => {
    expect(encodeAssetPath("my pic.jpg")).toBe("my%20pic.jpg");
    expect(encodeAssetPath("folder/my pic.jpg")).toBe("folder/my%20pic.jpg");
  });

  test("encodes `?` (would otherwise split into a query string)", () => {
    expect(encodeAssetPath("confused?.png")).toBe("confused%3F.png");
  });

  test("encodes `#` (would otherwise split into a fragment)", () => {
    expect(encodeAssetPath("sketch#1.png")).toBe("sketch%231.png");
  });

  test("encodes `+` (would otherwise be interpreted as space in queries)", () => {
    expect(encodeAssetPath("version+1.png")).toBe("version%2B1.png");
  });

  test("encodes `&`", () => {
    expect(encodeAssetPath("rock&roll.mp3")).toBe("rock%26roll.mp3");
  });

  test("encodes non-ASCII (UTF-8)", () => {
    expect(encodeAssetPath("café.png")).toBe("caf%C3%A9.png");
    expect(encodeAssetPath("日本.png")).toBe("%E6%97%A5%E6%9C%AC.png");
  });

  test("idempotent? — re-encoding already-encoded input DOES double-encode", () => {
    // Documented limitation: per-segment encodeURIComponent is not
    // idempotent because `%` itself gets encoded. Researchers
    // shouldn't pre-encode their YAML paths; the encoder owns
    // that responsibility.
    expect(encodeAssetPath("my%20pic.jpg")).toBe("my%2520pic.jpg");
  });

  test("passes through http:// URLs unchanged", () => {
    expect(encodeAssetPath("http://example.com/my pic.jpg")).toBe(
      "http://example.com/my pic.jpg",
    );
  });

  test("passes through https:// URLs unchanged", () => {
    expect(encodeAssetPath("https://example.com/photo.png")).toBe(
      "https://example.com/photo.png",
    );
  });

  test("passes through asset:// URLs unchanged (preserves stagebook scheme)", () => {
    expect(encodeAssetPath("asset://diagrams/flow.png")).toBe(
      "asset://diagrams/flow.png",
    );
  });

  test("passes through data: URLs unchanged", () => {
    expect(encodeAssetPath("data:image/png;base64,iVBORw0KGgo=")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
  });

  test("scheme detection is case-insensitive", () => {
    expect(encodeAssetPath("HTTPS://example.com/foo.png")).toBe(
      "HTTPS://example.com/foo.png",
    );
    expect(encodeAssetPath("Asset://x.png")).toBe("Asset://x.png");
  });

  test("does NOT misdetect a leading-colon-less path with a colon mid-segment", () => {
    // `:` mid-filename should encode; the scheme regex needs an
    // alphabetic first char before the colon.
    expect(encodeAssetPath("file:notascheme/x.png")).toBe(
      // matches scheme regex because `file` is a valid scheme name
      "file:notascheme/x.png",
    );
    expect(encodeAssetPath("9file:bad.png")).toBe("9file%3Abad.png");
  });

  test("empty string returns empty string", () => {
    expect(encodeAssetPath("")).toBe("");
  });
});
