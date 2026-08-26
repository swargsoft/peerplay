/**
 * Drift detection (roadmap Stage 12).
 *
 * After synchronized playback begins, periodically measure whether this
 * device's audio-clock position diverges from the shared server timeline.
 * The first MVP MEASURES drift; it does not correct it.
 *
 * Model:
 *   A schedule establishes an anchor: at server time S the track position is P.
 *   Later, expected position = P + (serverNow − S).
 *   gap = actualPosition − expectedPosition (ms).
 *
 * A CONSTANT gap means the clock offset estimate is slightly off (harmless —
 * everyone hears the same thing at the same instant). DRIFT is the *change*
 * in gap over time: if the local AudioContext clock runs at a different rate
 * than the reference, the gap grows linearly.
 */

export interface PlayTimelineAnchor {
  /** Server-clock epoch ms at which the track position is known. */
  serverTimeMs: number;
  /** Track position (seconds) corresponding to serverTimeMs. */
  trackPositionSec: number;
}

/**
 * Compute the current gap between the audio clock's actual position and the
 * server-timeline expectation, in milliseconds.
 */
export function sampleGapMs(opts: {
  anchor: PlayTimelineAnchor;
  actualPositionSec: number;
  nowEpochMs: number;
  /** Local→server clock offset estimate (epochNow() + offset ≈ server now). */
  clockOffsetMs: number;
}): number {
  const serverNowMs = opts.nowEpochMs + opts.clockOffsetMs;
  const elapsedSec = (serverNowMs - opts.anchor.serverTimeMs) / 1000;
  const expectedPositionSec = opts.anchor.trackPositionSec + elapsedSec;
  return (opts.actualPositionSec - expectedPositionSec) * 1000;
}

export interface DriftSnapshot {
  /** Number of samples in the analysis window. */
  samples: number;
  /** Most recent gap (ms). */
  latestGapMs: number | null;
  /** Least-squares trend of the gap, ms per minute. Near zero = no drift. */
  driftPerMinute: number | null;
}

export const EMPTY_DRIFT_SNAPSHOT: DriftSnapshot = {
  samples: 0,
  latestGapMs: null,
  driftPerMinute: null,
};

interface DriftSample {
  at: number;
  gapMs: number;
}

export class DriftTracker {
  private readonly samples: DriftSample[] = [];
  private snapshot: DriftSnapshot = EMPTY_DRIFT_SNAPSHOT;

  constructor(private readonly capacity = 30) {}

  record(gapMs: number, at = Date.now()): DriftSnapshot {
    this.samples.push({ at, gapMs });
    if (this.samples.length > this.capacity) this.samples.shift();
    this.snapshot = this.analyze();
    return this.snapshot;
  }

  getSnapshot(): DriftSnapshot {
    return this.snapshot;
  }

  reset(): void {
    this.samples.length = 0;
    this.snapshot = EMPTY_DRIFT_SNAPSHOT;
  }

  private analyze(): DriftSnapshot {
    const n = this.samples.length;
    if (n === 0) return EMPTY_DRIFT_SNAPSHOT;

    const latest = this.samples[n - 1]!.gapMs;

    // Least-squares slope of gap vs time (ms/ms → ms/minute).
    let driftPerMinute: number | null = null;
    if (n >= 2 && this.samples[n - 1]!.at !== this.samples[0]!.at) {
      const meanT = this.samples.reduce((s, x) => s + x.at, 0) / n;
      const meanG = this.samples.reduce((s, x) => s + x.gapMs, 0) / n;
      let num = 0;
      let den = 0;
      for (const s of this.samples) {
        num += (s.at - meanT) * (s.gapMs - meanG);
        den += (s.at - meanT) ** 2;
      }
      if (den > 0) driftPerMinute = (num / den) * 60_000;
    }

    return { samples: n, latestGapMs: latest, driftPerMinute };
  }
}
