# Changelog

## Unreleased

## 0.40.0

- Re-vendor the channel-order calibration assets from compose_group 3.0.0
  ([#839](https://github.com/talkbench/stagebook/issues/839)), which encodes
  the group Opus track at 48 kbps per channel. The `stagebook/audio-probe`
  bundle grows to about 185 kB of base64.
- Add `checkMultichannelDecode()` to `stagebook/audio-probe`
  ([#840](https://github.com/talkbench/stagebook/issues/840)): a check, with no
  user gesture, that the browser can decode multichannel Opus at all. It uses
  `decodeAudioData` and the probe's own marker analysis, and reports no
  channel order. WebKit fails it. Adds the failure reason `decode`.
- Let a group recording wait for the channel probe
  ([#841](https://github.com/talkbench/stagebook/issues/841)). With the new
  optional `StagebookContext.requestChannelProbe`, a recording that has no
  passing probe yet shows **Prepare audio** in place of the refusal, and a
  linked Timeline shows that tracks will appear once the audio is ready.
  `createChannelProbe()` shares one probe across a session. Hosts that don't
  supply `requestChannelProbe` see no change.
- Fix timelines in the VS Code preview, which have shown the channel-layout
  error for every recording since 0.38.0
  ([#837](https://github.com/talkbench/stagebook/issues/837)). The media
  player's channel-count AudioWorklet module loaded from a `blob:` URL, which
  the preview's Content-Security-Policy refuses. The extension now ships the
  module as a file and allows that one file.
- Ship the AudioWorklet modules as files, `stagebook/worklets/channel-count.js`
  and `stagebook/worklets/channel-order-probe.js`, so a host with a
  Content-Security-Policy need not allow `blob:` scripts. Serve them and pass
  their URLs as `channelCountWorkletUrl` (a new optional `StagebookContext`
  field, also a `PreviewHost` and `Viewer` prop) and
  `probeChannelOrder({ workletUrl })`. Without the URLs the modules load from
  `blob:` URLs as before, so hosts that set no policy need no change.
- When the channel-count module cannot load, the diagnostic passed to
  `onElementError` says how it was loaded and what to change. The viewer and
  the VS Code preview show a media player's channel diagnostics above the
  stage, where before the researcher saw only the participant's message about
  the recording.

## 0.39.0

- VS Code preview: flag `asset://` files missing from their mounted folder
  ([#833](https://github.com/talkbench/stagebook/issues/833)). The asset banner
  names each folder that lacks a file the treatment or a loaded task file
  references, lists the missing files, and offers **Change…**. Adds
  `collectAssetUris()`, which lists a treatment's `asset://` file references.
- VS Code preview: change a mapped asset folder from the **Fill in remaining
  fields** screen ([#813](https://github.com/talkbench/stagebook/issues/813)).
- Keep stage `conditions`, mediaPlayer `playback` and timeline settings in
  resolved-schema output, and add `safeParseResolvedTreatmentFile()`, which
  returns participant-safe `data` only after the schema, placeholder and
  expression-type checks all pass
  ([#821](https://github.com/talkbench/stagebook/issues/821)). Hosts should
  publish its `data`: it omits authoring `notes`, `imports` and `templates`.
  **Type change:** `resolvedTreatmentFileSchema` is now a Zod pipe (no
  `.shape`, `.extend` or `.merge`), and `ResolvedTreatmentFileType` no longer
  has `imports` or `templates`. `validateResolvedTreatmentFile()` is unchanged.
- Add first-focus timing to existing solo text and numeric response saves
  ([#831](https://github.com/talkbench/stagebook/issues/831)). Record the local
  delay since field mount and the host stage time observed at first focus,
  independently of later save time. Add no writes or timers; preserve existing
  typing and pointer measurements.
- Add bounded pointer and text-field focus statistics to solo text, numeric,
  radio, and checkbox response records and submit-button records
  ([#827](https://github.com/talkbench/stagebook/issues/827)). Preserve click
  placement, pointer/keyboard/unknown context, and field focus context on the
  existing saves. Collect no pointer trajectories or additional text; retain
  existing typing measurements and response commit timing.
- Add audio state, bounded volume/presentation events, and hidden/unfocused
  playback totals to existing MediaPlayer saves
  ([#825](https://github.com/talkbench/stagebook/issues/825)). Volume gestures
  are coalesced locally; these observations add no host writes or gating.
- Add input-event, composition, shortcut, and clipboard statistics to solo text
  and numeric response telemetry ([#824](https://github.com/talkbench/stagebook/issues/824)).
  Include input timing and a capped list of large insertions with event context;
  record lengths and counts, never inserted text or clipboard contents. Existing
  keystroke measurements and response save boundaries are unchanged.
- Include current numeric-response typing snapshots with every existing response
  commit, matching text responses. Checkpoints replace the current visit's
  provisional summary; blur finalizes it. No additional host saves are introduced.

Earlier releases are documented in [GitHub Releases](https://github.com/talkbench/stagebook/releases).
