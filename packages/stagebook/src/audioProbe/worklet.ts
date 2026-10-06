// The AudioWorklet processor that measures a calibration asset as it plays.
//
// Shipped as source text and loaded from a Blob URL, so hosts need no bundler
// configuration or extra served file to use the probe. A worklet module runs
// in its own global scope and cannot import from the page, so the constants it
// shares with analyze.ts are interpolated here.
//
// For each decoded channel it records the loudest sample and when it came,
// how many samples (and from when to when) exceeded HOT_LEVEL, and in how
// many separate bursts. Frames are the AudioContext's `currentFrame`, so
// peak times from different channels of one node are directly comparable.
// It replies to any message with its report (a `ProbeReport`), and never
// outputs sound.

import { BURST_GAP_SECONDS, HOT_LEVEL } from "./analyze.js";

export const PROCESSOR_NAME = "stagebook-channel-order-probe";

export const WORKLET_SOURCE = `
const HOT_LEVEL = ${HOT_LEVEL};
const BURST_GAP_SECONDS = ${BURST_GAP_SECONDS};

class ChannelOrderProbe extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const channels = options.processorOptions.channels;
    this.burstGapFrames = BURST_GAP_SECONDS * sampleRate;
    this.inputChannels = 0;
    this.stats = [];
    for (let c = 0; c < channels; c++) {
      this.stats.push({
        peak: 0,
        peakFrame: -1,
        hotSamples: 0,
        firstHotFrame: -1,
        lastHotFrame: -1,
        bursts: 0,
      });
    }
    this.port.onmessage = () => {
      this.port.postMessage({
        sampleRate,
        inputChannels: this.inputChannels,
        channels: this.stats,
      });
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (input.length > this.inputChannels) this.inputChannels = input.length;
    const count = Math.min(input.length, this.stats.length);
    for (let c = 0; c < count; c++) {
      const samples = input[c];
      const s = this.stats[c];
      for (let i = 0; i < samples.length; i++) {
        const level = Math.abs(samples[i]);
        if (level > HOT_LEVEL) {
          const frame = currentFrame + i;
          s.hotSamples++;
          if (s.lastHotFrame < 0 || frame - s.lastHotFrame > this.burstGapFrames) {
            s.bursts++;
          }
          if (s.firstHotFrame < 0) s.firstHotFrame = frame;
          s.lastHotFrame = frame;
        }
        if (level > s.peak) {
          s.peak = level;
          s.peakFrame = currentFrame + i;
        }
      }
    }
    return true;
  }
}

registerProcessor(${JSON.stringify(PROCESSOR_NAME)}, ChannelOrderProbe);
`;
