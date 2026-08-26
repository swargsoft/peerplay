"use client";

import { LanQr } from "@/components/lan/LanQr";
import { QrScanner } from "@/components/lan/QrScanner";
import { Button } from "@/components/ui/button";
import { useLanPairing, type LanWebRTCTransportLike } from "@/p2p/transport/lan/useLanPairing";
import { ScanLine, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

interface LanPairingOverlayProps {
  getTransport: () => LanWebRTCTransportLike | null;
}

/**
 * Full-screen pairing gate shown while a LAN room session has no connected
 * peers. Once the WebRTC connection completes (peer join event), the overlay
 * disappears and the normal room UI takes over.
 */
export const LanPairingOverlay = ({ getTransport }: LanPairingOverlayProps) => {
  const [scannerOpen, setScannerOpen] = useState<"offer" | "answer" | null>(null);
  const { status, offerSignal, answerSignal, createOffer, acceptOffer, acceptAnswer } =
    useLanPairing(getTransport);

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        className="fixed inset-0 z-50 bg-neutral-950/95 backdrop-blur-sm flex items-center justify-center px-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="w-full max-w-[26rem] flex flex-col items-center p-6 bg-neutral-900 rounded-lg border border-neutral-800 shadow-xl">
          <div className="flex items-center gap-2 mb-1">
            <Users size={16} className="text-neutral-400" />
            <h2 className="text-base font-medium tracking-tight text-white">Pair your devices</h2>
          </div>
          <p className="text-neutral-400 mb-5 text-center text-xs leading-relaxed">
            Exchange QR codes with the other device to connect directly over Wi-Fi.
            Both of you should have this room open.
          </p>

          <div className="flex items-center gap-2 text-xs mb-4">
            <span
              className={`size-2 rounded-full ${
                status === "connected"
                  ? "bg-green-500"
                  : status === "idle"
                    ? "bg-neutral-600"
                    : "bg-yellow-500 animate-pulse"
              }`}
            />
            <span className="text-neutral-300 capitalize">{status === "gathering" ? "Preparing…" : status}</span>
          </div>

          {!offerSignal && !answerSignal && (
            <div className="w-full flex flex-col gap-3">
              <Button onClick={() => void createOffer()} className="w-full rounded-full" size="lg">
                Create invite
              </Button>
              <Button
                onClick={() => setScannerOpen("offer")}
                variant="secondary"
                className="w-full rounded-full"
                size="lg"
              >
                <ScanLine size={16} className="mr-2" /> Scan invite
              </Button>
            </div>
          )}

          {offerSignal && !answerSignal && (
            <div className="w-full flex flex-col items-center gap-3">
              <LanQr payload={offerSignal} label="Peer scans this invite" />
              {scannerOpen !== "answer" && (
                <Button
                  onClick={() => setScannerOpen("answer")}
                  variant="secondary"
                  className="w-full"
                  size="sm"
                >
                  <ScanLine size={14} className="mr-1.5" /> Scan peer&apos;s response
                </Button>
              )}
            </div>
          )}

          {scannerOpen === "answer" && offerSignal && (
            <QrScanner
              onScan={(payload) => {
                setScannerOpen(null);
                void acceptAnswer(payload);
              }}
              onClose={() => setScannerOpen(null)}
            />
          )}

          {!offerSignal && scannerOpen === "offer" && (
            <QrScanner
              onScan={(payload) => {
                setScannerOpen(null);
                void acceptOffer(payload);
              }}
              onClose={() => setScannerOpen(null)}
            />
          )}

          {answerSignal && (
            <div className="w-full flex flex-col items-center gap-3">
              <LanQr payload={answerSignal} label="Host scans this response" />
              <span className="text-[11px] text-neutral-500">Waiting for host…</span>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
