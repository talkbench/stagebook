// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useResponseCommit } from "./useResponseCommit.js";

let root: Root;
let dom: HTMLDivElement;
let commit: ReturnType<typeof useResponseCommit<string | undefined>>;
const save = vi.fn<(value: string | undefined) => void>();
function Harness({ onCommit = save, debounceDelay = 2000, maxWait = 5000 }) {
  commit = useResponseCommit<string | undefined>({
    onCommit,
    debounceDelay,
    maxWait,
  });
  return null;
}
function render(props: Parameters<typeof Harness>[0] = {}) {
  act(() => root.render(<Harness {...props} />));
}
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  save.mockClear();
  dom = document.createElement("div");
  document.body.appendChild(dom);
  root = createRoot(dom);
});
afterEach(() => {
  act(() => root.unmount());
  dom.remove();
  vi.useRealTimers();
});

test("a local burst commits after two quiet seconds, clears pending state and stops all timers", () => {
  render();
  expect(commit.hasPending()).toBe(false);
  commit.queue("a");
  expect(commit.hasPending()).toBe(true);
  expect(commit.peek()).toBe("a");
  advance(1500);
  commit.queue("ab");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save.mock.calls).toEqual([["ab"]]);
  expect(commit.hasPending()).toBe(false);
  expect(commit.peek()).toBeUndefined();
  advance(20000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("continuous local edits do not reset the five-second maximum", () => {
  render();
  for (let second = 0; second < 5; second++) {
    commit.queue(String(second));
    advance(999);
    expect(save).not.toHaveBeenCalled();
    advance(1);
  }
  expect(save.mock.calls).toEqual([["4"]]);
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("a remote update replaces pending text without changing either deadline", () => {
  render();
  commit.queue("local");
  advance(1500);
  commit.replacePending("local + remote");
  expect(commit.peek()).toBe("local + remote");
  advance(499);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save.mock.calls).toEqual([["local + remote"]]);
});

test("remote-only updates and idle blur never create a pending batch", () => {
  render();
  commit.replacePending("remote only");
  expect(commit.hasPending()).toBe(false);
  expect(commit.peek()).toBeUndefined();
  commit.flush();
  advance(20000);
  expect(save).not.toHaveBeenCalled();
});

test("blur flushes the latest merged response and cancels both timers", () => {
  render();
  commit.queue("local");
  advance(500);
  commit.replacePending("merged at blur");
  commit.flush();
  expect(save.mock.calls).toEqual([["merged at blur"]]);
  expect(commit.hasPending()).toBe(false);
  commit.flush();
  advance(10000);
  expect(save).toHaveBeenCalledTimes(1);
});

test("a fresh local batch starts new deadlines after flush or cancellation", () => {
  render();
  commit.queue("discard");
  advance(1000);
  commit.cancel();
  expect(commit.hasPending()).toBe(false);
  advance(10000);
  expect(save).not.toHaveBeenCalled();
  commit.queue("next");
  advance(1999);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save.mock.calls).toEqual([["next"]]);
});

test("pending timers use the latest callback after rerender", () => {
  render();
  const originalQueue = commit.queue;
  commit.queue("answer");
  advance(1000);
  const nextSave = vi.fn();
  render({ onCommit: nextSave });
  expect(commit.queue).toBe(originalQueue);
  advance(1000);
  expect(save).not.toHaveBeenCalled();
  expect(nextSave.mock.calls).toEqual([["answer"]]);
});

test("forced commit saves unchanged or empty text, canceling queued work", () => {
  render();
  commit.commit("");
  expect(save).toHaveBeenNthCalledWith(1, "");
  commit.queue("pending");
  advance(250);
  commit.commit("fresh blur snapshot");
  expect(save).toHaveBeenNthCalledWith(2, "fresh blur snapshot");
  advance(10000);
  expect(save).toHaveBeenCalledTimes(2);
});

test("undefined is a legitimate generic response, separate from no pending value", () => {
  render();
  commit.queue(undefined);
  expect(commit.hasPending()).toBe(true);
  advance(2000);
  expect(save.mock.calls).toEqual([[undefined]]);
});

test("unmount cancels pending work and stale callbacks cannot resurrect it", () => {
  render();
  const stale = commit;
  stale.queue("unfinished");
  act(() => root.render(null));
  stale.queue("late local callback");
  stale.replacePending("late remote callback");
  stale.commit("late blur");
  stale.flush();
  advance(20000);
  expect(stale.hasPending()).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

test("standalone consumers can configure both deadlines", () => {
  render({ debounceDelay: 100, maxWait: 250 });
  commit.queue("first");
  advance(99);
  expect(save).not.toHaveBeenCalled();
  advance(1);
  expect(save.mock.calls).toEqual([["first"]]);
});
