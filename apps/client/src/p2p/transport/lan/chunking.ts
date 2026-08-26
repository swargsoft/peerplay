/**
 * Large-payload chunking for the LAN transport's data channel.
 *
 * SCTP caps individual WebRTC data channel messages (~256 KiB), so multi-MB
 * audio transfers must be split. Each chunk travels as an ordinary binary
 * frame whose metadata carries chunk coordinates (__c); the receiver
 * reassembles them transparently before dispatching to the action handler.
 */

export const LAN_CHUNK_SIZE = 48 * 1024;
/** Pause pushing new chunks above this buffered amount (bytes). */
export const LAN_BUFFER_HIGH_WATER = 512 * 1024;

/** Metadata key added to chunk frames' metadata objects. */
export const CHUNK_META_KEY = "__c";

export interface ChunkCoordinates {
  /** Transfer id. */
  t: string;
  /** Chunk index (0-based). */
  i: number;
  /** Total number of chunks. */
  n: number;
}

function toBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Split a binary payload into chunk-sized pieces. */
export function splitPayload(data: ArrayBuffer | ArrayBufferView, size = LAN_CHUNK_SIZE): ArrayBuffer[] {
  const bytes = toBytes(data);
  if (bytes.length === 0) return [new ArrayBuffer(0)];

  const chunks: ArrayBuffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.slice(offset, offset + size).buffer);
  }
  return chunks;
}

interface PendingTransfer {
  parts: (ArrayBuffer | null)[];
  received: number;
  total: number;
}

/**
 * Reassembles chunked payloads. Chunks may arrive out of order (ordered
 * channels make this rare, but correctness doesn't depend on it).
 */
export class ChunkAssembler {
  private readonly pending = new Map<string, PendingTransfer>();
  private readonly timestamps = new Map<string, number>();

  constructor(private readonly expireMs = 5 * 60_000) {}

  /**
   * Feed one chunk. Returns the joined payload when the transfer completes,
   * otherwise null.
   */
  add(
    coords: ChunkCoordinates,
    data: ArrayBuffer
  ): { complete: boolean; buffer: ArrayBuffer | null } {
    this.gc();

    let entry = this.pending.get(coords.t);
    if (!entry) {
      entry = {
        parts: new Array<ArrayBuffer | null>(coords.n).fill(null),
        received: 0,
        total: coords.n,
      };
      this.pending.set(coords.t, entry);
      this.timestamps.set(coords.t, Date.now());
    }

    if (coords.i >= entry.total || entry.parts[coords.i] !== null) return { complete: false, buffer: null };

    entry.parts[coords.i] = data;
    entry.received++;

    if (entry.received < entry.total) return { complete: false, buffer: null };

    const totalLength = entry.parts.reduce((sum, part) => sum + part!.byteLength, 0);
    const joined = new Uint8Array(totalLength);
    let cursor = 0;
    for (const part of entry.parts) {
      joined.set(new Uint8Array(part!), cursor);
      cursor += part!.byteLength;
    }

    this.pending.delete(coords.t);
    this.timestamps.delete(coords.t);
    return { complete: true, buffer: joined.buffer };
  }

  /** Drop incomplete transfers older than the expiry window. */
  private gc(): void {
    if (this.pending.size === 0) return;
    const now = Date.now();
    for (const id of [...this.pending.keys()]) {
      const startedAt = this.timestamps.get(id) ?? 0;
      if (now - startedAt > this.expireMs) {
        this.pending.delete(id);
        this.timestamps.delete(id);
      }
    }
  }
}
