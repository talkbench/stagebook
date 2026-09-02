// Pure waveform capture logic — no React/DOM dependencies.
// Used by MediaPlayer to accumulate peak data from AnalyserNodes.

/**
 * Hard cap on the number of buckets allocated per channel. At the default
 * 10 buckets/second this caps memory at ~16 MB per channel (8 bytes per
 * Float32 × 2 entries × 1_000_000 buckets), which is ~28 hours of audio.
 * Beyond this, we degrade gracefully — capture still runs but the buffer
 * stops growing rather than blowing up memory on pathological inputs.
 */
export const MAX_BUCKETS = 1_000_000;

/**
 * How many time buckets are needed to cover the given duration.
 * Returns 0 for non-finite or non-positive durations, capped at MAX_BUCKETS.
 */
export function computeBucketCount(
  duration: number,
  bucketsPerSecond: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.ceil(duration * bucketsPerSecond), MAX_BUCKETS);
}

/**
 * Map a playback time to a bucket index. Clamps negative times to 0.
 */
export function timeToBucket(time: number, bucketsPerSecond: number): number {
  return Math.floor(Math.max(0, time) * bucketsPerSecond);
}

/**
 * Create the peaks storage arrays for all channels.
 * Each array has `2 * bucketCount` elements: interleaved [min, max] per bucket.
 * Initialized with sentinel values (min=1, max=-1) so we can detect
 * which buckets have been filled.
 */
export function createPeaksArrays(
  channelCount: number,
  bucketCount: number,
): Float32Array[] {
  const arrays: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    const arr = new Float32Array(bucketCount * 2);
    for (let i = 0; i < bucketCount; i++) {
      arr[i * 2] = 1; // min sentinel
      arr[i * 2 + 1] = -1; // max sentinel
    }
    arrays.push(arr);
  }
  return arrays;
}

/**
 * Returns true if every analyser buffer contains only the silence midpoint
 * (128 from getByteTimeDomainData). Used by the tainting detector — if all
 * buffers are flat after several seconds of playback, the AnalyserNode is
 * almost certainly receiving CORS-tainted (zeroed) audio.
 */
export function allBuffersSilent(buffers: Uint8Array[]): boolean {
  if (buffers.length === 0) return false;
  for (const buf of buffers) {
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 128) return false;
    }
  }
  return true;
}

/**
 * Accumulate one frame of analyser data into the peaks arrays.
 *
 * @param peaks - Per-channel Float32Arrays (interleaved min/max)
 * @param analyserBuffers - Per-channel Uint8Array from getByteTimeDomainData()
 * @param currentTime - Current playback position in seconds
 * @param bucketsPerSecond - Resolution of the peaks data
 */
export function accumulatePeaks(
  peaks: Float32Array[],
  analyserBuffers: Uint8Array[],
  currentTime: number,
  bucketsPerSecond: number,
): void {
  const bucket = timeToBucket(currentTime, bucketsPerSecond);

  for (let ch = 0; ch < peaks.length; ch++) {
    const peakArr = peaks[ch];
    const data = analyserBuffers[ch];
    if (!peakArr || !data) continue;

    const bucketCount = peakArr.length / 2;
    if (bucket >= bucketCount) continue;

    // Find min/max of this frame's samples, normalized to [-1, 1]
    let frameMin = 1;
    let frameMax = -1;
    for (let i = 0; i < data.length; i++) {
      const normalized = (data[i] - 128) / 128;
      if (normalized < frameMin) frameMin = normalized;
      if (normalized > frameMax) frameMax = normalized;
    }

    // Update the bucket: expand the min/max envelope
    const minIdx = bucket * 2;
    const maxIdx = bucket * 2 + 1;
    const existingMin = peakArr[minIdx];
    const existingMax = peakArr[maxIdx];

    if (frameMin < existingMin) peakArr[minIdx] = frameMin;
    if (frameMax > existingMax) peakArr[maxIdx] = frameMax;
  }
}

/**
 * Fold decoded PCM samples into one interleaved min/max peaks array — the
 * same shape `createPeaksArrays` allocates and `WaveformRenderer` draws.
 *
 * Every channel is merged into a single envelope (a host showing a mono
 * recording, or a compact summary of a stereo one, wants one track). Samples
 * are clamped to [-1, 1] so decoder overshoot cannot push a bar outside the
 * canvas. Every bucket a sample overlaps receives it, so a sparse input (more
 * buckets than samples) still fills the track; only empty input leaves the
 * sentinel (min=1, max=-1) in place. Non-positive bucket counts return an
 * empty array; counts above `MAX_BUCKETS` are capped.
 *
 * @param channels - Per-channel sample data, e.g. `AudioBuffer.getChannelData(i)`
 *   for each channel. All channels are expected to share one length; the
 *   longest channel defines the time axis.
 * @param bucketCount - Number of time buckets to fold the samples into.
 */
export function peaksFromSamples(
  channels: readonly Float32Array[],
  bucketCount: number,
): Float32Array {
  if (!Number.isFinite(bucketCount) || bucketCount <= 0) {
    return new Float32Array(0);
  }
  const buckets = Math.min(Math.floor(bucketCount), MAX_BUCKETS);
  const [peaks] = createPeaksArrays(1, buckets);
  let sampleCount = 0;
  for (const channel of channels) {
    if (channel.length > sampleCount) sampleCount = channel.length;
  }
  if (sampleCount === 0) return peaks;

  const samplesPerBucket = sampleCount / buckets;
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = Math.floor(bucket * samplesPerBucket);
    // Each bucket covers every sample whose span overlaps it: at least one
    // sample (so more buckets than samples never leaves gaps), and the last
    // bucket absorbs any rounding remainder so no sample is dropped.
    const end =
      bucket === buckets - 1
        ? sampleCount
        : Math.max(start + 1, Math.floor((bucket + 1) * samplesPerBucket));
    let min = 1;
    let max = -1;
    for (const channel of channels) {
      const limit = Math.min(end, channel.length);
      for (let i = start; i < limit; i++) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        if (sample < min) min = sample;
        if (sample > max) max = sample;
      }
    }
    if (min <= max) {
      peaks[bucket * 2] = min;
      peaks[bucket * 2 + 1] = max;
    }
  }
  return peaks;
}
