import type { P2PEnvelope } from "@pearplay/shared";

/**
 * A named, ordered data channel (mirrors Trystero's makeAction).
 * `metadata` carries per-message auxiliary data (e.g. track transfer meta).
 */
export type TransportAction<T> = [
  send: (data: T, targetPeerId?: string | null, metadata?: unknown) => Promise<void>,
  receive: (handler: (data: T, fromPeerId: string, metadata?: unknown) => void) => void,
];

/**
 * Minimal transport abstraction for P2P room communication.
 *
 * Concrete implementations: TrysteroTransport (internet), LanWebRTCTransport (LAN).
 * Everything above the transport (room coordinator, sync, audio transfer,
 * voice chat) must depend only on this interface — no Trystero imports.
 */
export interface PeerTransport {
  /** Stable local peer identifier (unique within the room). */
  readonly selfId: string;

  /** Notify transport that we're leaving. Does NOT emit onPeerLeave callbacks. */
  leave(): Promise<void>;

  /** Register handler for new remote peers. */
  onPeerJoin(handler: (peerId: string) => void): void;

  /** Register handler for disconnected peers. */
  onPeerLeave(handler: (peerId: string) => void): void;

  /** Send an envelope to all connected peers. */
  sendEnvelope(envelope: P2PEnvelope): void;

  /** Send an envelope to a specific peer. */
  sendEnvelopeTo(envelope: P2PEnvelope, targetPeerId: string): void;

  /** Register handler for incoming envelopes. */
  onEnvelope(handler: (envelope: P2PEnvelope) => void): void;

  /**
   * Create or look up a named binary/JSON data channel.
   * The same name always yields the same channel for a given transport.
   */
  makeAction<T>(name: string): TransportAction<T>;

  /** Register handler for incoming media streams from a peer. */
  onPeerStream(handler: (stream: MediaStream, peerId: string, metadata?: unknown) => void): void;

  /** Send a local media stream to a specific peer, or to all when targetPeerId is null. */
  addStream(stream: MediaStream, targetPeerId?: string | null, metadata?: unknown): void;

  /** Stop sending a previously added local media stream. */
  removeStream(stream: MediaStream): void;
}
