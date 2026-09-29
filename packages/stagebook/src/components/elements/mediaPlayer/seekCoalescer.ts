export interface CoalescedSeek {
  /** Where the stream of seeks started. */
  fromTime: number;
  /** Where it landed. */
  videoTime: number;
  /** Stage time when it started. */
  stageTimeElapsed: number;
}

export interface SeekCoalescer {
  seek(fromTime: number, videoTime: number, stageTimeElapsed: number): void;
  /** Log the pending seek now, if there is one. */
  flush(): void;
}

/**
 * Collapses a stream of seeks — a Timeline drag, held keys, the scrub bar —
 * into one logged seek, so a gesture neither floods the host with saves nor
 * the log with a seek per pointer move (#682). The pending seek is logged
 * once no further seek arrives for `settleMs`, or earlier through `flush`.
 * The MediaPlayer flushes before logging any other event, so the log stays
 * in order, and at unmount. A stream that ends where it started logs nothing.
 */
export function createSeekCoalescer(
  log: (seek: CoalescedSeek) => void,
  settleMs: number,
): SeekCoalescer {
  let pending: CoalescedSeek | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const seek = pending;
    pending = null;
    if (seek && seek.videoTime !== seek.fromTime) log(seek);
  };

  return {
    seek(fromTime, videoTime, stageTimeElapsed) {
      pending = pending
        ? { ...pending, videoTime }
        : { fromTime, videoTime, stageTimeElapsed };
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, settleMs);
    },
    flush,
  };
}
