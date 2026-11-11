/**
 * The preview webview's Content-Security-Policy.
 *
 * Scripts run only with this load's nonce, with one exception. The media
 * player's channel-count check is an AudioWorklet module, which the browser
 * fetches by URL: a nonce cannot cover it, and the `blob:` URL the library
 * falls back to is refused by this policy (#837). So the extension ships the
 * module as a file and allows that one URL.
 *
 * `cspSource` is deliberately not a script source. It covers every local
 * resource root, including the study workspace and mounted asset folders,
 * whose files must never be able to run as script.
 */
export function buildWebviewCsp(options: {
  nonce: string;
  /** `webview.cspSource`. */
  cspSource: string;
  /** Webview URI of the packaged channel-count worklet file. */
  workletUri: string;
}): string {
  const { nonce, cspSource } = options;
  const workletSource = cspSourceForFile(options.workletUri);
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' ${workletSource}`,
    "style-src 'unsafe-inline'",
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    `media-src ${cspSource} data:`,
  ]
    .map((directive) => `${directive};`)
    .join(" ");
}

/**
 * The policy source that admits one webview file.
 *
 * A webview URI's host starts with a label naming the resource's scheme and
 * authority, such as `file+` or `vscode-remote+ssh-…`. `+` is not a legal
 * character in a policy's host, and a browser ignores a source it cannot
 * parse, which would leave the worklet refused. So that label becomes the
 * `*` wildcard, as in `webview.cspSource` itself. The path stays exact: the
 * source admits this file's path and nothing else under it.
 */
export function cspSourceForFile(fileUri: string): string {
  // The URI is also written into HTML attributes. One containing a
  // separator, a quote or a character reference (decoded before the policy
  // is parsed) could add sources or directives.
  if (/[\s;,'"<>&`]/.test(fileUri)) {
    throw new Error(
      `The channel-count worklet URI cannot be written into the preview's Content-Security-Policy: ${fileUri}`,
    );
  }
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]+)(\/[^?#]*)$/i.exec(fileUri);
  if (!match) {
    throw new Error(
      `The channel-count worklet URI is not a file URL the preview's Content-Security-Policy can name: ${fileUri}`,
    );
  }
  const [, scheme, host, path] = match;
  const labels = host.split(".");
  if (!/^[a-z0-9-]+$/i.test(labels[0]) && labels.length > 2) labels[0] = "*";
  const policyHost = labels.join(".");
  if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/i.test(policyHost)) {
    throw new Error(
      `The channel-count worklet URI's host cannot be named in the preview's Content-Security-Policy: ${fileUri}`,
    );
  }
  return `${scheme}${policyHost}${path}`;
}
