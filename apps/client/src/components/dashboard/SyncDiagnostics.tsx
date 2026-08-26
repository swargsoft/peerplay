"use client";

import { getConnectionMode } from "@/lib/connectionMode";
import { IS_DEMO_MODE } from "@/lib/demo";
import { useGlobalStore } from "@/store/global";
import { useP2PConnectionStore } from "@/store/p2pConnection";
import { ChevronDown, Activity } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

/**
 * Live synchronization readout (roadmap Stage 11): transport, clock health,
 * probe purity, and scheduled-vs-actual playback start error.
 */
export const SyncDiagnostics = () => {
  const [open, setOpen] = useState(false);

  const offsetEstimate = useGlobalStore((state) => state.offsetEstimate);
  const roundTripEstimate = useGlobalStore((state) => state.roundTripEstimate);
  const isSynced = useGlobalStore((state) => state.isSynced);
  const probeStats = useGlobalStore((state) => state.probeStats);
  const scheduleAccuracy = useGlobalStore((state) => state.scheduleAccuracy);
  const driftStats = useGlobalStore((state) => state.driftStats);
  const connectedPeerIds = useP2PConnectionStore((state) => state.connectedPeerIds.length);

  const transport = IS_DEMO_MODE ? "demo" : getConnectionMode() === "lan" ? "Local Wi-Fi" : "Internet P2P";
  const totalPairs = probeStats.pureCount + probeStats.impureCount;
  const pureRate = totalPairs > 0 ? Math.round((probeStats.pureCount / totalPairs) * 100) : null;

  return (
    <div className="px-3.5 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-[11px] font-medium text-neutral-400 hover:text-neutral-200 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <Activity size={13} />
          Sync diagnostics
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${isSynced ? "bg-green-500" : "bg-yellow-500 animate-pulse"}`}
          />
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-2 font-mono text-[10px] text-neutral-500 leading-relaxed">
              <Row label="transport" value={transport} />
              <Row label="peers" value={String(connectedPeerIds)} />
              <div className="h-px bg-neutral-800 my-1.5" />
              <Row label="rtt" value={`${roundTripEstimate.toFixed(1)} ms`} />
              <Row
                label="clock offset"
                value={`${offsetEstimate >= 0 ? "+" : ""}${offsetEstimate.toFixed(1)} ms`}
              />
              <Row
                label="probe purity"
                value={pureRate === null ? "—" : `${pureRate}% (${probeStats.pureCount}/${totalPairs})`}
              />
              <div className="h-px bg-neutral-800 my-1.5" />
              <Row
                label="sched vs actual"
                value={
                  scheduleAccuracy.lastErrorMs === null
                    ? "—"
                    : `${scheduleAccuracy.lastErrorMs >= 0 ? "+" : ""}${scheduleAccuracy.lastErrorMs.toFixed(1)} ms`
                }
                highlight={
                  scheduleAccuracy.lastErrorMs !== null && scheduleAccuracy.lastErrorMs > 0
                    ? "warn"
                    : "ok"
                }
              />
              <Row label="mean |error|" value={`${scheduleAccuracy.meanAbsErrorMs.toFixed(1)} ms`} />
              <Row label="late starts" value={`${scheduleAccuracy.lateStarts} / ${scheduleAccuracy.samples}`} />
              <div className="h-px bg-neutral-800 my-1.5" />
              <Row
                label="drift gap"
                value={
                  driftStats.latestGapMs === null
                    ? "—"
                    : `${driftStats.latestGapMs >= 0 ? "+" : ""}${driftStats.latestGapMs.toFixed(1)} ms`
                }
              />
              <Row
                label="drift rate"
                value={
                  driftStats.driftPerMinute === null
                    ? "—"
                    : `${driftStats.driftPerMinute >= 0 ? "+" : ""}${driftStats.driftPerMinute.toFixed(1)} ms/min`
                }
                highlight={
                  driftStats.driftPerMinute !== null && Math.abs(driftStats.driftPerMinute) > 10
                    ? "warn"
                    : driftStats.driftPerMinute !== null
                      ? "ok"
                      : undefined
                }
              />
              <Row label="drift samples" value={String(driftStats.samples)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Row = ({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "ok" | "warn";
}) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span
      className={
        highlight === "warn" ? "text-yellow-500" : highlight === "ok" ? "text-green-500" : "text-neutral-400"
      }
    >
      {value}
    </span>
  </div>
);

