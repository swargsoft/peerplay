// Tests the NTP sync pure functions: best-cluster offset estimation,
// wait time calculation, and measurement filtering behavior.

import { describe, expect, it, mock } from "bun:test";
import { calculateOffsetEstimate, calculateWaitTimeMilliseconds, type NTPMeasurement } from "@/utils/ntp";
import * as shared from "@pearplay/shared";

const FROZEN_TIME = 10000;

// Mock epochNow to return a fixed value so wait time math is exact
mock.module("@pearplay/shared", () => ({
  ...shared,
  epochNow: () => FROZEN_TIME,
}));

function createMeasurement(data: { roundTripDelay: number; clockOffset: number }): NTPMeasurement {
  return {
    t0: 1000,
    t1: 1000 + data.clockOffset + data.roundTripDelay / 2,
    t2: 1000 + data.clockOffset + data.roundTripDelay / 2,
    t3: 1000 + data.roundTripDelay,
    roundTripDelay: data.roundTripDelay,
    clockOffset: data.clockOffset,
  };
}

describe("calculateOffsetEstimate", () => {
  it("falls back to the single min-RTT sample when no cluster forms", () => {
    const measurements: NTPMeasurement[] = [
      createMeasurement({ roundTripDelay: 10, clockOffset: 100 }),
      createMeasurement({ roundTripDelay: 200, clockOffset: 500 }),
      createMeasurement({ roundTripDelay: 300, clockOffset: 800 }),
    ];

    const result = calculateOffsetEstimate(measurements);

    // Min RTT is 10; 20 and 300 are far above the cluster margin
    expect(result.averageOffset).toBe(100);

    // Average round trip uses ALL measurements: (10 + 200 + 300) / 3 ≈ 170
    expect(result.averageRoundTrip).toBeCloseTo(170);
  });

  it("averages offsets across near-min-RTT samples to reduce variance", () => {
    const measurements: NTPMeasurement[] = [
      createMeasurement({ roundTripDelay: 18, clockOffset: 149 }),
      createMeasurement({ roundTripDelay: 22, clockOffset: 151 }),
      createMeasurement({ roundTripDelay: 20, clockOffset: 150 }),
      createMeasurement({ roundTripDelay: 500, clockOffset: 350 }),
      createMeasurement({ roundTripDelay: 800, clockOffset: -150 }),
    ];

    const result = calculateOffsetEstimate(measurements);

    // Min RTT is 18 → cluster margin = max(1.8, 5) = 5ms → threshold 23ms.
    // Samples at 18/22/20 join the cluster: avg(149, 151, 150) = 150.
    // High-RTT spikes have zero influence.
    expect(result.averageOffset).toBe(150);
  });

  it("handles negative clock offsets (client ahead of server)", () => {
    const measurements: NTPMeasurement[] = [
      createMeasurement({ roundTripDelay: 12, clockOffset: -48 }),
      createMeasurement({ roundTripDelay: 10, clockOffset: -50 }),
      createMeasurement({ roundTripDelay: 15, clockOffset: -55 }),
      createMeasurement({ roundTripDelay: 500, clockOffset: -200 }),
    ];

    const result = calculateOffsetEstimate(measurements);

    // Min RTT is 10 → threshold 15 → cluster {10, 12, 15}
    expect(result.averageOffset).toBeCloseTo((-50 + -48 + -55) / 3);
  });

  it("handles a single measurement", () => {
    const measurements: NTPMeasurement[] = [createMeasurement({ roundTripDelay: 50, clockOffset: 200 })];

    const result = calculateOffsetEstimate(measurements);

    expect(result.averageOffset).toBe(200);
    expect(result.averageRoundTrip).toBe(50);
  });

  it("returns zeros with no measurements", () => {
    const result = calculateOffsetEstimate([]);
    expect(result.averageOffset).toBe(0);
    expect(result.averageRoundTrip).toBe(0);
  });
});

describe("calculateWaitTimeMilliseconds", () => {
  // epochNow() is mocked to return FROZEN_TIME (10000)

  it("should return exact wait time when target is in the future", () => {
    // estimatedCurrentServerTime = 10000 + 500 = 10500
    // wait = 11000 - 10500 = 500
    expect(calculateWaitTimeMilliseconds(11000, 500)).toBe(500);
  });

  it("should return 0 when target time has already passed", () => {
    // estimatedCurrentServerTime = 10000 + 0 = 10000
    // wait = max(0, 5000 - 10000) = 0
    expect(calculateWaitTimeMilliseconds(5000, 0)).toBe(0);
  });

  it("should handle negative clock offset (client ahead of server)", () => {
    // estimatedCurrentServerTime = 10000 + (-200) = 9800
    // wait = 10300 - 9800 = 500
    expect(calculateWaitTimeMilliseconds(10300, -200)).toBe(500);
  });
});
