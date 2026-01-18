/**
 * OTEL conversion utilities
 */

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;

export function toOtelTraceId(orchestraId: string): string {
  return createDeterministicHash(orchestraId, TRACE_ID_BYTES);
}

export function toOtelSpanId(orchestraId: string): string {
  return createDeterministicHash(orchestraId, SPAN_ID_BYTES);
}

export function msToNanos(ms: number): string {
  return (BigInt(Math.trunc(ms)) * 1_000_000n).toString();
}

function createDeterministicHash(input: string, bytes: number): string {
  let hash = 0n;
  const mask = (1n << BigInt(bytes * 8)) - 1n;

  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5n) - hash + BigInt(input.charCodeAt(i))) & mask;
  }

  return hash.toString(16).padStart(bytes * 2, '0');
}
