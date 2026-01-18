/**
 * OTLP/HTTP exporter for OTEL-compatible backends
 */

import type { SpanData } from '../tracer.js';
import { toOtelTraceId, toOtelSpanId, msToNanos } from './utils.js';
import { mapAttributesToOtel } from './semantic-conventions.js';

export interface OtelExporterConfig {
  endpoint: string;
  headers?: Record<string, string>;
  timeout?: number;
  batchSize?: number;
  flushInterval?: number;
  serviceName?: string;
  serviceVersion?: string;
}

type OtelAnyValue =
  | { stringValue: string }
  | { intValue: number }
  | { doubleValue: number }
  | { boolValue: boolean };

export class OtlpHttpExporter {
  private config: OtelExporterConfig;

  constructor(config: OtelExporterConfig) {
    this.config = config;
  }

  async export(spans: SpanData[]): Promise<void> {
    if (spans.length === 0) return;
    const payload = this.buildPayload(spans);

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout ?? 30000),
    });

    if (!response.ok) {
      throw new Error(`OTEL export failed: ${response.status} ${response.statusText}`);
    }
  }

  private buildPayload(spans: SpanData[]) {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: this.buildResourceAttributes(),
          },
          scopeSpans: [
            {
              scope: {
                name: 'llm-orchestra',
                version: '0.1.0',
              },
              spans: spans.map((span) => this.transformSpan(span)),
            },
          ],
        },
      ],
    };
  }

  private buildResourceAttributes() {
    const attributes = [
      {
        key: 'service.name',
        value: { stringValue: this.config.serviceName ?? 'llm-orchestra' },
      },
    ];

    if (this.config.serviceVersion) {
      attributes.push({
        key: 'service.version',
        value: { stringValue: this.config.serviceVersion },
      });
    }

    return attributes;
  }

  private transformSpan(span: SpanData) {
    return {
      traceId: toOtelTraceId(span.context.traceId),
      spanId: toOtelSpanId(span.context.spanId),
      parentSpanId: span.context.parentSpanId
        ? toOtelSpanId(span.context.parentSpanId)
        : undefined,
      name: span.name,
      kind: this.mapSpanKind(span.kind),
      startTimeUnixNano: msToNanos(span.startTime),
      endTimeUnixNano: span.endTime ? msToNanos(span.endTime) : undefined,
      attributes: this.transformAttributes(span),
      status: { code: this.mapStatus(span.status) },
      events: span.events.map((event) => ({
        name: event.name,
        timeUnixNano: msToNanos(event.timestamp),
        attributes: this.attributesToOtel(event.attributes ?? {}),
      })),
    };
  }

  private transformAttributes(span: SpanData) {
    const mapped = mapAttributesToOtel(span.attributes);
    mapped['llm_orchestra.original_trace_id'] = span.context.traceId;
    return this.attributesToOtel(mapped);
  }

  private mapSpanKind(kind: SpanData['kind']): number {
    switch (kind) {
      case 'server':
        return 2;
      case 'client':
        return 3;
      case 'internal':
      default:
        return 1;
    }
  }

  private mapStatus(status: SpanData['status']): number {
    switch (status) {
      case 'error':
        return 2;
      case 'ok':
        return 1;
      default:
        return 0;
    }
  }

  private attributesToOtel(attrs: Record<string, unknown>) {
    const entries = Object.entries(attrs)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        key,
        value: this.toOtelValue(value),
      }));

    return entries;
  }

  private toOtelValue(value: unknown): OtelAnyValue {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') {
      if (Number.isInteger(value)) return { intValue: value };
      return { doubleValue: value };
    }
    if (typeof value === 'boolean') return { boolValue: value };
    if (value === null) return { stringValue: 'null' };
    return { stringValue: String(value) };
  }
}
