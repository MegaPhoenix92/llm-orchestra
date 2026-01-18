# OpenTelemetry Export Implementation Plan

## Overview
Implement OpenTelemetry (OTEL) export functionality to allow LLM Orchestra traces to be exported to any OTEL-compatible backend via OTLP/HTTP protocol.

## Architectural Decisions (LOCKED)

### 1. Exporter Strategy: OTLP/HTTP to Collector
- Use OTLP/HTTP as the primary (and only initial) protocol
- Users deploy OTEL Collector which fans out to Jaeger/Zipkin/Honeycomb/Datadog
- Keeps SDK dependencies minimal

### 2. ID Format: Dual-Format with Deterministic Conversion
- **Internal**: Keep current human-readable format (`trace_m0q3j8_k5x7p2qn1`)
- **Export**: Convert to OTEL-compliant format (32-hex trace ID, 16-hex span ID)
- **Method**: Deterministic hash ensures same orchestra ID → same OTEL ID
- **Preservation**: Store original ID as `llm_orchestra.original_trace_id` attribute

### 3. Time Units: MS Internal, Nanoseconds on Export
- Keep `Date.now()` (milliseconds) internally
- Convert at export boundary: `ms * 1_000_000n` for nanoseconds
- No internal refactoring needed

### 4. Config Compatibility: Extend TracingConfig
- Add optional `otel` section to existing `TracingConfig`
- Keep `exportEndpoint` for legacy JSON export
- Full backward compatibility

### 5. Export Mode: Allow Parallel Export
- `exportMode: 'legacy-only' | 'otel-only' | 'both'`
- Default: `'otel-only'` when otel configured, `'legacy-only'` otherwise
- Explicit `'both'` for migration period

### 6. Semantic Conventions: gen_ai.* Standard
- Map `llm.*` attributes to `gen_ai.*` OTEL conventions
- Content capture (prompts/responses) OFF by default
- Only enable with explicit `includePrompts`/`includeResponses: true`

---

## Current State Analysis

**Current Tracer (src/tracing/tracer.ts):**
- Trace IDs: `trace_{timestamp36}_{random36}`
- Span IDs: `{timestamp36}_{random36}`
- Timestamps: Unix milliseconds
- Export: JSON to `exportEndpoint`
- Attributes: `llm.*` namespace

**OTEL Requirements:**
- Trace ID: 32 hex chars (128-bit)
- Span ID: 16 hex chars (64-bit)
- Timestamps: nanoseconds
- Attributes: `gen_ai.*` namespace

---

## Implementation Tasks

### Task 1: Add Dependencies
```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
```

### Task 2: Create Conversion Utilities (`src/tracing/otel/utils.ts`)

```typescript
/**
 * Convert LLM Orchestra trace ID to OTEL-compliant format
 * Uses deterministic hash for reproducibility
 */
export function toOtelTraceId(orchestraId: string): string {
  return createDeterministicHash(orchestraId, 16); // 32 hex chars
}

export function toOtelSpanId(orchestraId: string): string {
  return createDeterministicHash(orchestraId, 8); // 16 hex chars
}

function createDeterministicHash(input: string, bytes: number): string {
  // Simple deterministic hash - same input always produces same output
  let hash = 0n;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5n) - hash) + BigInt(input.charCodeAt(i));
    hash = hash & ((1n << BigInt(bytes * 8)) - 1n);
  }
  return hash.toString(16).padStart(bytes * 2, '0');
}

export function msToNanos(ms: number): string {
  return (BigInt(ms) * 1_000_000n).toString();
}
```

### Task 3: Create Semantic Conventions (`src/tracing/otel/semantic-conventions.ts`)

```typescript
export const ATTRIBUTE_MAPPING: Record<string, string> = {
  'llm.provider': 'gen_ai.system',
  'llm.model': 'gen_ai.request.model',
  'llm.tokens.input': 'gen_ai.usage.input_tokens',
  'llm.tokens.output': 'gen_ai.usage.output_tokens',
  'llm.tokens.total': 'gen_ai.usage.total_tokens',
  'llm.cost': 'gen_ai.usage.cost',
  'llm.cached': 'gen_ai.cache.hit',
};

export function mapAttributesToOtel(
  attributes: Record<string, unknown>
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    mapped[ATTRIBUTE_MAPPING[key] ?? key] = value;
  }
  return mapped;
}
```

### Task 4: Create OTLP Exporter (`src/tracing/otel/exporter.ts`)

```typescript
import type { SpanData } from '../types.js';
import { toOtelTraceId, toOtelSpanId, msToNanos } from './utils.js';
import { mapAttributesToOtel } from './semantic-conventions.js';

export interface OtelExporterConfig {
  endpoint: string;  // e.g., 'http://localhost:4318/v1/traces'
  headers?: Record<string, string>;
  timeout?: number;
  batchSize?: number;
  flushInterval?: number;
}

export class OtlpHttpExporter {
  constructor(private config: OtelExporterConfig) {}

  async export(spans: SpanData[]): Promise<void> {
    const payload = this.buildPayload(spans);

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
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
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'llm-orchestra' } },
            { key: 'service.version', value: { stringValue: '0.1.0' } },
          ],
        },
        scopeSpans: [{
          scope: { name: 'llm-orchestra', version: '0.1.0' },
          spans: spans.map(span => this.transformSpan(span)),
        }],
      }],
    };
  }

  private transformSpan(span: SpanData) {
    return {
      traceId: toOtelTraceId(span.context.traceId),
      spanId: toOtelSpanId(span.context.spanId),
      parentSpanId: span.context.parentSpanId
        ? toOtelSpanId(span.context.parentSpanId)
        : undefined,
      name: span.name,
      kind: 3, // SPAN_KIND_CLIENT
      startTimeUnixNano: msToNanos(span.startTime),
      endTimeUnixNano: span.endTime ? msToNanos(span.endTime) : undefined,
      attributes: this.transformAttributes(span),
      status: { code: span.status === 'error' ? 2 : 1 },
      events: span.events.map(e => ({
        name: e.name,
        timeUnixNano: msToNanos(e.timestamp),
        attributes: this.attributesToOtel(e.attributes ?? {}),
      })),
    };
  }

  private transformAttributes(span: SpanData) {
    const mapped = mapAttributesToOtel(span.attributes);
    // Preserve original ID for correlation
    mapped['llm_orchestra.original_trace_id'] = span.context.traceId;
    return this.attributesToOtel(mapped);
  }

  private attributesToOtel(attrs: Record<string, unknown>) {
    return Object.entries(attrs).map(([key, value]) => ({
      key,
      value: this.toOtelValue(value),
    }));
  }

  private toOtelValue(value: unknown) {
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'number') return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
    if (typeof value === 'boolean') return { boolValue: value };
    return { stringValue: String(value) };
  }
}
```

### Task 5: Update Types (`src/types/index.ts`)

Add to `TracingConfig`:
```typescript
export interface TracingConfig {
  enabled: boolean;
  exportEndpoint?: string;  // Legacy JSON export
  sampleRate?: number;
  includePrompts?: boolean;
  includeResponses?: boolean;

  // NEW: OTEL configuration
  otel?: {
    enabled: boolean;
    endpoint: string;  // OTLP/HTTP endpoint
    headers?: Record<string, string>;
    timeout?: number;
    batchSize?: number;
    flushInterval?: number;
    serviceName?: string;
    serviceVersion?: string;
  };

  // Export mode when both are configured
  exportMode?: 'legacy-only' | 'otel-only' | 'both';
}
```

### Task 6: Update Tracer (`src/tracing/tracer.ts`)

Modify `flush()` method to support dual export:
```typescript
async flush(): Promise<void> {
  const toExport = [...this.exportQueue];
  this.exportQueue = [];

  if (toExport.length === 0) return;

  const promises: Promise<void>[] = [];
  const mode = this.config.exportMode ?? (this.config.otel?.enabled ? 'otel-only' : 'legacy-only');

  // Legacy JSON export
  if ((mode === 'legacy-only' || mode === 'both') && this.config.exportEndpoint) {
    promises.push(this.exportLegacyJson(toExport));
  }

  // OTEL export
  if ((mode === 'otel-only' || mode === 'both') && this.otelExporter) {
    promises.push(this.otelExporter.export(toExport));
  }

  const results = await Promise.allSettled(promises);
  // Log any failures but don't throw
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`Export ${i} failed:`, r.reason);
    }
  });
}
```

### Task 7: Create Tests (`tests/tracing/otel/`)

**tests/tracing/otel/utils.test.ts:**
- Test ID conversion is deterministic
- Test ID format compliance (32/16 hex)
- Test time conversion

**tests/tracing/otel/exporter.test.ts:**
- Test payload structure matches OTLP spec
- Test attribute mapping
- Test error handling
- Mock HTTP endpoint

**tests/tracing/otel/semantic-conventions.test.ts:**
- Test all llm.* → gen_ai.* mappings

---

## File Structure

```
src/tracing/
  index.ts                    # Update exports
  tracer.ts                   # Modify flush() method
  otel/
    index.ts                  # Module exports
    utils.ts                  # ID/time conversion
    exporter.ts               # OTLP/HTTP exporter
    semantic-conventions.ts   # Attribute mapping

tests/tracing/otel/
  utils.test.ts
  exporter.test.ts
  semantic-conventions.test.ts
```

---

## Configuration Example

```typescript
const orchestra = new Orchestra({
  providers: {
    anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  },
  observability: {
    tracing: {
      enabled: true,
      otel: {
        enabled: true,
        endpoint: 'http://localhost:4318/v1/traces',
        headers: { 'Authorization': 'Bearer xxx' },
        serviceName: 'my-llm-app',
      },
    },
  },
});
```

---

## Success Criteria

- [ ] All existing tests pass (no breaking changes)
- [ ] New OTEL tests pass
- [ ] TypeScript compiles without errors
- [ ] Spans export to OTEL collector successfully
- [ ] Original trace IDs preserved as attributes
- [ ] gen_ai.* semantic conventions used
- [ ] Prompt/response content NOT exported by default

---

## Commands to Run

```bash
# Install dependencies
npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions

# Build
npm run build

# Test
npm test

# Type check
npx tsc --noEmit
```

---

## Notes for @codex

1. **ID Conversion MUST be deterministic** - same input = same output always
2. **Do NOT modify existing Span class ID generation** - only convert on export
3. **Content capture (prompts/responses) OFF by default** - respect privacy
4. **Use native fetch** - no need for axios/node-fetch
5. **Follow existing code patterns** - check tracer.ts for style
6. **Run all tests before completing** - `npm test`
