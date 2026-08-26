"use client";

import { P2PRoomSession } from "@/components/room/P2PRoomSession";
import { toTrysteroRoomId } from "@/p2p/constants";
import { closeStaleTrysteroRoom, createTrysteroTransport } from "@/p2p/transport";
import { useCallback } from "react";

interface TrysteroManagerProps {
  roomId: string;
  username: string;
}

/** Internet-mode session: PeerTransport backed by Trystero. */
export const TrysteroManager = ({ roomId, username }: TrysteroManagerProps) => {
  const trysteroRoomId = toTrysteroRoomId(roomId);

  const connect = useCallback(() => {
    const transport = createTrysteroTransport(trysteroRoomId);
    return {
      transport,
      // Force-close the cached Trystero room on detach so a rejoin gets a
      // fresh connection (Trystero caches Room instances per config+roomId).
      cleanup: () => closeStaleTrysteroRoom(trysteroRoomId),
    };
  }, [trysteroRoomId]);

  return <P2PRoomSession roomId={roomId} username={username} connect={connect} />;
};
