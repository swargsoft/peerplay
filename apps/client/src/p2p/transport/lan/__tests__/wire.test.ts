import { describe, expect, test } from "bun:test";
import {
  actionId,
  decodeBinaryFrame,
  decodeTextFrame,
  encodeBinaryFrame,
  encodeTextFrame,
  isJsonable,
} from "../wire";

describe("actionId", () => {
  test("is deterministic for the same name", () => {
    expect(actionId("envelope")).toBe(actionId("envelope"));
    expect(actionId("audio-track")).toBe(actionId("audio-track"));
  });

  test("differs across action names", () => {
    const ids = new Set(["envelope", "audio-track", "track-request"].map(actionId));
    expect(ids.size).toBe(3);
  });

  test("fits in 16 bits", () => {
    for (const id of ["envelope", "audio-track", "track-request", ""].map(actionId)) {
      expect(id).toBeLessThanOrEqual(0xffff);
      expect(id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("text frames", () => {
  test("round-trips data without metadata", () => {
    const raw = encodeTextFrame(42, { kind: "broadcast", payload: { a: 1 } });
    const frame = decodeTextFrame(raw);
    expect(frame?.actionId).toBe(42);
    expect(frame?.data).toEqual({ kind: "broadcast", payload: { a: 1 } });
    expect(frame?.metadata).toBeUndefined();
  });

  test("round-trips metadata", () => {
    const raw = encodeTextFrame(7, "hello", { trace: "abc" });
    const frame = decodeTextFrame(raw);
    expect(frame?.metadata).toEqual({ trace: "abc" });
  });

  test("returns null on garbage input", () => {
    expect(decodeTextFrame("not json")).toBeNull();
    expect(decodeTextFrame("{}")).toBeNull();
  });
});

describe("binary frames", () => {
  test("round-trips payload and metadata", () => {
    const payload = new Uint8Array([1, 2, 3, 250]).buffer;
    const encoded = encodeBinaryFrame(513, payload, { trackId: "t1", mimeType: "audio/mpeg" });
    const frame = decodeBinaryFrame(encoded as ArrayBuffer);

    expect(frame?.actionId).toBe(513);
    expect(frame?.metadata).toEqual({ trackId: "t1", mimeType: "audio/mpeg" });
    expect(new Uint8Array(frame?.data as ArrayBuffer)).toEqual(new Uint8Array(payload));
  });

  test("round-trips without metadata", () => {
    const encoded = encodeBinaryFrame(1, new Uint8Array([9, 9])) as ArrayBuffer;
    const frame = decodeBinaryFrame(encoded);
    expect(frame?.actionId).toBe(1);
    expect(frame?.metadata).toBeUndefined();
    expect((frame?.data as ArrayBuffer).byteLength).toBe(2);
  });

  test("handles typed array views with byte offset", () => {
    const backing = new Uint8Array(10);
    backing.set([7, 7, 7], 4);
    const view = backing.subarray(4, 7);

    const encoded = encodeBinaryFrame(2, view) as ArrayBuffer;
    const frame = decodeBinaryFrame(encoded);
    expect(new Uint8Array(frame?.data as ArrayBuffer)).toEqual(new Uint8Array([7, 7, 7]));
  });

  test("returns null on truncated frames", () => {
    expect(decodeBinaryFrame(new ArrayBuffer(3))).toBeNull();

    const lying = new ArrayBuffer(6);
    new DataView(lying).setUint32(2, 1000, false); // metaLen beyond buffer
    expect(decodeBinaryFrame(lying)).toBeNull();
  });
});

describe("isJsonable", () => {
  test("classifies payloads", () => {
    expect(isJsonable({ a: 1 })).toBe(true);
    expect(isJsonable("str")).toBe(true);
    expect(isJsonable(null)).toBe(true);
    expect(isJsonable(new ArrayBuffer(4))).toBe(false);
    expect(isJsonable(new Uint8Array(4))).toBe(false);
  });
});
