"use client";
import { generateName } from "@/lib/randomNames";
import { getConnectionMode, type ConnectionMode } from "@/lib/connectionMode";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useRoomStore } from "@/store/room";
import { motion } from "motion/react";
import { useEffect, useSyncExternalStore } from "react";
import { IS_DEMO_MODE } from "@/lib/demo";
import { Dashboard } from "./dashboard/Dashboard";
import { DemoDashboard } from "./dashboard/DemoDashboard";
import { LanManager } from "./room/LanManager";
import { TrysteroManager } from "./room/TrysteroManager";

interface NewSyncerProps {
  roomId: string;
}

const subscribeNoop = () => () => {};

export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);

  // sessionStorage is unavailable during SSR — resolve after hydration.
  // The mode cannot change while the room is mounted, so no live subscription.
  const mode = useSyncExternalStore(
    subscribeNoop,
    getConnectionMode,
    () => "internet" as ConnectionMode
  );

  useDocumentTitle();

  useEffect(() => {
    setRoomId(roomId);
    if (!username) {
      setUsername(generateName());
    }
  }, [setUsername, username, roomId, setRoomId]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {IS_DEMO_MODE ? null : mode === "lan" ? (
        <LanManager roomId={roomId} username={username} />
      ) : (
        <TrysteroManager roomId={roomId} username={username} />
      )}
      {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
    </motion.div>
  );
};
