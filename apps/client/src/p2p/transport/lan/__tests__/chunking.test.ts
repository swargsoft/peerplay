import { describe, expect, test } from "bun:test";
import { ChunkAssembler, splitPayload, type ChunkCoordinates } from "../chunking";

describe("splitPayload", () => {
  test("splits into exact-size chunks", () => {
    const data = new Uint8Array(1000);
    const chunks = splitPayload(data, 300);
    expect(chunks.length).toBe(4);
    expect(chunks.map((c) => c.byteLength)).toEqual([300, 300, 300, 100]);
  });

  test("returns single chunk for small payloads", () => {
    const chunks = splitPayload(new Uint8Array([1, 2, 3]), 1024);
    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(3);
  });

  test("handles empty payloads", () => {
    const chunks = splitPayload(new ArrayBuffer(0), 1024);
    expect(chunks.length).toBe(1);
    expect(chunks[0].byteLength).toBe(0);
  });

  test("preserves content across chunk boundaries", () => {
    const original = new Uint8Array(10_000);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;

    const joined = new Uint8Array(original.length);
    let cursor = 0;
    for (const chunk of splitPayload(original, 997)) {
      joined.set(new Uint8Array(chunk), cursor);
      cursor += chunk.byteLength;
    }
    expect(joined).toEqual(original);
  });
});

describe("ChunkAssembler", () => {
  const coords = (t: string, i: number, n: number): ChunkCoordinates => ({ t, i, n });

  test("assembles in-order chunks", () => {
    const assembler = new ChunkAssembler();
    expect(assembler.add(coords("a", 0, 3), new Uint8Array([1]).buffer).complete).toBe(false);
    expect(assembler.add(coords("a", 1, 3), new Uint8Array([2]).buffer).complete).toBe(false);

    const result = assembler.add(coords("a", 2, 3), new Uint8Array([3]).buffer);
    expect(result.complete).toBe(true);
    expect(new Uint8Array(result.buffer!)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("assembles out-of-order chunks", () => {
    const assembler = new ChunkAssembler();
    assembler.add(coords("b", 1, 2), new Uint8Array([0x22]).buffer);
    const result = assembler.add(coords("b", 0, 2), new Uint8Array([0x11]).buffer);
    expect(result.complete).toBe(true);
    expect(new Uint8Array(result.buffer!)).toEqual(new Uint8Array([0x11, 0x22]));
  });

  test("ignores duplicate chunks", () => {
    const assembler = new ChunkAssembler();
    assembler.add(coords("c", 0, 2), new Uint8Array([1]).buffer);
    assembler.add(coords("c", 0, 2), new Uint8Array([1]).buffer); // duplicate
    const result = assembler.add(coords("c", 1, 2), new Uint8Array([2]).buffer);
    expect(result.complete).toBe(true);
    expect(new Uint8Array(result.buffer!)).toEqual(new Uint8Array([1, 2]));
  });

  test("tracks concurrent transfers independently", () => {
    const assembler = new ChunkAssembler();
    assembler.add(coords("x", 0, 1), new Uint8Array([9]).buffer);
    const pending = assembler.add(coords("y", 0, 2), new Uint8Array([7]).buffer);
    expect(pending.complete).toBe(false);

    const done = assembler.add(coords("y", 1, 2), new Uint8Array([8]).buffer);
    expect(done.complete).toBe(true);
    expect(new Uint8Array(done.buffer!)).toEqual(new Uint8Array([7, 8]));
  });

  test("round-trips a large payload through split + assemble", () => {
    const original = new Uint8Array(48 * 1024 * 3 + 17);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) % 256;

    const chunks = splitPayload(original);
    expect(chunks.length).toBe(4);

    const assembler = new ChunkAssembler();
    let final: ArrayBuffer | null = null;
    chunks.forEach((chunk, index) => {
      const result = assembler.add(coords("big", index, chunks.length), chunk);
      if (result.complete) final = result.buffer;
    });

    expect(final).not.toBeNull();
    expect(new Uint8Array(final!)).toEqual(original);
  });
});
