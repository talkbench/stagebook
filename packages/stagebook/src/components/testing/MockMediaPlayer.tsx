/**
 * Test wrapper for MediaPlayer. Handles function props that Playwright CT
 * can't serialize, and exposes save calls and completion via the DOM.
 */
import React, { useState } from "react";
import { MediaPlayer, type MediaPlayerProps } from "../elements/MediaPlayer.js";

export interface MockMediaPlayerProps extends Omit<
  MediaPlayerProps,
  "save" | "getElapsedTime" | "onComplete"
> {
  elapsedTime?: number;
}

export function MockMediaPlayer({
  elapsedTime = 0,
  ...props
}: MockMediaPlayerProps) {
  const [saves, setSaves] = useState<Array<{ key: string; value: unknown }>>(
    [],
  );
  const [completed, setCompleted] = useState(false);

  return (
    <div>
      <MediaPlayer
        {...props}
        save={(key, value) => setSaves((prev) => [...prev, { key, value }])}
        getElapsedTime={() => elapsedTime}
        onComplete={() => setCompleted(true)}
      />
      <div data-testid="save-log" style={{ display: "none" }}>
        {JSON.stringify(saves)}
      </div>
      <div data-testid="completed" style={{ display: "none" }}>
        {String(completed)}
      </div>
    </div>
  );
}

/**
 * Harness for the invalid→valid URL transition (#484). Holds the URL in
 * component state and swaps it on button click, so the underlying
 * MediaPlayer instance re-renders *in place* (rather than remounting). This
 * is what surfaces a rules-of-hooks violation if the unsafe-URL guard sits
 * ahead of the hooks.
 */
export interface UrlTransitionMediaPlayerProps {
  initialUrl: string;
  nextUrl: string;
  name: string;
}

export function UrlTransitionMediaPlayer({
  initialUrl,
  nextUrl,
  name,
}: UrlTransitionMediaPlayerProps) {
  const [url, setUrl] = useState(initialUrl);
  return (
    <div>
      <button
        type="button"
        data-testid="swap-url"
        onClick={() => setUrl(nextUrl)}
      >
        swap
      </button>
      <MockMediaPlayer url={url} name={name} />
    </div>
  );
}
