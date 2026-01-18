/**
 * OTEL utils tests
 */

import { describe, it, expect } from 'vitest';
import { msToNanos, toOtelSpanId, toOtelTraceId } from '../../../src/tracing/otel/utils.js';

describe('otel utils', () => {
  it('should_generateDeterministicTraceId', () => {
    const first = toOtelTraceId('trace_test_123');
    const second = toOtelTraceId('trace_test_123');
    expect(first).toBe(second);
  });

  it('should_generateCorrectIdLengths', () => {
    const traceId = toOtelTraceId('trace_test_123');
    const spanId = toOtelSpanId('span_test_123');

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(spanId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should_convertMsToNanos', () => {
    expect(msToNanos(0)).toBe('0');
    expect(msToNanos(1)).toBe('1000000');
    expect(msToNanos(1234)).toBe('1234000000');
  });

  it('should_truncateFractionalMilliseconds', () => {
    expect(msToNanos(12.987)).toBe('12000000');
  });
});
