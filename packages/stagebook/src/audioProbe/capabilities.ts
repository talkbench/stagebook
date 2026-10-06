/**
 * What this release does with multichannel group recordings, so a host can
 * key its gate mode on the stagebook it bundles rather than on a separate
 * flag (talkbench/annotator#226).
 *
 * - `channelProbe`: {@link probeChannelOrder} is available (#663 Release A).
 * - `perSpeakerTracks`: MediaPlayer draws one waveform track per participant
 *   channel, reordered by the probe's mapping (#663 Release B).
 *
 * Typed as booleans, not literals, so host code that branches on a value
 * still type-checks when a later release flips it.
 */
export const CAPABILITIES: Readonly<{
  channelProbe: boolean;
  perSpeakerTracks: boolean;
}> = Object.freeze({ channelProbe: true, perSpeakerTracks: false });
