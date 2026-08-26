"use client";

import { useP2PConnectionStore } from "@/store/p2pConnection";
import { useCallback, useEffect, useRef, useState } from "react";

export type LanWebRTCTransportLike = {
  createOfferSignal(): Promise<string>;
  acceptOfferSignal(signal: string): Promise<string>;
  acceptAnswerSignal(signal: string): Promise<string>;
};

interface UseLanPairingResult {
  status: "idle" | "gathering" | "waiting" | "connected";
  offerSignal: string;
  answerSignal: string;
  createOffer: () => Promise<void>;
  acceptOffer: (payload: string) => Promise<void>;
  acceptAnswer: (payload: string) => Promise<void>;
}

/**
 * QR pairing flow for an existing LAN transport (the room session is already
 * attached — pairing just completes the WebRTC connection).
 */
export function useLanPairing(getTransport: () => LanWebRTCTransportLike | null): UseLanPairingResult {
  const [status, setStatus] = useState<UseLanPairingResult["status"]>("idle");
  const [offerSignal, setOfferSignal] = useState("");
  const [answerSignal, setAnswerSignal] = useState("");
  const connectedPeerIds = useP2PConnectionStore((state) => state.connectedPeerIds);

  const hasPeers = connectedPeerIds.length > 1;
  useEffect(() => {
    if (hasPeers) setStatus("connected");
    else setStatus((current) => (current === "connected" ? "waiting" : current));
  }, [hasPeers]);

  const creatingRef = useRef(false);

  const createOffer = useCallback(async () => {
    const transport = getTransport();
    if (!transport || creatingRef.current || offerSignal) return;
    creatingRef.current = true;
    try {
      setStatus("gathering");
      const signal = await transport.createOfferSignal();
      setOfferSignal(signal);
      setStatus("waiting");
    } catch (err) {
      console.error("[LAN] Failed to create offer", err);
      setStatus("idle");
    } finally {
      creatingRef.current = false;
    }
  }, [getTransport, offerSignal]);

  const acceptOffer = useCallback(
    async (payload: string) => {
      const transport = getTransport();
      if (!transport || answerSignal) return;
      try {
        setStatus("gathering");
        const answer = await transport.acceptOfferSignal(payload.trim());
        setAnswerSignal(answer);
        setStatus("waiting");
      } catch (err) {
        console.error("[LAN] Invalid scanned offer", err);
        setStatus("idle");
      }
    },
    [getTransport, answerSignal]
  );

  const acceptAnswer = useCallback(
    async (payload: string) => {
      const transport = getTransport();
      if (!transport) return;
      try {
        await transport.acceptAnswerSignal(payload.trim());
      } catch (err) {
        console.error("[LAN] Invalid scanned answer", err);
      }
    },
    [getTransport]
  );

  return { status, offerSignal, answerSignal, createOffer, acceptOffer, acceptAnswer };
}
