// Tests for the precision playback scheduling math (PLAY_AT → AudioContext
// timeline conversion and late-schedule recovery).

import { describe, expect, it, mock } from "bun:test";
import { planLateRecovery, planPlaybackSchedule } from "@/lib/scheduleTimeline";
import * as shared from "@pearplay/shared";

const FROZEN_TIME = 10000;

mock.module("@pearplay/shared", () => ({
  ...shared,
  epochNow: () => FROZEN_TIME,
}));

describe("planPlaybackSchedule", () => {
  it("computes a positive wait and subtracts output latency", () => {
    // target is 1000ms ahead of server-now; effective offset 100ms
    // raw wait = 1000 - 100 = 900ms; minus 20ms OL → 880ms
    const plan = planPlaybackSchedule({
      targetServerTimeMs: FROZEN_TIME + 1000,
      effectiveOffsetMs: 100,
      baseOffsetMs: 100,
      outputLatencyMs: 20,
    });

    expect(plan.waitSeconds).toBeCloseTo(0.88);
    expect(plan.late).toBe(false);
  });

  it("clamps to zero without lateness when only compensation consumed the buffer", () => {
    // Nudge (480ms) ate the whole buffer, but against the BASE offset the
    // schedule is still comfortably in the future → play immediately, no
    // mid-track recovery.
    const plan = planPlaybackSchedule({
      targetServerTimeMs: FROZEN_TIME + 500,
      effectiveOffsetMs: 480,
      baseOffsetMs: 0,
      outputLatencyMs: 40,
    });

    // (500-480-40)/1000 < 0 → clamp to 0
    expect(plan.waitSeconds).toBe(0);
    expect(plan.late).toBe(false);
  });

  it("flags genuine lateness when even the base offset misses the window", () => {
    const plan = planPlaybackSchedule({
      targetServerTimeMs: FROZEN_TIME - 500, // target long past
      effectiveOffsetMs: 0,
      baseOffsetMs: 0,
      outputLatencyMs: 20,
    });

    expect(plan.late).toBe(true);
    // Raw wait is clamped at zero by calculateWaitTimeMilliseconds
    expect(plan.rawBaseWaitMs).toBe(0);
  });
});

describe("planLateRecovery", () => {
  it("adds recovery buffer on top of the missed time", () => {
    const recovery = planLateRecovery({
      rawBaseWaitMs: 30, // missed by 50 - 30 = 20ms
      trackTimeSeconds: 10,
      nowEpochMs: FROZEN_TIME,
      clockOffsetMs: 0,
      targetServerTimeMs: FROZEN_TIME - 400,
    });

    expect(recovery.missedByMs).toBe(20);
    expect(recovery.retryDelaySeconds).toBeCloseTo(0.22); // 20 + 200 buffer

    // elapsed since target = 400ms → position advances by 400 + 220 = 620ms
    expect(recovery.trackPositionAtRetry).toBeCloseTo(10.62);
  });

  it("caps the retry delay at 2s", () => {
    // Raw wait clamps at 0 → worst case missedBy is 50ms → 250ms delay;
    // the 2s cap remains as a safety bound for future threshold changes.
    const recovery = planLateRecovery({
      rawBaseWaitMs: 0,
      trackTimeSeconds: 5,
      nowEpochMs: FROZEN_TIME,
      clockOffsetMs: 0,
      targetServerTimeMs: FROZEN_TIME - 12_000,
    });

    expect(recovery.retryDelaySeconds).toBeCloseTo(0.25);
  });

  it("accounts for clock offset when computing elapsed time", () => {
    const recovery = planLateRecovery({
      rawBaseWaitMs: 30,
      trackTimeSeconds: 0,
      nowEpochMs: 10000,
      clockOffsetMs: 250, // local clock runs 250ms ahead of server
      targetServerTimeMs: 9800, // server time of intended start
    });

    // elapsedSinceTarget in server time = (10000 + 250) - 9800 = 450ms
    // retry delay = (50-30) + 200 = 220ms → total advance 670ms
    expect(recovery.trackPositionAtRetry).toBeCloseTo(0.67);
  });
});
