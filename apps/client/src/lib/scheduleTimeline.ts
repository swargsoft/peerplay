import { calculateWaitTimeMilliseconds } from "@/utils/ntp";

/**
 * Precision playback scheduling ("PLAY_AT") math.
 *
 * Pure functions converting a future *server* timestamp into an
 * AudioContext-timeline start time, plus late-schedule recovery.
 * Kept side-effect free so the sync-critical arithmetic can be unit-tested.
 */

/** Below this much remaining buffer, the schedule window is considered blown. */
export const SCHEDULE_EPSILON_SECONDS = 0.05;
/** Late-recovery: minimum extra buffer added when restarting mid-track. */
export const LATE_RECOVERY_BUFFER_MS = 200;
/** Late-recovery: cap on the retry delay. */
export const LATE_RECOVERY_MAX_DELAY_MS = 2000;

export interface PlaybackSchedulePlan {
  /** Final delay (seconds) to hand to source.start() on the AudioContext timeline. */
  waitSeconds: number;
  /**
   * Raw wait against the offset WITHOUT nudge/output-latency compensation —
   * used to distinguish genuine network lateness from locally consumed buffer.
   */
  rawBaseWaitMs: number;
  /** True when the network was genuinely too late — caller should recover mid-track. */
  late: boolean;
}

/**
 * Plan a scheduled playback start.
 *
 * @param targetServerTimeMs  Server-clock moment the track should begin.
 * @param effectiveOffsetMs   Clock offset + user nudge (what we act on).
 * @param baseOffsetMs        Raw clock offset (no nudge) for lateness diagnosis.
 * @param outputLatencyMs     Filtered speaker output latency.
 */
export function planPlaybackSchedule(opts: {
  targetServerTimeMs: number;
  effectiveOffsetMs: number;
  baseOffsetMs: number;
  outputLatencyMs: number;
}): PlaybackSchedulePlan {
  const rawBaseWaitMs = calculateWaitTimeMilliseconds(opts.targetServerTimeMs, opts.baseOffsetMs);
  let waitSeconds = calculateWaitTimeMilliseconds(opts.targetServerTimeMs, opts.effectiveOffsetMs);

  // Output latency means sound emerges from speakers AFTER source.start(),
  // so start early by exactly that amount.
  waitSeconds = Math.max(0, (waitSeconds - opts.outputLatencyMs) / 1000);

  const windowBlown = waitSeconds < SCHEDULE_EPSILON_SECONDS;
  const genuinelyLate = windowBlown && rawBaseWaitMs < 50;

  if (windowBlown && !genuinelyLate) {
    // Nudge and/or latency compensation consumed the buffer — go immediately
    // rather than skipping ahead of peers.
    waitSeconds = 0;
  }

  return { waitSeconds, rawBaseWaitMs, late: Boolean(windowBlown && genuinelyLate) };
}

export interface LateRecoveryPlan {
  /** How far past the target we were when the schedule arrived. */
  missedByMs: number;
  retryDelaySeconds: number;
  /** Track position to resume from so all peers stay aligned. */
  trackPositionAtRetry: number;
}

/**
 * When a schedule arrives too late to honor, restart playback mid-track at the
 * position the rest of the room will be at after a short re-buffer delay.
 *
 * @param nowEpochMs          Local epoch time at planning.
 * @param clockOffsetMs       Raw clock offset (local → server).
 * @param targetServerTimeMs  The originally intended server start time.
 */
export function planLateRecovery(opts: {
  rawBaseWaitMs: number;
  trackTimeSeconds: number;
  nowEpochMs: number;
  clockOffsetMs: number;
  targetServerTimeMs: number;
}): LateRecoveryPlan {
  const missedByMs = SCHEDULE_EPSILON_SECONDS * 1000 - opts.rawBaseWaitMs;
  const retryDelayMs = Math.min(
    missedByMs + LATE_RECOVERY_BUFFER_MS,
    LATE_RECOVERY_MAX_DELAY_MS
  );
  const elapsedSinceTargetMs = opts.nowEpochMs + opts.clockOffsetMs - opts.targetServerTimeMs;
  const trackPositionAtRetry =
    opts.trackTimeSeconds + (elapsedSinceTargetMs + retryDelayMs) / 1000;

  return {
    missedByMs,
    retryDelaySeconds: retryDelayMs / 1000,
    trackPositionAtRetry,
  };
}
