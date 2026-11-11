import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildWebviewCsp, cspSourceForFile } from "./webviewCsp";

const cspSource = "https://*.vscode-cdn.net";
const workletUri =
  "https://file%2B.vscode-resource.vscode-cdn.net/ext/dist/channel-count-worklet.js";
const csp = buildWebviewCsp({ nonce: "abc123", cspSource, workletUri });
const directive = (name: string) =>
  csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find(([first]) => first === name)
    ?.slice(1);

describe("preview webview Content-Security-Policy (#837)", () => {
  it("allows the channel-count worklet file, which the nonce cannot cover", () => {
    // An AudioWorklet module is fetched by URL, so it carries no nonce.
    // The host's `file+` label (written %2B) is not legal in a policy, and a
    // browser ignores a source it cannot parse; it has to become `*`.
    expect(directive("script-src")).toEqual([
      "'nonce-abc123'",
      "https://*.vscode-resource.vscode-cdn.net/ext/dist/channel-count-worklet.js",
    ]);
  });

  it("names every webview host form with characters a policy accepts", () => {
    for (const [uri, source] of [
      [
        "https://file+.vscode-resource.vscode-cdn.net/a%20b/w.js",
        "https://*.vscode-resource.vscode-cdn.net/a%20b/w.js",
      ],
      [
        "https://vscode-remote%2Bssh-002dremote-002bbox.vscode-resource.vscode-cdn.net/home/u/w.js",
        "https://*.vscode-resource.vscode-cdn.net/home/u/w.js",
      ],
      ["http://localhost:3000/dist/w.js", "http://localhost:3000/dist/w.js"],
    ]) {
      expect(cspSourceForFile(uri)).toBe(source);
      // host-source grammar: scheme, optional "*.", then letters, digits,
      // "-" and "." only.
      expect(cspSourceForFile(uri)).toMatch(
        /^[a-z]+:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?\//i,
      );
    }
    expect(() => cspSourceForFile("https://a+b/w.js")).toThrow(/worklet/);
    expect(() => cspSourceForFile("not a url")).toThrow(/worklet/);
  });

  it("admits no other script: not blob:, not the workspace's files", () => {
    // `cspSource` covers every local resource root, which includes the study
    // workspace and mounted asset folders. Only the one file is allowed.
    const scripts = directive("script-src") ?? [];
    expect(scripts).not.toContain("blob:");
    expect(scripts).not.toContain(cspSource);
    expect(directive("default-src")).toEqual(["'none'"]);
  });

  it("refuses a worklet URI that could add to the policy", () => {
    for (const bad of [
      "https://host/a.js; script-src *",
      "https://host/a.js 'unsafe-inline'",
      "https://host/a,b.js",
      'https://host/a".js',
      // Both uses are HTML attributes, where this decodes to ";".
      "https://host/a.js&#59; script-src *",
    ]) {
      expect(() =>
        buildWebviewCsp({ nonce: "abc123", cspSource, workletUri: bad }),
      ).toThrow(/worklet/);
    }
  });
});

describe("the worklet file reaches the packaged extension (#837)", () => {
  const read = (path: string) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

  it("the extension builds its policy here and hands the file's URI to the webview", () => {
    const extension = read("../extension.ts");
    expect(extension).toContain("buildWebviewCsp(");
    // No second, hand-written policy that could omit the worklet.
    expect(extension).not.toMatch(/script-src/);
    expect(extension).toContain('"channel-count-worklet.js"');
    expect(extension).toContain('data-channel-count-worklet="${workletUri}"');
    const webview = read("../webview/index.tsx");
    expect(webview).toContain("dataset.channelCountWorklet");
    expect(webview).toContain(
      "channelCountWorkletUrl={channelCountWorkletUrl}",
    );
  });

  it("is copied into dist by both builds and kept by .vscodeignore", () => {
    const { scripts } = JSON.parse(read("../../package.json")) as {
      scripts: Record<string, string>;
    };
    expect(scripts["build:worklet"]).toContain(
      "stagebook/worklets/channel-count.js",
    );
    expect(scripts["build:worklet"]).toContain("dist/channel-count-worklet.js");
    expect(scripts.build).toContain("build:worklet");
    expect(scripts["build:production"]).toContain("build:worklet");
    expect(read("../../.vscodeignore").split("\n")).toContain(
      "!dist/channel-count-worklet.js",
    );
  });
});
