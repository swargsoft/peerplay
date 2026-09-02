import type { P2PEnvelope } from "@pearplay/shared";
import { nanoid } from "nanoid";
import type { PeerTransport, TransportAction } from "../types";
import {
  CHUNK_META_KEY,
  ChunkAssembler,
  LAN_BUFFER_HIGH_WATER,
  LAN_CHUNK_SIZE,
  splitPayload,
  type ChunkCoordinates,
} from "./chunking";
import { actionId, decodeBinaryFrame, decodeTextFrame, encodeBinaryFrame, encodeTextFrame, isJsonable } from "./wire";

const CONTROL_CHANNEL_LABEL = "peerplay-lan-v1";
const ICE_GATHER_TIMEOUT_MS = 2_000;

/**
 * Stable local identity for the lifetime of this tab/session.
 * Peers address each other by this id (Trystero provides its own selfId;
 * here we mint an equivalent one locally).
 */
const LAN_SELF_ID = nanoid();

/** Signaling payload exchanged out-of-band (manual copy/paste now, QR later). */
export interface LanSignal {
  v: 1;
  from: string;
  sdp: RTCSessionDescriptionInit;
}

interface StreamSenderEntry {
  stream: MediaStream;
  senders: RTCRtpSender[];
}

type ReceiveHandler = (data: unknown, peerId: string, metadata?: unknown) => void;

/** Metadata attached to chunk frames; original metadata rides alongside. */
type ChunkedMeta = Record<string, unknown> & { [CHUNK_META_KEY]?: ChunkCoordinates };

/** One RTCPeerConnection to one remote peer, plus its single multiplexed channel. */
class RemoteLanPeer {
  readonly pc: RTCPeerConnection;
  remoteId: string | null;
  channel: RTCDataChannel | null = null;
  /** Cached stream metadata announced over the data channel (voice chat filters on it). */
  readonly streamMeta = new Map<string, unknown>();
  /** MediaStreams already announced via onPeerStream, grouped by stream id. */
  readonly remoteStreams = new Map<string, MediaStream>();
  readonly localSenders = new Set<StreamSenderEntry>();
  /** Partial binary transfers in flight from this peer. */
  readonly assembler = new ChunkAssembler();

  constructor(pc: RTCPeerConnection, remoteId: string | null) {
    this.pc = pc;
    this.remoteId = remoteId;
  }
}

/**
 * PeerTransport over raw WebRTC for devices on the same LAN.
 * No STUN/TURN/Trystero/backend/signaling server — SDP offers/answers are
 * produced/consumed directly so they can be exchanged manually or via QR.
 */
export class LanWebRTCTransport implements PeerTransport {
  readonly selfId = LAN_SELF_ID;

  private readonly peers = new Set<RemoteLanPeer>();
  private readonly actions = new Map<number, TransportAction<unknown>>();
  private readonly receiveHandlers = new Map<number, ReceiveHandler>();

  private peerJoinHandler: ((peerId: string) => void) | null = null;
  private peerLeaveHandler: ((peerId: string) => void) | null = null;
  private peerStreamHandler: ((stream: MediaStream, peerId: string, metadata?: unknown) => void) | null = null;

  private closed = false;

  // ---- PeerTransport: lifecycle -------------------------------------------------

  async leave(): Promise<void> {
    this.closed = true;
    for (const peer of [...this.peers]) {
      this.teardownPeer(peer);
    }
    this.peers.clear();
    this.receiveHandlers.clear();
  }

  onPeerJoin(handler: (peerId: string) => void): void {
    this.peerJoinHandler = handler;
  }

  onPeerLeave(handler: (peerId: string) => void): void {
    this.peerLeaveHandler = handler;
  }

  onPeerStream(handler: (stream: MediaStream, peerId: string, metadata?: unknown) => void): void {
    this.peerStreamHandler = handler;
  }

  // ---- PeerTransport: envelopes -------------------------------------------------

  sendEnvelope(envelope: P2PEnvelope): void {
    void this.deliver(actionId("envelope"), envelope);
  }

  sendEnvelopeTo(envelope: P2PEnvelope, targetPeerId: string): void {
    void this.deliver(actionId("envelope"), envelope, undefined, targetPeerId);
  }

  onEnvelope(handler: (envelope: P2PEnvelope) => void): void {
    const [, receive] = this.makeAction<P2PEnvelope>("envelope");
    receive((envelope) => handler(envelope));
  }

  // ---- PeerTransport: named data channels --------------------------------------

  makeAction<T>(name: string): TransportAction<T> {
    const id = actionId(name);
    let action = this.actions.get(id);
    if (!action) {
      action = [
        async (data, targetPeerId, metadata) => {
          await this.deliver(id, data, metadata, targetPeerId ?? null);
        },
        (handler) => {
          this.receiveHandlers.set(id, handler as ReceiveHandler);
        },
      ];
      this.actions.set(id, action);
    }
    return action as TransportAction<T>;
  }

  // ---- PeerTransport: media streams --------------------------------------------

  addStream(stream: MediaStream, targetPeerId?: string | null, metadata?: unknown): void {
    for (const peer of this.targets(targetPeerId ?? null)) {
      if (!this.isOpen(peer)) continue;

      const senders = stream.getTracks().map((track) => peer.pc.addTrack(track, stream));
      peer.localSenders.add({ stream, senders });

      // Announce metadata over the data channel (WebRTC cannot carry it inline).
      this.sendControl(peer, { c: "stream-meta", sid: stream.id, m: metadata });
    }
  }

  removeStream(stream: MediaStream): void {
    const trackIds = new Set(stream.getTracks().map((t) => t.id));
    for (const peer of this.peers) {
      for (const entry of [...peer.localSenders]) {
        if (entry.stream !== stream) continue;
        for (const sender of entry.senders) {
          if (sender.track && trackIds.has(sender.track.id)) {
            try {
              peer.pc.removeTrack(sender);
            } catch {
              // Peer connection may already be tearing down.
            }
          }
        }
        peer.localSenders.delete(entry);
      }
    }
  }

  // ---- Signaling (consumed by manual pairing UI / QR in later stages) ----------

  /**
   * Offerer role: create a peer connection, produce an SDP offer signal to
   * share with the answering peer (copy/paste or QR).
   */
  async createOfferSignal(): Promise<string> {
    const peer = this.createPeer(null);

    const channel = peer.pc.createDataChannel(CONTROL_CHANNEL_LABEL, { ordered: true });
    this.bindChannel(peer, channel);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await this.waitIceGathering(peer.pc);

    return this.encodeSignal({ v: 1, from: this.selfId, sdp: peer.pc.localDescription!.toJSON() });
  }

  /**
   * Answerer role: consume the offer signal, produce an answer signal to
   * share back with the offering peer.
   */
  async acceptOfferSignal(signalJson: string): Promise<string> {
    const signal = this.decodeSignal(signalJson);
    const peer = this.createPeer(signal.from);

    peer.pc.ondatachannel = (event) => {
      this.bindChannel(peer, event.channel);
    };

    await peer.pc.setRemoteDescription(signal.sdp);
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await this.waitIceGathering(peer.pc);

    return this.encodeSignal({ v: 1, from: this.selfId, sdp: peer.pc.localDescription!.toJSON() });
  }

  /**
   * Offerer role (final step): consume the answer signal to complete the
   * connection. Resolves with the remote peer id.
   */
  async acceptAnswerSignal(signalJson: string): Promise<string> {
    const signal = this.decodeSignal(signalJson);
    const peer = [...this.peers].find((p) => p.remoteId === null);
    if (!peer) throw new Error("No pending LAN offer — create an offer first");

    peer.remoteId = signal.from;
    await peer.pc.setRemoteDescription(signal.sdp);

    // The connectionStateChange handler may have seen "connected" before we
    // knew the remote id — emit the join now so it is never lost.
    if (peer.pc.connectionState === "connected") {
      this.peerJoinHandler?.(signal.from);
    }
    return signal.from;
  }

  // ---- Internals ----------------------------------------------------------------

  private createPeer(remoteId: string | null): RemoteLanPeer {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = new RemoteLanPeer(pc, remoteId);
    this.peers.add(peer);

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case "connected":
          if (peer.remoteId) this.peerJoinHandler?.(peer.remoteId);
          break;
        case "failed":
        case "disconnected":
        case "closed":
          this.dropPeer(peer);
          break;
      }
    };

    pc.ontrack = (event) => this.handleTrack(peer, event);

    return peer;
  }

  private bindChannel(peer: RemoteLanPeer, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onmessage = (event) => this.handleMessage(peer, event.data);
  }

  private handleMessage(peer: RemoteLanPeer, raw: unknown): void {
    if (!peer.remoteId) return;

    if (typeof raw === "string") {
      const frame = decodeTextFrame(raw);
      if (!frame) return;

      const parsedControl = frame.data as { c?: string; sid?: string; m?: unknown } | null;
      if (parsedControl?.c === "stream-meta" && typeof parsedControl.sid === "string") {
        peer.streamMeta.set(parsedControl.sid, parsedControl.m);
        return;
      }

      this.dispatch(frame.actionId, frame.data, peer.remoteId, frame.metadata);
      return;
    }

    if (raw instanceof ArrayBuffer) {
      const frame = decodeBinaryFrame(raw);
      if (!frame) return;
      this.dispatchMaybeChunked(peer, frame.actionId, frame.data, peer.remoteId, frame.metadata);
    }
  }

  /** Dispatch a binary payload, reassembling it first when it is a chunk. */
  private dispatchMaybeChunked(
    peer: RemoteLanPeer,
    action: number,
    data: unknown,
    peerId: string,
    metadata?: unknown
  ): void {
    const chunkCoords = (metadata as ChunkedMeta | undefined)?.[CHUNK_META_KEY] as ChunkCoordinates | undefined;

    if (!chunkCoords) {
      this.dispatch(action, data, peerId, metadata);
      return;
    }

    const { buffer, complete } = peer.assembler.add(chunkCoords, data as ArrayBuffer);
    if (!complete || buffer === null) return;

    const originalMeta = { ...(metadata as Record<string, unknown>) };
    delete originalMeta[CHUNK_META_KEY];
    this.dispatch(action, buffer, peerId, Object.keys(originalMeta).length > 0 ? originalMeta : undefined);
  }

  private dispatch(action: number, data: unknown, peerId: string, metadata?: unknown): void {
    this.receiveHandlers.get(action)?.(data, peerId, metadata);
  }

  private handleTrack(peer: RemoteLanPeer, event: RTCTrackEvent): void {
    if (!peer.remoteId) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    const known = peer.remoteStreams.get(stream.id);
    if (known) return;

    peer.remoteStreams.set(stream.id, stream);
    this.peerStreamHandler?.(stream, peer.remoteId, peer.streamMeta.get(stream.id));
  }

  private async deliver(
    action: number,
    data: unknown,
    metadata?: unknown,
    targetPeerId?: string | null
  ): Promise<void> {
    for (const peer of this.targets(targetPeerId ?? null)) {
      if (!this.isOpen(peer) || !peer.channel) continue;

      if (isJsonable(data)) {
        peer.channel.send(encodeTextFrame(action, data, metadata));
        continue;
      }

      const binary = data as ArrayBuffer | ArrayBufferView;
      if (toByteLength(binary) <= LAN_CHUNK_SIZE) {
        const frame = await encodeBinaryFrame(action, binary, metadata);
        if (this.isOpen(peer) && peer.channel) {
          peer.channel.send(frame);
        }
        continue;
      }

      await this.deliverChunked(peer, action, binary, metadata);
    }
  }

  /** Split large payloads into chunk frames with backpressure between chunks. */
  private async deliverChunked(
    peer: RemoteLanPeer,
    action: number,
    binary: ArrayBuffer | ArrayBufferView,
    metadata?: unknown
  ): Promise<void> {
    const channel = peer.channel;
    if (!channel || !this.isOpen(peer)) return;

    channel.bufferedAmountLowThreshold = LAN_BUFFER_HIGH_WATER / 2;
    const coords: ChunkCoordinates = { t: nanoid(), i: 0, n: 0 };
    const chunks = splitPayload(binary, LAN_CHUNK_SIZE);
    coords.n = chunks.length;

    for (let index = 0; index < chunks.length; index++) {
      if (!this.isOpen(peer) || peer.channel !== channel) return;

      coords.i = index;
      const chunkMeta: ChunkedMeta = {
        ...(metadata as Record<string, unknown> | undefined),
        [CHUNK_META_KEY]: { ...coords },
      };
      const frame = await encodeBinaryFrame(action, chunks[index], chunkMeta);

      if (channel.bufferedAmount > LAN_BUFFER_HIGH_WATER) {
        await waitForBufferDrain(channel);
        if (!this.isOpen(peer) || peer.channel !== channel) return;
      }

      channel.send(frame);
    }
  }

  private sendControl(peer: RemoteLanPeer, message: Record<string, unknown>): void {
    if (!this.isOpen(peer) || !peer.channel) return;
    peer.channel.send(JSON.stringify({ a: -1, d: message }));
  }

  private targets(targetPeerId: string | null): RemoteLanPeer[] {
    if (targetPeerId === null) return [...this.peers];
    return [...this.peers].filter((p) => p.remoteId === targetPeerId);
  }

  private isOpen(peer: RemoteLanPeer): boolean {
    return !this.closed && peer.pc.connectionState === "connected" && peer.channel?.readyState === "open";
  }

  private dropPeer(peer: RemoteLanPeer): void {
    const remoteId = peer.remoteId;
    this.teardownPeer(peer);
    this.peers.delete(peer);
    if (remoteId) this.peerLeaveHandler?.(remoteId);
  }

  private teardownPeer(peer: RemoteLanPeer): void {
    peer.pc.onconnectionstatechange = null;
    peer.pc.ontrack = null;
    if (peer.channel) {
      peer.channel.onmessage = null;
      try {
        peer.channel.close();
      } catch {
        // Already closed.
      }
      peer.channel = null;
    }
    try {
      peer.pc.close();
    } catch {
      // Already closed.
    }
  }

  private waitIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        pc.removeEventListener("icegatheringstatechange", onChange);
        clearTimeout(timer);
        resolve();
      };
      const onChange = () => {
        if (pc.iceGatheringState === "complete") done();
      };
      // With iceServers: [] gathering finishes almost instantly; the timeout is
      // just a safety net for browsers that never report completion.
      const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
      pc.addEventListener("icegatheringstatechange", onChange);
    });
  }

  private encodeSignal(signal: LanSignal): string {
    return JSON.stringify(signal);
  }

  private decodeSignal(signalJson: string): LanSignal {
    const parsed = JSON.parse(signalJson) as Partial<LanSignal>;
    if (parsed.v !== 1 || !parsed.from || !parsed.sdp) {
      throw new Error("Invalid PeerPlay LAN signal payload");
    }
    return parsed as LanSignal;
  }
}

/** Create the LAN-mode transport (no network I/O until signals are exchanged). */
export function createLanWebRTCTransport(): LanWebRTCTransport {
  return new LanWebRTCTransport();
}

function toByteLength(data: ArrayBuffer | ArrayBufferView): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.byteLength;
}

/** Resolves once the channel's buffered amount drops below its low threshold. */
function waitForBufferDrain(channel: RTCDataChannel): Promise<void> {
  return new Promise((resolve) => {
    const onLow = () => {
      channel.removeEventListener("bufferedamountlow", onLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow);
  });
}
