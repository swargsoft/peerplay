import { nanoid } from "nanoid";
import { LanWebRTCTransport } from "./LanWebRTCTransport";

/**
 * Automated offline acceptance harness (roadmap Stage 13).
 *
 * Spins up two independent LanWebRTCTransports inside this browser tab and
 * drives them through the exact flow two physical devices use: SDP signal
 * exchange → WebRTC connection (host candidates only, no STUN/TURN/internet)
 * → text round-trip → large chunked binary round-trip.
 *
 * Passing here proves everything except physical radio hops; the remaining
 * manual step is scanning QR codes across two devices with internet off.
 */

export interface LanSelfTestResult {
  signalingOk: boolean;
  connected: boolean;
  /** Round-trip time for a small JSON message through the data channel. */
  textRoundTripMs: number | null;
  /** Round-trip time for a ~200 KB chunked binary payload. */
  binaryRoundTripMs: number | null;
  /** True when the received binary matched byte-for-byte (incl. metadata). */
  chunksOk: boolean;
  error?: string;
}

const TEXT_CHANNEL = "selftest-text";
const BINARY_CHANNEL = "selftest-binary";
const STEP_TIMEOUT_MS = 15_000;

function timeoutReject(label: string, ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  );
}

export async function runLanSelfTest(): Promise<LanSelfTestResult> {
  const result: LanSelfTestResult = {
    signalingOk: false,
    connected: false,
    textRoundTripMs: null,
    binaryRoundTripMs: null,
    chunksOk: false,
  };

  const a = new LanWebRTCTransport();
  const b = new LanWebRTCTransport();

  try {
    // ---- 1. Signaling exchange -------------------------------------------------
    const offer = await a.createOfferSignal();
    const answer = await b.acceptOfferSignal(offer);
    await a.acceptAnswerSignal(answer);
    result.signalingOk = true;

    // ---- 2. Connection establishment -------------------------------------------
    const bothJoined = Promise.all([
      new Promise<string>((resolve) => a.onPeerJoin(resolve)),
      new Promise<string>((resolve) => b.onPeerJoin(resolve)),
    ]);
    await Promise.race([
      bothJoined,
      timeoutReject("peer join", STEP_TIMEOUT_MS),
    ]);
    result.connected = true;

    // ---- 3. Text (JSON frame) round-trip ---------------------------------------
    const nonce = nanoid(8);
    const [, receiveTextOnB] = b.makeAction<{ nonce: string }>(TEXT_CHANNEL);
    const [sendTextFromA] = a.makeAction<{ nonce: string }>(TEXT_CHANNEL);

    const textReceived = new Promise<void>((resolve) => {
      receiveTextOnB((data) => {
        if (data.nonce !== nonce) return;
        result.textRoundTripMs = Math.round(performance.now() - startedAt);
        resolve();
      });
    });

    const startedAt = performance.now();
    await Promise.race([
      sendTextFromA({ nonce }, b.selfId).then(() => textReceived),
      timeoutReject("text round-trip", STEP_TIMEOUT_MS),
    ]);

    // ---- 4. Chunked binary round-trip ------------------------------------------
    const [sendBinA, receiveBinB] = a.makeAction<ArrayBuffer>(BINARY_CHANNEL);
    void receiveBinB;
    const [, onBinaryToB] = b.makeAction<ArrayBuffer>(BINARY_CHANNEL);

    const size = 200_000; // forces multiple 48KB chunks
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i++) payload[i] = i % 256;

    let received: ArrayBuffer | null = null;
    let receivedMeta: unknown = null;
    const binStartedAt = performance.now();
    const binaryReceived = new Promise<void>((resolve) => {
      onBinaryToB((data, _peerId, meta) => {
        received = data;
        receivedMeta = meta;
        result.binaryRoundTripMs = Math.round(performance.now() - binStartedAt);
        resolve();
      });
    });

    await Promise.race([
      sendBinA(payload.buffer, b.selfId, { trackId: "selftest" }).then(() => binaryReceived),
      timeoutReject("binary round-trip", STEP_TIMEOUT_MS),
    ]);

    if (received) {
      const incoming = new Uint8Array(received as ArrayBuffer);
      const metaOk =
        (receivedMeta as { trackId?: string } | undefined)?.trackId === "selftest";
      let bytesOk = incoming.length === size && metaOk;
      if (bytesOk) {
        for (let i = 0; i < size; i++) {
          if (incoming[i] !== payload[i]) {
            bytesOk = false;
            break;
          }
        }
      }
      result.chunksOk = bytesOk;
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  } finally {
    await Promise.allSettled([a.leave(), b.leave()]);
  }
}
