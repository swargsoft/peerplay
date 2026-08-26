import type { P2PEnvelope } from "@pearplay/shared";
import { joinRoom, selfId } from "trystero";
import type { DataPayload, JsonValue, Room } from "trystero";
import { getTrysteroConfig } from "../config";
import type { PeerTransport, TransportAction } from "./types";

/**
 * PeerTransport backed by Trystero (WebRTC via public tracker relay).
 * Preserves the exact behavior of the existing Trystero integration.
 */
export class TrysteroTransport implements PeerTransport {
  readonly selfId: string;

  private readonly room: Room;
  private peerJoinHandler: ((peerId: string) => void) | null = null;
  private peerLeaveHandler: ((peerId: string) => void) | null = null;
  private peerStreamHandler: ((stream: MediaStream, peerId: string, metadata?: unknown) => void) | null = null;

  private sendAction: ((envelope: P2PEnvelope, targetPeerId?: string | null) => Promise<void>) | null = null;
  private envelopeInitialised = false;
  private registeredJoin = false;
  private registeredLeave = false;
  private registeredStream = false;
  private readonly actions = new Map<string, TransportAction<unknown>>();

  constructor(room: Room) {
    this.selfId = selfId;
    this.room = room;
  }

  onPeerJoin(handler: (peerId: string) => void): void {
    this.peerJoinHandler = handler;
    if (!this.registeredJoin) {
      this.registeredJoin = true;
      this.room.onPeerJoin((peerId) => this.peerJoinHandler?.(peerId));
    }
  }

  onPeerLeave(handler: (peerId: string) => void): void {
    this.peerLeaveHandler = handler;
    if (!this.registeredLeave) {
      this.registeredLeave = true;
      this.room.onPeerLeave((peerId) => this.peerLeaveHandler?.(peerId));
    }
  }

  onPeerStream(handler: (stream: MediaStream, peerId: string, metadata?: unknown) => void): void {
    this.peerStreamHandler = handler;
    if (!this.registeredStream) {
      this.registeredStream = true;
      this.room.onPeerStream((stream, peerId, metadata) => this.peerStreamHandler?.(stream, peerId, metadata));
    }
  }

  addStream(stream: MediaStream, targetPeerId?: string | null, metadata?: unknown): void {
    void this.room.addStream(stream, targetPeerId ?? null, metadata as JsonValue | undefined);
  }

  removeStream(stream: MediaStream): void {
    try {
      this.room.removeStream(stream);
    } catch {
      // Room may already be torn down.
    }
  }

  makeAction<T>(name: string): TransportAction<T> {
    const existing = this.actions.get(name);
    if (existing) return existing as TransportAction<T>;
    const [send, receive] = this.room.makeAction<DataPayload>(name);
    const action: TransportAction<T> = [
      async (data, targetPeerId, metadata) => {
        await send(data as DataPayload, targetPeerId ?? null, metadata as JsonValue | undefined);
      },
      (handler) => receive((data, peerId, metadata) => handler(data as T, peerId, metadata)),
    ];
    this.actions.set(name, action as TransportAction<unknown>);
    return action;
  }

  private receiveAction: ((handler: (data: P2PEnvelope, peerId: string) => void) => void) | null = null;

  /**
   * Lazily initialise the Trystero "envelope" action (both send + receive).
   * Called on first send or when onEnvelope is invoked.
   */
  private ensureEnvelopeChannel(): void {
    if (this.envelopeInitialised) return;
    this.envelopeInitialised = true;
    const [send, receive] = this.makeAction<P2PEnvelope>("envelope");
    this.sendAction = send;
    this.receiveAction = receive;
  }

  /** Register a handler for incoming envelopes. */
  onEnvelope(handler: (envelope: P2PEnvelope) => void): void {
    this.ensureEnvelopeChannel();
    this.receiveAction!((data) => handler(data));
  }

  sendEnvelope(envelope: P2PEnvelope): void {
    this.ensureEnvelopeChannel();
    void this.sendAction!(envelope, null);
  }

  sendEnvelopeTo(envelope: P2PEnvelope, targetPeerId: string): void {
    this.ensureEnvelopeChannel();
    void this.sendAction!(envelope, targetPeerId);
  }

  async leave(): Promise<void> {
    await this.room.leave();
  }
}

/**
 * Create the internet-mode transport for a Trystero room id.
 * This is the only place outside of trystero itself that joins a signaling room.
 */
export function createTrysteroTransport(trysteroRoomId: string): TrysteroTransport {
  return new TrysteroTransport(joinRoom(getTrysteroConfig(), trysteroRoomId));
}

/**
 * Force-close any cached Trystero room with the given id.
 * Used when leaving/unmounting so a rejoin gets a fresh connection
 * (Trystero caches Room instances per config+roomId).
 */
export function closeStaleTrysteroRoom(trysteroRoomId: string): void {
  void joinRoom(getTrysteroConfig(), trysteroRoomId).leave();
}
