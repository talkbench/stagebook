// Reporting an AudioWorklet module that will not load. Kept apart from
// probe.ts so MediaPlayer can use it without bundling the probe.

export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * What to check when an AudioWorklet module will not load: the usual cause
 * is a Content-Security-Policy, and the browser's error does not say so.
 * `file` is the module's package path, `option` how a host passes its URL.
 */
export function workletLoadHint(
  file: string,
  option: string,
  url: string | undefined,
): string {
  return url === undefined
    ? `It was loaded from a blob: URL. If this page sets a Content-Security-Policy, serve ${file} and pass its URL as ${option}, or allow blob: in script-src. AudioWorklet also needs a secure context.`
    : `It was loaded from ${url}. Check that the file is served there as JavaScript and that the page's Content-Security-Policy allows it in script-src. AudioWorklet also needs a secure context.`;
}
