import { describe, expect, test } from "bun:test";
import { ScheduleAccuracyTracker } from "@/lib/syncDiagnostics";

describe("ScheduleAccuracyTracker", () => {
  test("starts empty", () => {
    const t = new ScheduleAccuracyTracker();
    const s = t.getSnapshot();
    expect(s.lastErrorMs).toBeNull();
    expect(s.samples).toBe(0);
    expect(s.lateStarts).toBe(0);
    expect(s.meanAbsErrorMs).toBe(0);
  });

  test("records last error and mean absolute error", () => {
    const t = new ScheduleAccuracyTracker();
    t.record(-5); // armed 5ms early
    const s = t.record(2.5); // started 2.5ms late

    expect(s.lastErrorMs).toBeCloseTo(2.5);
    expect(s.samples).toBe(2);
    // mean(|−5|, |2.5|) = 3.75
    expect(s.meanAbsErrorMs).toBeCloseTo(3.75);
  });

  test("counts late starts only for positive errors", () => {
    const t = new ScheduleAccuracyTracker();
    t.record(-1);
    t.record(0);
    t.record(4);
    t.record(-2);
    t.record(9);

    const s = t.getSnapshot();
    expect(s.samples).toBe(5);
    expect(s.lateStarts).toBe(2);
  });

  test("rolling window bounds the average", () => {
    const t = new ScheduleAccuracyTracker(3);
    for (const e of [100, 100, 100, -6, -6]) t.record(e);

    const s = t.getSnapshot();
    // Window holds the last 3 samples: [100, -6, -6] → mean abs = 112/3
    expect(s.meanAbsErrorMs).toBeCloseTo(112 / 3);
    expect(s.samples).toBe(5); // total count is preserved
  });

  test("reset clears everything", () => {
    const t = new ScheduleAccuracyTracker();
    t.record(12);
    t.reset();
    const s = t.getSnapshot();
    expect(s.lastErrorMs).toBeNull();
    expect(s.samples).toBe(0);
    expect(s.meanAbsErrorMs).toBe(0);
  });
});
