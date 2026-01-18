# OpenTelemetry Export Implementation Plan

## Overview
Implement OpenTelemetry (OTEL) export functionality to allow LLM Orchestra traces to be exported to any OTEL-compatible backend (Jaeger, Zipkin, Honeycomb, Datadog, etc.).

## Current State
- Basic tracing exists in `src/tracing/tracer.ts`
- Spans are stored in-memory with `SpanData` type
- Dashboard displays traces locally

## Goals
1. Add OTEL exporter that converts internal spans to OTEL format
2. Support both HTTP and gRPC OTEL protocols
3. Maintain backward compatibility with existing tracing
4. Add configuration options for OTEL endpoint

## Implementation Tasks

### 1. Add Dependencies
```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions
```

### 2. Create OTEL Exporter (`src/tracing/otel-exporter.ts`)
- Convert `SpanData` to OTEL `Span` format
- Map LLM-specific attributes to OTEL semantic conventions
- Handle batch export for performance
- Support configurable endpoint URL

### 3. Update Tracer (`src/tracing/tracer.ts`)
- Add optional OTEL exporter integration
- Export spans to OTEL when configured
- Maintain existing in-memory storage for dashboard

### 4. Update Types (`src/types/index.ts`)
- Add OTEL configuration types
- Add exporter options interface

### 5. Update Orchestra Config (`src/orchestra.ts`)
- Add `otelExporter` configuration option
- Initialize OTEL exporter when configured

### 6. Add Tests (`tests/tracing/otel-exporter.test.ts`)
- Test span conversion
- Test batch export
- Test error handling
- Mock OTEL collector for testing

## Configuration Example
```typescript
const orchestra = new Orchestra({
  providers: { /* ... */ },
  observability: {
    tracing: true,
    otelExporter: {
      endpoint: 'http://localhost:4318/v1/traces',
      headers: { 'Authorization': 'Bearer xxx' },
      batchSize: 100,
      flushInterval: 5000
    }
  }
});
```

## LLM Semantic Conventions
Map to emerging LLM observability standards:
- `gen_ai.system` - Provider name (anthropic, openai, google)
- `gen_ai.request.model` - Model name
- `gen_ai.request.max_tokens` - Max tokens setting
- `gen_ai.response.model` - Actual model used
- `gen_ai.usage.input_tokens` - Input token count
- `gen_ai.usage.output_tokens` - Output token count
- `gen_ai.usage.cost` - Cost in USD

## Files to Create/Modify
1. **CREATE** `src/tracing/otel-exporter.ts` - Main OTEL exporter
2. **CREATE** `src/tracing/otel-semantic.ts` - Semantic convention mappings
3. **MODIFY** `src/tracing/tracer.ts` - Integrate OTEL export
4. **MODIFY** `src/types/index.ts` - Add OTEL types
5. **MODIFY** `src/orchestra.ts` - Add OTEL config
6. **CREATE** `tests/tracing/otel-exporter.test.ts` - Tests
7. **MODIFY** `package.json` - Add dependencies

## Success Criteria
- [ ] Spans export to OTEL-compatible endpoint
- [ ] All existing tests pass
- [ ] New tests for OTEL functionality pass
- [ ] TypeScript compiles without errors
- [ ] Documentation updated in README

## Notes for @codex
- Follow existing code patterns in the codebase
- Use TypeScript strict mode
- Add JSDoc comments for public APIs
- Ensure backward compatibility - OTEL should be optional
- Run `npm test` and `npm run build` before completing
