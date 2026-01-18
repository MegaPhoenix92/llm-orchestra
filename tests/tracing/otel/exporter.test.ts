/**
 * OTLP exporter tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OtlpHttpExporter } from '../../../src/tracing/otel/exporter.js';
import { msToNanos, toOtelSpanId, toOtelTraceId } from '../../../src/tracing/otel/utils.js';
import type { SpanData } from '../../../src/tracing/tracer.js';

describe('OtlpHttpExporter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should_buildPayloadAndSend', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
    });
    vi.stubGlobal('fetch', fetchMock);

    const exporter = new OtlpHttpExporter({
      endpoint: 'http://localhost:4318/v1/traces',
      serviceName: 'test-service',
      serviceVersion: '2.0.0',
    });

    const span: SpanData = {
      context: {
        traceId: 'trace_test',
        spanId: 'span_test',
        parentSpanId: 'parent_span',
      },
      name: 'orchestra.complete',
      kind: 'client',
      startTime: 1000,
      endTime: 1100,
      status: 'ok',
      attributes: {
        'llm.provider': 'anthropic',
        'llm.model': 'claude-3',
        'llm.tokens.input': 10,
        'llm.tokens.output': 20,
        'llm.tokens.total': 30,
        'llm.cost': 0.12,
        'llm.cached': true,
      },
      events: [
        {
          name: 'event',
          timestamp: 1050,
          attributes: { detail: 'info' },
        },
      ],
    };

    await exporter.export([span]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4318/v1/traces');
    expect(options.method).toBe('POST');

    const body = JSON.parse(options.body as string);
    const resource = body.resourceSpans[0].resource;
    const scope = body.resourceSpans[0].scopeSpans[0].scope;
    const exportedSpan = body.resourceSpans[0].scopeSpans[0].spans[0];

    expect(resource.attributes).toEqual(
      expect.arrayContaining([
        {
          key: 'service.name',
          value: { stringValue: 'test-service' },
        },
        {
          key: 'service.version',
          value: { stringValue: '2.0.0' },
        },
      ])
    );

    expect(scope.name).toBe('llm-orchestra');
    expect(scope.version).toBe('0.1.0');

    expect(exportedSpan.traceId).toBe(toOtelTraceId('trace_test'));
    expect(exportedSpan.spanId).toBe(toOtelSpanId('span_test'));
    expect(exportedSpan.parentSpanId).toBe(toOtelSpanId('parent_span'));
    expect(exportedSpan.startTimeUnixNano).toBe(msToNanos(1000));
    expect(exportedSpan.endTimeUnixNano).toBe(msToNanos(1100));
    expect(exportedSpan.status.code).toBe(1);

    const attributeKeys = exportedSpan.attributes.map((attr: { key: string }) => attr.key);
    expect(attributeKeys).toContain('gen_ai.system');
    expect(attributeKeys).toContain('gen_ai.request.model');
    expect(attributeKeys).toContain('gen_ai.usage.input_tokens');
    expect(attributeKeys).toContain('gen_ai.usage.output_tokens');
    expect(attributeKeys).toContain('gen_ai.usage.total_tokens');
    expect(attributeKeys).toContain('gen_ai.usage.cost');
    expect(attributeKeys).toContain('gen_ai.cache.hit');
    expect(attributeKeys).toContain('llm_orchestra.original_trace_id');

    expect(exportedSpan.events).toHaveLength(1);
    expect(exportedSpan.events[0].name).toBe('event');
    expect(exportedSpan.events[0].timeUnixNano).toBe(msToNanos(1050));
  });

  it('should_throwOnFailedExport', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', fetchMock);

    const exporter = new OtlpHttpExporter({
      endpoint: 'http://localhost:4318/v1/traces',
    });

    const span: SpanData = {
      context: { traceId: 'trace', spanId: 'span' },
      name: 'test',
      kind: 'internal',
      startTime: 1,
      endTime: 2,
      status: 'error',
      attributes: {},
      events: [],
    };

    await expect(exporter.export([span])).rejects.toThrow(
      'OTEL export failed: 500 Internal Server Error'
    );
  });
});
