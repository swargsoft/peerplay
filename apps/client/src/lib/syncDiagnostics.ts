/**
 * Synchronization diagnostics (roadmap Stage 11).
 *
 * Tracks how precisely scheduled playback actually starts. When a schedule is
 * honored, `source.start(startTime)` is issued while the AudioContext clock is
 * still BEFORE startTime — the remaining margin is how early we managed to arm
 * it. If start() is issued after startTime has passed, playback audibly begins
 * late by that difference.
 */

export interface ScheduleAccuracySnapshot {
  /** Error of the most recent schedule: negative = started with margin left, positive ms = started late. */
  lastErrorMs: number | null;
  /** Mean absolute error across the rolling window. */
  meanAbsErrorMs: number;
  /** Total schedules observed since session start. */
  samples: number;
  /** Schedules where audio audibly began after its intended time. */
  lateStarts: number;
}

export const EMPTY_SCHEDULE_ACCURACY: ScheduleAccuracySnapshot = {
  lastErrorMs: null,
  meanAbsErrorMs: 0,
  samples: 0,
  lateStarts: 0,
};

export class ScheduleAccuracyTracker {
  private readonly window: number[] = [];
  private snapshot: ScheduleAccuracySnapshot = EMPTY_SCHEDULE_ACCURACY;

  constructor(private readonly capacity = 20) {}

  /** Record one schedule outcome (error in milliseconds). */
  record(errorMs: number): ScheduleAccuracySnapshot {
    this.window.push(errorMs);
    if (this.window.length > this.capacity) this.window.shift();

    const sum = this.window.reduce((acc, e) => acc + Math.abs(e), 0);
    this.snapshot = {
      lastErrorMs: errorMs,
      meanAbsErrorMs: sum / this.window.length,
      samples: this.snapshot.samples + 1,
      lateStarts: this.snapshot.lateStarts + (errorMs > 0 ? 1 : 0),
    };
    return this.snapshot;
  }

  getSnapshot(): ScheduleAccuracySnapshot {
    return this.snapshot;
  }

  reset(): void {
    this.window.length = 0;
    this.snapshot = EMPTY_SCHEDULE_ACCURACY;
  }
}
