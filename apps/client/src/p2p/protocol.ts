import type { P2PEnvelope } from "@pearplay/shared";
import { P2PEnvelopeSchema } from "@pearplay/shared";

export function parseP2PEnvelope(data: unknown): P2PEnvelope {
  return P2PEnvelopeSchema.parse(data);
}

export function serializeP2PEnvelope(envelope: P2PEnvelope): P2PEnvelope {
  return envelope;
}
