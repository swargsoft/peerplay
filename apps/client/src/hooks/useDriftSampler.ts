"use client";

import { sampleGapMs } from "@/lib/driftDetection";
import { useGlobalStore } from "@/store/global";
import { useEffect } from "react";

const DRIFT_SAMPLE_INTERVAL_MS = 5_000;

/**
 * Periodically measures this device's playback position against the shared
 * server timeline (roadmap Stage 12). Measures only — no correction.
 */
export const useDriftSampler = () => {
  useEffect(() => {
    const id = window.setInterval(() => {
      const state = useGlobalStore.getState();
      if (!state.isPlaying || !state.playTimelineAnchor) return;
      if (!state.isSynced) return;

      const gapMs = sampleGapMs({
        anchor: state.playTimelineAnchor,
        actualPositionSec: state.getCurrentTrackPosition(),
        nowEpochMs: Date.now(),
        clockOffsetMs: state.offsetEstimate,
      });

      state.recordDriftSample(gapMs);

      if (Math.abs(gapMs) > 50) {
        console.warn(`[Drift] gap=${gapMs.toFixed(1)}ms vs server timeline`);
      }
    }, DRIFT_SAMPLE_INTERVAL_MS);

    return () => window.clearInterval(id);
  }, []);
};
