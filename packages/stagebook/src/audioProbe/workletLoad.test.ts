import { expect, test } from "vitest";
import { describeError, workletLoadHint } from "./workletLoad.js";

test("a module loaded from a blob: URL: the hint names the file, the option and the policy", () => {
  const hint = workletLoadHint(
    "stagebook/worklets/channel-count.js",
    "channelCountWorkletUrl",
    undefined,
  );
  expect(hint).toContain("blob: URL");
  expect(hint).toContain("Content-Security-Policy");
  expect(hint).toContain("stagebook/worklets/channel-count.js");
  expect(hint).toContain("channelCountWorkletUrl");
});

test("a module loaded from the host's URL: the hint names that URL, not blob:", () => {
  const hint = workletLoadHint(
    "stagebook/worklets/channel-count.js",
    "channelCountWorkletUrl",
    "/static/channel-count.js",
  );
  expect(hint).toContain("It was loaded from /static/channel-count.js.");
  expect(hint).toContain("Content-Security-Policy");
  expect(hint).not.toContain("blob:");
});

test("describeError keeps an error's name, which is all a blocked load reports", () => {
  expect(describeError(new DOMException("blocked", "AbortError"))).toBe(
    "AbortError: blocked",
  );
  expect(describeError("plain")).toBe("plain");
});
