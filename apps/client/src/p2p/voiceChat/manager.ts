import type { VoiceChatStreamMetadata } from "@/p2p/voiceChat/constants";
import { VOICE_CHAT_STREAM_METADATA } from "@/p2p/voiceChat/constants";
import type { PeerTransport } from "@/p2p/transport";

type Listener = () => void;

export type VoiceChatSnapshot = {
  isJoined: boolean;
  isMuted: boolean;
  isJoining: boolean;
  error: string | null;
  remoteParticipantIds: readonly string[];
};

const EMPTY_SNAPSHOT: VoiceChatSnapshot = {
  isJoined: false,
  isMuted: false,
  isJoining: false,
  error: null,
  remoteParticipantIds: [],
};

function isVoiceChatMetadata(metadata: unknown): metadata is VoiceChatStreamMetadata {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "kind" in metadata &&
    (metadata as VoiceChatStreamMetadata).kind === "voice-chat"
  );
}

/**
 * Optional P2P voice chat over Trystero media streams (separate from synced music playback).
 * Uses HTMLAudioElement for remote peers — never touches the Web Audio playback graph.
 */
class P2PVoiceChatManager {
  private transport: PeerTransport | null = null;
  private localStream: MediaStream | null = null;
  private joined = false;
  private muted = false;
  private joining = false;
  private error: string | null = null;
  private readonly remotePeerIds = new Set<string>();
  private readonly peerAudios = new Map<string, HTMLAudioElement>();
  private readonly listeners = new Set<Listener>();
  private snapshot: VoiceChatSnapshot = EMPTY_SNAPSHOT;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable reference for useSyncExternalStore — must not allocate on every read. */
  getSnapshot = (): VoiceChatSnapshot => this.snapshot;

  bind(transport: PeerTransport): void {
    if (this.transport === transport) return;
    this.unbind();
    this.transport = transport;
    transport.onPeerStream(this.handlePeerStream);
  }

  unbind(): void {
    this.leave();
    for (const audio of this.peerAudios.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    this.peerAudios.clear();
    this.remotePeerIds.clear();
    this.transport = null;
    this.emit();
  }

  onPeerJoined(peerId: string): void {
    if (!this.joined || !this.localStream || !this.transport) return;
    this.transport.addStream(this.localStream, peerId, VOICE_CHAT_STREAM_METADATA);
  }

  onPeerLeft(peerId: string): void {
    this.removeRemotePeer(peerId);
  }

  join = async (): Promise<void> => {
    if (!this.transport || this.joined || this.joining) return;

    this.joining = true;
    this.error = null;
    this.emit();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (!this.transport) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      this.localStream = stream;
      this.joined = true;
      this.muted = false;
      this.transport.addStream(stream, null, VOICE_CHAT_STREAM_METADATA);
    } catch (err) {
      this.error = err instanceof Error ? err.message : "Microphone access denied";
      this.joined = false;
      this.localStream = null;
    } finally {
      this.joining = false;
      this.emit();
    }
  };

  leave = (): void => {
    if (this.localStream && this.transport) {
      this.transport.removeStream(this.localStream);
    }

    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.joined = false;
    this.muted = false;
    this.joining = false;
    this.error = null;
    this.emit();
  };

  setMuted = (muted: boolean): void => {
    this.muted = muted;
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    this.emit();
  };

  toggleMute = (): void => {
    if (!this.joined) return;
    this.setMuted(!this.muted);
  };

  private handlePeerStream = (stream: MediaStream, peerId: string, metadata?: unknown): void => {
    if (!isVoiceChatMetadata(metadata)) return;

    let audio = this.peerAudios.get(peerId);
    if (!audio) {
      audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      this.peerAudios.set(peerId, audio);
    }

    audio.srcObject = stream;
    void audio.play().catch(() => {
      // Autoplay may require prior user gesture; joining voice is a gesture.
    });

    this.remotePeerIds.add(peerId);
    this.emit();
  };

  private removeRemotePeer(peerId: string): void {
    const audio = this.peerAudios.get(peerId);
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      this.peerAudios.delete(peerId);
    }
    if (this.remotePeerIds.delete(peerId)) {
      this.emit();
    }
  }

  private peerIdsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /** Returns true when the public snapshot changed. */
  private commitSnapshot(): boolean {
    const remoteParticipantIds = [...this.remotePeerIds].sort();
    const prev = this.snapshot;
    if (
      prev.isJoined === this.joined &&
      prev.isMuted === this.muted &&
      prev.isJoining === this.joining &&
      prev.error === this.error &&
      this.peerIdsEqual(prev.remoteParticipantIds, remoteParticipantIds)
    ) {
      return false;
    }

    this.snapshot = {
      isJoined: this.joined,
      isMuted: this.muted,
      isJoining: this.joining,
      error: this.error,
      remoteParticipantIds,
    };
    return true;
  }

  private emit(): void {
    if (!this.commitSnapshot()) return;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const p2pVoiceChat = new P2PVoiceChatManager();
