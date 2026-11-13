import { afterEach, describe, expect, test, vi } from "vitest";
import type { ChannelProbeResult } from "./probe.js";

const probeChannelOrder = vi.fn<() => Promise<ChannelProbeResult>>();
vi.mock("./probeChannelOrder.js", () => ({
  probeChannelOrder: (...args: unknown[]) => probeChannelOrder(...(args as [])),
}));

const { createChannelProbe } = await import("./createChannelProbe.js");

const result = (verdict: "pass" | "fail"): ChannelProbeResult => ({
  verdict,
  mappings: { 2: verdict === "pass" ? [0, 1] : null },
  detail: {},
  stagebookVersion: "test",
  elapsedMs: 1,
});

/** A probe the test settles by hand. */
function deferred() {
  let settle!: (r: ChannelProbeResult) => void;
  const promise = new Promise<ChannelProbeResult>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

afterEach(() => {
  probeChannelOrder.mockReset();
});

describe("createChannelProbe", () => {
  test("starts the probe synchronously, inside the caller's gesture", () => {
    probeChannelOrder.mockReturnValue(deferred().promise);
    const run = createChannelProbe();
    expect(probeChannelOrder).not.toHaveBeenCalled();
    void run();
    expect(probeChannelOrder).toHaveBeenCalledTimes(1);
  });

  test("passes the host's options through", () => {
    const options = { workletUrl: "/worklets/channel-order-probe.js" };
    probeChannelOrder.mockReturnValue(deferred().promise);
    void createChannelProbe(options)();
    expect(probeChannelOrder).toHaveBeenCalledWith(options);
  });

  test("reuses a probe that is still running", async () => {
    const first = deferred();
    probeChannelOrder.mockReturnValue(first.promise);
    const run = createChannelProbe();
    const a = run();
    const b = run();
    expect(probeChannelOrder).toHaveBeenCalledTimes(1);
    first.settle(result("pass"));
    expect(await a).toBe(await b);
  });

  test("keeps a passing result: a browser's decoder can't change mid-session", async () => {
    probeChannelOrder.mockResolvedValue(result("pass"));
    const run = createChannelProbe();
    const first = await run();
    expect(await run()).toBe(first);
    expect(probeChannelOrder).toHaveBeenCalledTimes(1);
  });

  test("runs a fresh probe after a failure", async () => {
    probeChannelOrder
      .mockResolvedValueOnce(result("fail"))
      .mockResolvedValueOnce(result("pass"));
    const run = createChannelProbe();
    expect((await run()).verdict).toBe("fail");
    expect((await run()).verdict).toBe("pass");
    expect(probeChannelOrder).toHaveBeenCalledTimes(2);
  });

  test("each runner keeps its own probe", async () => {
    probeChannelOrder.mockResolvedValue(result("pass"));
    await createChannelProbe()();
    await createChannelProbe()();
    expect(probeChannelOrder).toHaveBeenCalledTimes(2);
  });
});
