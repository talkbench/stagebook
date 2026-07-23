/**
 * Test wrapper for Markdown that builds a `resolveURL` callback from
 * a serializable `baseUrl` string. Playwright CT can't pass inline
 * arrow-function props across the mount boundary, so we accept a
 * string and create the callback here.
 */
import React from "react";
import { Markdown } from "../form/Markdown.js";

export interface MockMarkdownProps {
  text: string;
  baseUrl: string;
}

export function MockMarkdown({ text, baseUrl }: MockMarkdownProps) {
  return (
    <Markdown
      text={text}
      resolveURL={(p) =>
        // Mirror the webview's `buildAssetURL`: an `asset://<prefix>/<rest>` URI
        // resolves to a loadable URL (here `<base>mount/<rest>`), any other path
        // joins onto the base. Lets a CT verify `asset://` body images resolve.
        /^asset:\/\//i.test(p)
          ? p.replace(/^asset:\/\/[^/]+\//i, `${baseUrl}mount/`)
          : baseUrl + p
      }
    />
  );
}
