import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";
import { WORKLET_SOURCE } from "./src/audioProbe/worklet.js";
import { CHANNEL_COUNT_WORKLET } from "./src/components/elements/mediaPlayer/channelCountMonitor.js";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

// The AudioWorklet modules as files, for hosts whose Content-Security-Policy
// refuses the blob: URL they otherwise load from (#837). Written from the
// same source text the blob is built from, so the two cannot differ. Exported
// as `stagebook/worklets/<name>`.
const WORKLET_FILES = {
  "channel-count.js": CHANNEL_COUNT_WORKLET,
  "channel-order-probe.js": WORKLET_SOURCE,
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "components/index": "src/components/index.ts",
    "viewer/index": "src/viewer/index.ts",
    "validate/index": "src/validate/index.ts",
    "dispatch/index": "src/dispatch/index.ts",
    "dispatch/contract": "src/dispatch/contract.ts",
    "cli/validate": "src/cli/validate.ts",
    "audio-probe/index": "src/audioProbe/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  splitting: true,
  clean: true,
  sourcemap: true,
  // `mdast-util-from-markdown` (used by `getMarkdownImageReferences`) is
  // ESM-only. Externalized, the generated `dist/index.cjs` `require()`s it and
  // throws for CJS consumers (no `require` export / broken named-export
  // interop). Bundling it — and its transitive micromark/mdast tree, which
  // isn't a direct dependency so is inlined anyway — keeps the CJS build
  // self-contained. Unlike `unified`/`remark-parse`, it pulls in NO Node
  // built-ins (no `vfile`), so bundling it is safe for the browser-facing
  // viewer/webview builds too. See #576 / #577.
  noExternal: ["mdast-util-from-markdown"],
  // Read by src/version.ts, so the channel-order probe can record which
  // release measured it (#663).
  define: { __STAGEBOOK_VERSION__: JSON.stringify(version) },
  // Runs once per build, after `clean` has emptied dist.
  onSuccess: () => {
    const dir = new URL("./dist/worklets/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    for (const [name, source] of Object.entries(WORKLET_FILES)) {
      writeFileSync(
        new URL(name, dir),
        `// stagebook ${version} AudioWorklet module.\n${source}`,
      );
    }
    return Promise.resolve();
  },
});
