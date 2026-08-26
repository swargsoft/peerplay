"use client";

import { LanQr } from "@/components/lan/LanQr";
import { QrScanner } from "@/components/lan/QrScanner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createLanWebRTCTransport, type LanWebRTCTransport } from "@/p2p/transport";
import { runLanSelfTest, type LanSelfTestResult } from "@/p2p/transport/lan/selfTest";
import { ScanLine, FlaskConical } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type Role = "host" | "peer" | null;
type Status = "idle" | "gathering" | "waiting" | "connected";
type ScannerTarget = "offer" | "answer" | null;

const DEBUG_CHANNEL = "lan-debug";

interface LogEntry {
  from: "me" | "peer" | "system";
  text: string;
  at: number;
}

export const LanPairing = () => {
  const [role, setRole] = useState<Role>(null);
  const [status, setStatus] = useState<Status>("idle");

  const [offerSignal, setOfferSignal] = useState("");
  const [answerSignalInput, setAnswerSignalInput] = useState("");
  const [incomingSignal, setIncomingSignal] = useState("");
  const [answerSignal, setAnswerSignal] = useState("");

  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [scannerOpen, setScannerOpen] = useState<ScannerTarget>(null);
  const [showOfferText, setShowOfferText] = useState(false);
  const [showAnswerText, setShowAnswerText] = useState(false);
  const [selfTestRunning, setSelfTestRunning] = useState(false);
  const [selfTestResult, setSelfTestResult] = useState<LanSelfTestResult | null>(null);

  const transportRef = useRef<LanWebRTCTransport | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((from: LogEntry["from"], text: string) => {
    setLog((prev) => [...prev.slice(-50), { from, text, at: Date.now() }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [log]);

  const getTransport = useCallback((): LanWebRTCTransport => {
    if (transportRef.current) return transportRef.current;
    const transport = createLanWebRTCTransport();

    const [sendDebug, receiveDebug] = transport.makeAction<string>(DEBUG_CHANNEL);
    receiveDebug((text) => {
      addLog("peer", text);
      // Echo back so the other side can verify round-trip delivery.
      if (!text.startsWith("echo: ")) void sendDebug(`echo: ${text}`);
    });

    transport.onPeerJoin((peerId) => {
      setRemotePeerId(peerId);
      setStatus("connected");
      addLog("system", `Connected to peer ${peerId}`);
    });

    transport.onPeerLeave((peerId) => {
      setRemotePeerId(null);
      setStatus((current) => (current === "connected" ? "waiting" : current));
      addLog("system", `Peer ${peerId} disconnected`);
    });

    transportRef.current = transport;
    return transport;
  }, [addLog]);

  useEffect(() => {
    return () => {
      void transportRef.current?.leave();
      transportRef.current = null;
    };
  }, []);

  // ---- Host flow ---------------------------------------------------------------

  const handleCreateOffer = async () => {
    try {
      setStatus("gathering");
      const transport = getTransport();
      const signal = await transport.createOfferSignal();
      setOfferSignal(signal);
      setStatus("waiting");
    } catch (err) {
      console.error(err);
      toast.error("Failed to create offer");
      setStatus("idle");
    }
  };

  const handleAcceptAnswer = async () => {
    const transport = getTransport();
    try {
      const peerId = await transport.acceptAnswerSignal(answerSignalInput.trim());
      addLog("system", `Answer accepted — completing connection with ${peerId}`);
      setAnswerSignalInput("");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Invalid answer payload");
    }
  };

  /** Same as handleAcceptAnswer but with an explicit payload (e.g. from QR scan). */
  const handleAcceptAnswerWith = async (payload: string) => {
    const transport = getTransport();
    try {
      const peerId = await transport.acceptAnswerSignal(payload.trim());
      addLog("system", `Answer scanned — completing connection with ${peerId}`);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Scanned answer is not a valid payload");
    }
  };

  // ---- Peer flow ---------------------------------------------------------------

  const handleAcceptOffer = async () => {
    try {
      setStatus("gathering");
      const transport = getTransport();
      const answer = await transport.acceptOfferSignal(incomingSignal.trim());
      setAnswerSignal(answer);
      setStatus("waiting");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Invalid offer payload");
      setStatus("idle");
    }
  };

  /** Same as handleAcceptOffer but with an explicit payload (e.g. from QR scan). */
  const handleAcceptOfferWith = async (payload: string) => {
    try {
      setStatus("gathering");
      const transport = getTransport();
      const answer = await transport.acceptOfferSignal(payload.trim());
      setAnswerSignal(answer);
      setStatus("waiting");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Scanned offer is not a valid payload");
      setStatus("idle");
    }
  };

  // ---- Shared -------------------------------------------------------------------

  const handleSendDebugMessage = () => {
    const transport = transportRef.current;
    const text = draft.trim();
    if (!transport || !remotePeerId || !text) return;

    void transport.makeAction<string>(DEBUG_CHANNEL)[0](text, remotePeerId);
    addLog("me", text);
    setDraft("");
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  const reset = async () => {
    await transportRef.current?.leave();
    transportRef.current = null;
    setRole(null);
    setStatus("idle");
    setOfferSignal("");
    setAnswerSignalInput("");
    setIncomingSignal("");
    setAnswerSignal("");
    setRemotePeerId(null);
    setLog([]);
    setScannerOpen(null);
    setShowOfferText(false);
    setShowAnswerText(false);
  };

  const statusLabel: Record<Status, string> = {
    idle: "Idle",
    gathering: "Gathering ICE candidates…",
    waiting: role === "host" ? "Waiting for answer…" : "Waiting for host to complete…",
    connected: "Connected",
  };

  return (
    <div className="w-full px-4 max-w-[32rem] mx-auto mt-16 lg:mt-20 mb-20">
      <div className="flex flex-col items-center p-6 bg-neutral-900 rounded-lg border border-neutral-800 shadow-xl">
        <h1 className="text-base font-medium tracking-tight text-white">Local Wi-Fi Pairing</h1>
        <p className="text-neutral-400 mt-1 mb-5 text-center text-xs leading-relaxed">
          Direct device-to-device WebRTC on the same network. No internet required.
          Exchange the two payloads with your peer out-of-band.
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
          <span className="text-neutral-300">{statusLabel[status]}</span>
          {remotePeerId && <span className="text-neutral-500">· peer {remotePeerId.slice(0, 8)}</span>}
        </div>

        {!role && (
          <div className="w-full flex flex-col gap-3">
            <Button onClick={() => setRole("host")} className="w-full rounded-full" size="lg">
              Host a room
            </Button>
            <Button onClick={() => setRole("peer")} variant="secondary" className="w-full rounded-full" size="lg">
              Join as peer
            </Button>

            {/* Offline acceptance self-test (roadmap Stage 13) */}
            <div className="mt-2 pt-3 border-t border-neutral-800 w-full flex flex-col items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-neutral-500 hover:text-neutral-300"
                disabled={selfTestRunning}
                onClick={async () => {
                  setSelfTestRunning(true);
                  setSelfTestResult(null);
                  try {
                    setSelfTestResult(await runLanSelfTest());
                  } finally {
                    setSelfTestRunning(false);
                  }
                }}
              >
                <FlaskConical size={13} className="mr-1.5" />
                {selfTestRunning ? "Running offline self-test…" : "Run offline self-test"}
              </Button>
              {selfTestResult && (
                <div className="w-full font-mono text-[10px] bg-neutral-950/60 rounded-md border border-neutral-800 p-2 space-y-0.5">
                  <SelfTestRow label="signal exchange" ok={selfTestResult.signalingOk} />
                  <SelfTestRow label="webrtc connected" ok={selfTestResult.connected} />
                  <SelfTestRow
                    label="text round-trip"
                    ok={selfTestResult.textRoundTripMs !== null}
                    detail={selfTestResult.textRoundTripMs !== null ? `${selfTestResult.textRoundTripMs}ms` : undefined}
                  />
                  <SelfTestRow
                    label="chunked binary"
                    ok={selfTestResult.chunksOk}
                    detail={
                      selfTestResult.binaryRoundTripMs !== null ? `${selfTestResult.binaryRoundTripMs}ms` : undefined
                    }
                  />
                  {selfTestResult.error && (
                    <div className="text-red-400 pt-1">error: {selfTestResult.error}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {role === "host" && (
          <div className="w-full flex flex-col gap-4">
            <section className="w-full">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-neutral-200">1. Show this offer to your peer</p>
                {offerSignal && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleCopy(offerSignal, "Offer")}
                  >
                    Copy
                  </Button>
                )}
              </div>
              {!offerSignal ? (
                <Button onClick={handleCreateOffer} disabled={status !== "idle"} className="w-full" size="sm">
                  Create offer
                </Button>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <LanQr payload={offerSignal} label="Peer scans this" />
                  <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setShowOfferText((v) => !v)}>
                    {showOfferText ? "Hide text" : "Show text fallback"}
                  </Button>
                  {showOfferText && (
                    <Textarea readOnly value={offerSignal} className="min-h-24 font-mono text-[10px]" />
                  )}
                </div>
              )}
            </section>

            {!scannerOpen && (
              <section className="w-full">
                <p className="text-xs font-medium text-neutral-200 mb-1.5">2. Get the peer&apos;s answer</p>
                <Button
                  onClick={() => setScannerOpen("answer")}
                  className="w-full"
                  size="sm"
                  variant="secondary"
                  disabled={!offerSignal || status === "connected"}
                >
                  <ScanLine size={14} className="mr-1.5" /> Scan answer QR
                </Button>
                <details className="mt-2 text-xs text-neutral-500">
                  <summary className="cursor-pointer select-none hover:text-neutral-300 transition-colors">
                    Or paste it manually
                  </summary>
                  <Textarea
                    value={answerSignalInput}
                    onChange={(e) => setAnswerSignalInput(e.target.value)}
                    placeholder="Paste the answer payload here…"
                    className="font-mono text-[10px] mt-2"
                    disabled={status === "connected"}
                  />
                  <Button
                    onClick={handleAcceptAnswer}
                    className="w-full mt-2"
                    size="sm"
                    disabled={!answerSignalInput.trim() || status === "connected"}
                  >
                    Complete connection
                  </Button>
                </details>
              </section>
            )}

            {scannerOpen === "answer" && (
              <section className="w-full">
                <QrScanner
                  onScan={(payload) => {
                    setScannerOpen(null);
                    setAnswerSignalInput(payload);
                    void handleAcceptAnswerWith(payload);
                  }}
                  onClose={() => setScannerOpen(null)}
                />
              </section>
            )}

            <Button variant="ghost" size="sm" className="text-xs" onClick={() => void reset()}>
              Start over
            </Button>
          </div>
        )}

        {role === "peer" && (
          <div className="w-full flex flex-col gap-4">
            {!answerSignal && !scannerOpen && (
              <section className="w-full">
                <p className="text-xs font-medium text-neutral-200 mb-1.5">1. Get the host&apos;s offer</p>
                <Button
                  onClick={() => setScannerOpen("offer")}
                  className="w-full"
                  size="sm"
                  variant="secondary"
                >
                  <ScanLine size={14} className="mr-1.5" /> Scan offer QR
                </Button>
                <details className="mt-2 text-xs text-neutral-500">
                  <summary className="cursor-pointer select-none hover:text-neutral-300 transition-colors">
                    Or paste it manually
                  </summary>
                  <Textarea
                    value={incomingSignal}
                    onChange={(e) => setIncomingSignal(e.target.value)}
                    placeholder="Paste the offer payload here…"
                    className="font-mono text-[10px] mt-2"
                  />
                  <Button
                    onClick={handleAcceptOffer}
                    className="w-full mt-2"
                    size="sm"
                    disabled={!incomingSignal.trim()}
                  >
                    Generate answer
                  </Button>
                </details>
              </section>
            )}

            {scannerOpen === "offer" && !answerSignal && (
              <section className="w-full">
                <QrScanner
                  onScan={(payload) => {
                    setScannerOpen(null);
                    setIncomingSignal(payload);
                    void handleAcceptOfferWith(payload);
                  }}
                  onClose={() => setScannerOpen(null)}
                />
              </section>
            )}

            {answerSignal && (
              <section className="w-full">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-neutral-200">2. Show this answer to the host</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => handleCopy(answerSignal, "Answer")}
                  >
                    Copy
                  </Button>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <LanQr payload={answerSignal} label="Host scans this" />
                  <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={() => setShowAnswerText((v) => !v)}>
                    {showAnswerText ? "Hide text" : "Show text fallback"}
                  </Button>
                  {showAnswerText && (
                    <Textarea readOnly value={answerSignal} className="min-h-24 font-mono text-[10px]" />
                  )}
                </div>
              </section>
            )}

            <Button variant="ghost" size="sm" className="text-xs" onClick={() => void reset()}>
              Start over
            </Button>
          </div>
        )}

        {role && remotePeerId && (
          <div className="w-full mt-6 pt-4 border-t border-neutral-800">
            <p className="text-xs font-medium text-neutral-200 mb-2">Transport test</p>
            <div className="flex flex-col max-h-40 overflow-y-auto bg-neutral-950/60 rounded-md border border-neutral-800 p-2 gap-1 mb-2">
              {log.length === 0 ? (
                <span className="text-[11px] text-neutral-600">No messages yet.</span>
              ) : (
                log.map((entry, i) => (
                  <span key={i} className="text-[11px] leading-snug">
                    <span
                      className={
                        entry.from === "me"
                          ? "text-primary"
                          : entry.from === "peer"
                            ? "text-green-400"
                            : "text-neutral-500"
                      }
                    >
                      {entry.from === "system" ? "· " : `${entry.from}: `}
                    </span>
                    <span className="text-neutral-300 break-all">{entry.text}</span>
                  </span>
                ))
              )}
              <div ref={logEndRef} />
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendDebugMessage();
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Send a test message…"
                className="flex-1 h-8 rounded-md border border-neutral-700 bg-neutral-800/80 px-2.5 text-xs text-white outline-none focus:border-primary/70"
              />
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                Send
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

const SelfTestRow = ({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) => (
  <div className="flex justify-between">
    <span className={ok ? "text-green-500" : "text-red-400"}>{ok ? "✓" : "✗"}</span>
    <span className="flex-1 pl-2 text-neutral-400">{label}</span>
    {detail && <span className="text-neutral-300">{detail}</span>}
  </div>
);
