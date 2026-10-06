// MediaPlayer's per-channel Web Audio graph, built when a Timeline asks for
// waveforms.
//
// A group recording's channels are participants, not speaker positions.
// Merging them into one N-channel stream for the destination would have the
// browser mix them down as speaker layouts: at 2 channels each participant
// in one ear only, at 3, 5, 7 and 8 every channel past the first two
// silent, at 6 the fourth dropped as the bass channel (#663). So the
// channels are summed to mono instead, which the destination plays in both
// ears.

export interface PlaybackGraph {
  /** Per-channel taps for the waveform, ahead of the channel's gain. */
  readonly analysers: AnalyserNode[];
  /** Per-channel gains, which mute sets to 0. */
  readonly gains: GainNode[];
}

/**
 * Split `source` into `channelCount` channels, each through an analyser and
 * a gain, and sum them at 1/`channelCount` each into both ears of
 * `ctx.destination`.
 *
 * The 1/N share keeps people talking over each other from clipping, and
 * matches the pipeline's own mix (amix normalisation). Muting a channel
 * removes exactly its share.
 */
export function buildPlaybackGraph(
  ctx: BaseAudioContext,
  source: AudioNode,
  channelCount: number,
): PlaybackGraph {
  const splitter = ctx.createChannelSplitter(channelCount);
  source.connect(splitter);
  // Explicitly mono: the per-channel gains sum here, and the destination
  // up-mixes mono to both speakers.
  const mix = ctx.createGain();
  mix.channelCount = 1;
  mix.channelCountMode = "explicit";
  mix.gain.value = 1 / channelCount;
  mix.connect(ctx.destination);

  const analysers: AnalyserNode[] = [];
  const gains: GainNode[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    // AnalyserNode is a pass-through tap, so the waveform shows the
    // recorded (pre-mute) signal. Keeping it inline, not dead-ended, makes
    // the graph pull it, so getByteTimeDomainData() returns live samples.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    splitter.connect(analyser, ch);
    const gain = ctx.createGain();
    gain.gain.value = 1;
    analyser.connect(gain);
    gain.connect(mix);
    analysers.push(analyser);
    gains.push(gain);
  }
  return { analysers, gains };
}
