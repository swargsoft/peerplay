import { IS_P2P_MODE } from "@/lib/p2p";
import { ClientActionEnum, epochNow, NTP_CONSTANTS } from "@pearplay/shared";
import { sendWSRequest } from "./ws";

// ── Types ──────────────────────────────────────────────────────────

export interface NTPMeasurement {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  roundTripDelay: number;
  clockOffset: number;
}

// ── Probe pair sending ─────────────────────────────────────────────

let probeGroupCounter = 0;
let pendingFirstProbe: NTPMeasurement | null = null;
let pendingFirstProbeGroupId: number | null = null;
let pureCount = 0;
let impureCount = 0;

/** Reset probe state (call on connection reset) */
export const resetProbeState = () => {
  probeGroupCounter = 0;
  pendingFirstProbe = null;
  pendingFirstProbeGroupId = null;
  pureCount = 0;
  impureCount = 0;
};

/** Get probe pair stats for debugging */
export const getProbeStats = () => ({
  totalPairs: pureCount + impureCount,
  pureCount,
  impureCount,
  totalSent: probeGroupCounter,
});

/**
 * Send a coded probe pair (Huygens). Two NTP requests sent with a known
 * inter-departure gap. The client later validates that the server-side
 * inter-arrival gap matches, filtering out measurements corrupted by
 * queuing, TCP HOL blocking, or GC pauses.
 */
export const sendProbePair = (data: {
  ws: WebSocket;
  currentRTT: number | undefined;
  compensationMs: number | undefined;
  nudgeMs: number | undefined;
}) => {
  const { ws, currentRTT, compensationMs, nudgeMs } = data;
  if (!IS_P2P_MODE && ws.readyState !== WebSocket.OPEN) {
    throw new Error("Cannot send NTP request: WebSocket is not open");
  }

  const probeGroupId = probeGroupCounter++;

  // First probe — sent immediately
  sendWSRequest({
    ws,
    request: {
      type: ClientActionEnum.enum.NTP_REQUEST,
      t0: epochNow(),
      clientRTT: currentRTT,
      clientCompensationMs: compensationMs,
      clientNudgeMs: nudgeMs,
      probeGroupId,
      probeGroupIndex: 0,
    },
  });

  // Second probe — sent after PROBE_GAP_MS
  setTimeout(() => {
    if (!IS_P2P_MODE && ws.readyState !== WebSocket.OPEN) return;
    sendWSRequest({
      ws,
      request: {
        type: ClientActionEnum.enum.NTP_REQUEST,
        t0: epochNow(),
        clientRTT: currentRTT,
        clientCompensationMs: compensationMs,
        clientNudgeMs: nudgeMs,
        probeGroupId,
        probeGroupIndex: 1,
      },
    });
  }, NTP_CONSTANTS.PROBE_GAP_MS);
};

// ── Probe pair collection ──────────────────────────────────────────

/**
 * Feed an individual probe response into the pair validator.
 *
 * Buffers the first probe (index 0). When the second probe (index 1)
 * arrives, validates gap purity and returns the best measurement
 * (lowest RTT) from the pair. Returns null if still waiting for the
 * second probe, the pair was impure, or the group ID didn't match.
 */
export const validateProbePair = (data: {
  measurement: NTPMeasurement;
  probeGroupId: number;
  probeGroupIndex: number;
}): NTPMeasurement | null => {
  const { measurement, probeGroupId, probeGroupIndex } = data;

  if (probeGroupIndex === 0) {
    pendingFirstProbe = measurement;
    pendingFirstProbeGroupId = probeGroupId;
    return null;
  }

  // probeGroupIndex === 1: try to complete the pair
  const first = pendingFirstProbe;
  const firstGroupId = pendingFirstProbeGroupId;

  if (!first || firstGroupId !== probeGroupId) {
    return null;
  }

  // Clear pending state
  pendingFirstProbe = null;
  pendingFirstProbeGroupId = null;

  // Validate gap purity: compare server inter-arrival gap against client inter-departure gap
  const clientGap = measurement.t0 - first.t0;
  const serverGap = measurement.t1 - first.t1;
  const gapDrift = Math.abs(serverGap - clientGap);
  const isPure = gapDrift <= NTP_CONSTANTS.PROBE_GAP_TOLERANCE_MS;

  if (isPure) {
    pureCount++;
  } else {
    impureCount++;
  }

  const total = pureCount + impureCount;
  const pureRate = total > 0 ? ((pureCount / total) * 100).toFixed(0) : "0";
  const significantDrift = gapDrift > NTP_CONSTANTS.PROBE_GAP_TOLERANCE_MS;

  if (!isPure || significantDrift) {
    const label = isPure ? "DRIFT" : "IMPURE";
    console.warn(
      `[NTP] ${label} probe #${probeGroupId} | clientGap=${clientGap.toFixed(1)}ms serverGap=${serverGap.toFixed(1)}ms drift=${gapDrift.toFixed(1)}ms | pure: ${pureCount}/${total} (${pureRate}%)`
    );
    if (!isPure) return null;
  }

  const best = first.roundTripDelay <= measurement.roundTripDelay ? first : measurement;

  return best;
};

// ── Offset estimation ──────────────────────────────────────────────

/** Samples within this fraction of the min RTT count as "near-best". */
const BEST_CLUSTER_RELATIVE_TOLERANCE = 0.1;
/** Absolute floor for the cluster margin (helps when min RTT is tiny). */
const BEST_CLUSTER_ABSOLUTE_TOLERANCE_MS = 5;

/**
 * Estimate clock offset using best-cluster averaging over min-RTT samples.
 *
 * Queuing delays can only ADD to RTT, never subtract. So the lowest-RTT
 * measurements are closest to the true propagation delay (RFC 5905 §10).
 * Rather than trusting the single best sample — whose offset still carries
 * some noise — we average offsets across all samples whose RTT sits within a
 * small margin of the minimum. These near-best samples are almost free of
 * asymmetric queuing contamination, so averaging them reduces estimator
 * variance without admitting corrupted samples.
 */
export const calculateOffsetEstimate = (measurements: NTPMeasurement[]) => {
  if (measurements.length === 0) return { averageOffset: 0, averageRoundTrip: 0 };

  let minRTT = Infinity;
  let totalRoundTrip = 0;
  for (const m of measurements) {
    totalRoundTrip += m.roundTripDelay;
    if (m.roundTripDelay < minRTT) minRTT = m.roundTripDelay;
  }
  const averageRoundTrip = totalRoundTrip / measurements.length;

  const clusterThreshold =
    minRTT + Math.max(minRTT * BEST_CLUSTER_RELATIVE_TOLERANCE, BEST_CLUSTER_ABSOLUTE_TOLERANCE_MS);

  let offsetSum = 0;
  let clusterSize = 0;
  for (const m of measurements) {
    if (m.roundTripDelay <= clusterThreshold) {
      offsetSum += m.clockOffset;
      clusterSize++;
    }
  }

  const averageOffset = offsetSum / clusterSize;

  return { averageOffset, averageRoundTrip };
};

export const calculateWaitTimeMilliseconds = (targetServerTime: number, clockOffset: number): number => {
  const estimatedCurrentServerTime = epochNow() + clockOffset;
  return Math.max(0, targetServerTime - estimatedCurrentServerTime);
};
