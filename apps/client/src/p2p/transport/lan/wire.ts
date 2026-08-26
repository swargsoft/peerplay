/**
 * Wire format for the LAN transport's single multiplexed data channel.
 *
 * Named actions (makeAction) are mapped to a deterministic 16-bit id derived
 * from the action name, so both peers agree on ids without a handshake.
 *
 * Frames:
 * - Text frame (JSON-able payloads):  {"a":<id>,"d":<data>,"m":<meta?>}
 * - Binary frame (binary payloads):   [u16 id][u32 metaLen][meta JSON utf8][payload bytes]
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Deterministic FNV-1a 16-bit hash — both peers must derive the same id. */
export function actionId(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0xffff;
}

export interface DecodedFrame {
  actionId: number;
  data: unknown;
  metadata?: unknown;
}

export function encodeTextFrame(id: number, data: unknown, metadata?: unknown): string {
  const frame: { a: number; d: unknown; m?: unknown } = { a: id, d: data };
  if (metadata !== undefined) frame.m = metadata;
  return JSON.stringify(frame);
}

export function decodeTextFrame(raw: string): DecodedFrame | null {
  try {
    const parsed = JSON.parse(raw) as { a?: unknown; d?: unknown; m?: unknown };
    if (typeof parsed.a !== "number") return null;
    return {
      actionId: parsed.a,
      data: parsed.d,
      metadata: parsed.m,
    };
  } catch {
    return null;
  }
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function encodeFrameSync(
  id: number,
  data: ArrayBuffer | ArrayBufferView,
  metadata?: unknown
): ArrayBuffer {
  const payload = toBytes(data);
  const metaJson = metadata === undefined ? "" : JSON.stringify(metadata);
  const metaBytes = textEncoder.encode(metaJson);

  const frame = new Uint8Array(6 + metaBytes.length + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint16(0, id, false);
  view.setUint32(2, metaBytes.length, false);
  frame.set(metaBytes, 6);
  frame.set(payload, 6 + metaBytes.length);
  return frame.buffer;
}

export function encodeBinaryFrame(
  id: number,
  data: ArrayBuffer | ArrayBufferView | Blob,
  metadata?: unknown
): Promise<ArrayBuffer> | ArrayBuffer {
  if (data instanceof Blob) {
    return data.arrayBuffer().then((buffer) => encodeFrameSync(id, buffer, metadata));
  }
  return encodeFrameSync(id, data, metadata);
}

export function decodeBinaryFrame(buffer: ArrayBuffer): DecodedFrame | null {
  if (buffer.byteLength < 6) return null;
  const view = new DataView(buffer);
  const id = view.getUint16(0, false);
  const metaLen = view.getUint32(2, false);
  if (6 + metaLen > buffer.byteLength) return null;

  let metadata: unknown;
  if (metaLen > 0) {
    try {
      metadata = JSON.parse(textDecoder.decode(new Uint8Array(buffer, 6, metaLen)));
    } catch {
      metadata = undefined;
    }
  }

  const payloadStart = 6 + metaLen;
  return {
    actionId: id,
    data: buffer.slice(payloadStart),
    metadata,
  };
}

/** True when the value can be sent as a JSON text frame. */
export function isJsonable(data: unknown): boolean {
  if (
    data instanceof ArrayBuffer ||
    ArrayBuffer.isView(data) ||
    data instanceof Blob
  ) {
    return false;
  }
  return true;
}
