"use client";

import { LanPairingOverlay } from "@/components/lan/LanPairingOverlay";
import { P2PRoomSession } from "@/components/room/P2PRoomSession";
import { LanWebRTCTransport } from "@/p2p/transport";
import { useP2PConnectionStore } from "@/store/p2pConnection";
import { useCallback, useRef } from "react";

interface LanManagerProps {
  roomId: string;
  username: string;
}

/** Local Wi-Fi mode session: PeerTransport backed by raw WebRTC over the LAN. */
export const LanManager = ({ roomId, username }: LanManagerProps) => {
  const transportRef = useRef<LanWebRTCTransport | null>(null);
  const connectedPeerIds = useP2PConnectionStore((state) => state.connectedPeerIds);

  const connect = useCallback(() => {
    const transport = new LanWebRTCTransport();
    transportRef.current = transport;
    return { transport };
  }, []);

  return (
    <>
      <P2PRoomSession roomId={roomId} username={username} connect={connect} />
      {connectedPeerIds.length <= 1 && (
        <LanPairingOverlay getTransport={() => transportRef.current} />
      )}
    </>
  );
};
