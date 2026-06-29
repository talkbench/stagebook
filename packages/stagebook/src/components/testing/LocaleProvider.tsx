/**
 * CT harness: wraps children in a StagebookProvider with a given locale.
 *
 * Playwright CT serializes mount props across the test boundary, so a
 * function-bearing provider `value` can't be built in the test file — same
 * rationale as BoundaryTestHarness / MockTimeline. This is the i18n/RTL
 * variant: stub context functions + a `locale` knob.
 */
import React from "react";
import {
  StagebookProvider,
  type StagebookContext,
} from "../StagebookProvider.js";

function buildCtx(locale: string): StagebookContext {
  return {
    get: () => [],
    save: () => {},
    getElapsedTime: () => 0,
    submit: () => {},
    getAssetURL: (p: string) => p,
    getTextContent: () => Promise.resolve(""),
    progressLabel: "test",
    playerId: "p1",
    position: 0,
    playerCount: 1,
    isSubmitted: false,
    locale,
  };
}

export function LocaleProvider({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  return (
    <StagebookProvider value={buildCtx(locale)}>{children}</StagebookProvider>
  );
}
