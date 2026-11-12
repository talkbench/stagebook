# AudioWorklet modules ship as files; the host says where they are served

Status: implements [#837](https://github.com/talkbench/stagebook/issues/837).

Stagebook runs two AudioWorklet modules: the channel-count check behind every
media player with a linked timeline, and the channel-order probe. Both were
built in the page and loaded from `blob:` URLs, so that a host needed no
served file and no bundler configuration.

A worklet module is a script. A Content-Security-Policy that does not list
`blob:` among its script sources refuses it. The VS Code preview has such a
policy, and since 0.38.0 every timeline there has failed. The failure reads
as a fault in the recording ("This recording's speaker tracks cannot be
presented reliably"), so nothing connects it to the policy. Any host that
adopts a policy would break the same way.

## Decision

1. **The modules are files in the package**, `stagebook/worklets/channel-count.js`
   and `stagebook/worklets/channel-order-probe.js`, with the same text the
   blob is built from.
2. **The host tells stagebook where it serves them**: `channelCountWorkletUrl`
   on the `StagebookContext`, and `workletUrl` for `probeChannelOrder()`. A
   host that does so needs only `script-src 'self'`.
3. **Without a URL the modules load from `blob:` as before.** A host with no
   policy changes nothing.
4. **The VS Code preview packages the channel-count file and allows that one
   file's path** in its policy. It does not allow `blob:`, and it does not
   allow the webview's general resource origin as a script source.
5. **A module that cannot load reports how it was loaded and what to change**,
   and the viewer and the VS Code preview show a media player's channel
   diagnostics to the researcher. The participant's message is unchanged.

## Why the host supplies the URL

Stagebook cannot find its own files at run time. The usual idiom,
`new URL("./file.js", import.meta.url)`, works only when the consumer's
bundler rewrites it, and stagebook's consumers do not all do so:

- The VS Code webview is an esbuild IIFE bundle. It has no `import.meta.url`.
- Vite pre-bundles dependencies in development and moves the importing
  module, so the relative URL points at a file that is not there.
- The CommonJS build has no `import.meta`.

Each of these would fail when the page runs, with the same misleading error
this change exists to remove. A URL the host passes is explicit, works with
any bundler or none, and can be checked by reading the host's code. Fonts and
styles already reach hosts the same way, as package files the host wires up.

## Rejected

- **Allow `blob:` in the preview's policy.** It fixes the preview and nothing
  else, and it lets any blob the page creates run as a script.
- **Allow the webview's resource origin (`cspSource`) as a script source.**
  That origin covers the study workspace and mounted asset folders. Study
  files must never be eligible to run as script in the preview.
- **Require the URL and drop the `blob:` path.** Every host would break on
  upgrade until it served the files, including those with no policy.
- **Embed the module as a `data:` URI.** A policy that refuses `blob:`
  refuses `data:` too.

## Consequences

- A host with a Content-Security-Policy has two URLs to wire up, described in
  the [integration guide](../engineer/integration-guide.md#audioworklet-modules-under-a-content-security-policy).
- A host could serve a copy of a module from a different release than the
  one it renders with. Hosts are told to take the files from the installed
  package at build time.
- Bundlers may inline small files as `data:` URIs (Vite does). The guide says
  how to prevent it.
