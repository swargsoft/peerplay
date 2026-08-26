import { describe, expect, test } from "bun:test";
import { DriftTracker, sampleGapMs, type PlayTimelineAnchor } from "@/lib/driftDetection";

const ANCHOR: PlayTimelineAnchor = { serverTimeMs: 100_000, trackPositionSec: 30 };

describe("sampleGapMs", () => {
  test("returns ~0 when perfectly aligned", () => {
    // At server time 105_000 (5s after anchor) expected position is 35s.
    const gap = sampleGapMs({
      anchor: ANCHOR,
      actualPositionSec: 35,
      nowEpochMs: 104_900, // local clock 100ms behind server
      clockOffsetMs: 100,
    });
    expect(gap).toBeCloseTo(0);
  });

  test("detects when audio clock runs behind the timeline", () => {
    const gap = sampleGapMs({
      anchor: ANCHOR,
      actualPositionSec: 35.006, // 6ms ahead of expectation
      nowEpochMs: 104_900,
      clockOffsetMs: 100,
    });
    expect(gap).toBeCloseTo(6);
  });

  test("handles negative clock offset", () => {
    const gap = sampleGapMs({
      anchor: ANCHOR,
      actualPositionSec: 35,
      nowEpochMs: 105_000,
      clockOffsetMs: -250,
    });
    // serverNow = 104_750 → expected 34.75s → gap +250ms
    expect(gap).toBeCloseTo(250);
  });
});

describe("DriftTracker", () => {
  test("starts empty", () => {
    const t = new DriftTracker();
    const s = t.getSnapshot();
    expect(s.samples).toBe(0);
    expect(s.latestGapMs).toBeNull();
    expect(s.driftPerMinute).toBeNull();
  });

  test("reports latest gap and needs time span for a rate", () => {
    const t0 = 1_000_000;
    const t = new DriftTracker();
    t.record(5, t0);
    const s = t.record(7, t0 + 60_000);

    expect(s.samples).toBe(2);
    expect(s.latestGapMs).toBe(7);
    expect(s.driftPerMinute).not.toBeNull();
  });

  test("computes linear drift rate via least squares", () => {
    const t0 = 1_000_000;
    const t = new DriftTracker();

    // Gap grows exactly 3ms per minute.
    const points = [0, 1, 2, 3].map((minutes) => ({ at: t0 + minutes * 60_000, gap: 2 + minutes * 3 }));
    for (const p of points) t.record(p.gap, p.at);

    const s = t.getSnapshot();
    expect(s.latestGapMs).toBe(11);
    expect(s.driftPerMinute).not.toBeNull();
    expect(s.driftPerMinute!).toBeCloseTo(3, 1);
  });

  test("constant gap yields zero drift rate (offset error, not drift)", () => {
    const t0 = 1_000_000;
    const t = new DriftTracker();
    for (let i = 0; i < 5; i++) t.record(42, t0 + i * 30_000);

    expect(t.getSnapshot().driftPerMinute!).toBeCloseTo(0, 4);
  });

  test("window bounds old samples out of the analysis", () => {
    const t0 = 1_000_000;
    const t = new DriftTracker(3);
    t.record(0, t0); // falls out of window
    for (let i = 1; i <= 3; i++) t.record(i * 2, t0 + i * 60_000);

    const s = t.getSnapshot();
    expect(s.samples).toBe(3);
    expect(s.driftPerMinute!).toBeCloseTo(2, 1);
  });

  test("reset clears state", () => {
    const t = new DriftTracker();
    t.record(9);
    t.reset();
    expect(t.getSnapshot().samples).toBe(0);
    expect(t.getSnapshot().latestGapMs).toBeNull();
  });
});
