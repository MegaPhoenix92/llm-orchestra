/**
 * Tracing & OTEL Export Example
 *
 * This example demonstrates how to configure LLM Orchestra to export
 * distributed traces to OpenTelemetry-compatible backends like:
 * - Jaeger
 * - Zipkin
 * - Grafana Tempo
 * - Honeycomb
 * - Datadog
 *
 * Run with: npx tsx examples/tracing-export.ts
 */

import { Orchestra, Tracer, OtlpHttpExporter } from 'llm-orchestra';

async function main() {
  console.log('=== LLM Orchestra Tracing Export Example ===\n');

  // Option 1: Built-in OTEL export via Orchestra config
  console.log('--- Option 1: Built-in OTEL Export ---');
  const orchestraWithOtel = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    },
    observability: {
      tracing: {
        enabled: true,
        sampleRate: 1.0,
        includePrompts: false, // Don't include prompt content in traces
        includeResponses: false, // Don't include response content
        // Export to OTEL-compatible backend
        otel: {
          enabled: true,
          endpoint: process.env.OTEL_EXPORTER_ENDPOINT || 'http://localhost:4318/v1/traces',
          serviceName: 'my-llm-app',
          serviceVersion: '1.0.0',
          headers: {
            // Add auth headers if needed (e.g., for Honeycomb, Datadog)
            // 'x-honeycomb-team': process.env.HONEYCOMB_API_KEY,
          },
          batchSize: 100,
          flushInterval: 5000, // Flush every 5 seconds
          timeout: 30000,
        },
        exportMode: 'otel-only', // 'legacy-only' | 'otel-only' | 'both'
      },
      costTracking: {
        enabled: true,
      },
    },
  });

  // Make a request - trace will be automatically exported
  const response = await orchestraWithOtel.complete({
    model: 'claude-3-haiku-20240307',
    messages: [{ role: 'user', content: 'What is 2+2?' }],
  });

  console.log('Response:', response.content);
  console.log('Trace ID:', response.meta.traceId);
  console.log('Span ID:', response.meta.spanId);

  // Flush any remaining traces
  await orchestraWithOtel.shutdown();

  // Option 2: Manual tracer with custom spans
  console.log('\n--- Option 2: Manual Tracer ---');

  // Create a tracer instance
  const tracer = new Tracer({
    enabled: true,
    sampleRate: 1.0,
  });

  // Create a span for a custom operation
  const span = tracer.startSpan('custom-operation', {
    'operation.type': 'research',
    'user.id': 'user-123',
  });

  // Add events to the span
  span.addEvent('started-research', { topic: 'AI safety' });

  // Create child spans for sub-operations
  const childSpan = span.startChild('fetch-data', {
    'data.source': 'database',
  });

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));
  childSpan.setStatus('ok');
  childSpan.end();

  // Add more events
  span.addEvent('completed-research', { results: 5 });
  span.setStatus('ok');
  span.end();

  const spanContext = span.getContext();
  console.log('Span created:', spanContext.spanId);
  console.log('Trace ID:', spanContext.traceId);

  // Flush any pending spans to the configured OTEL endpoint
  await tracer.shutdown();

  // Option 3: Using metadata for trace correlation
  console.log('\n--- Option 3: Trace Correlation via Metadata ---');

  const orchestraWithContext = new Orchestra({
    providers: {
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY!,
      },
    },
    observability: {
      tracing: {
        enabled: true,
        sampleRate: 1.0,
      },
    },
  });

  // Use metadata to correlate traces with your application
  const correlationId = 'request-abc123';

  const chainedResponse = await orchestraWithContext.complete({
    model: 'claude-3-haiku-20240307',
    messages: [{ role: 'user', content: 'Continue this research task.' }],
    metadata: {
      correlationId,
      parentOperation: 'research-pipeline',
    },
  });

  console.log('Correlation ID:', correlationId);
  console.log('Orchestra Trace ID:', chainedResponse.meta.traceId);
  console.log('Use metadata to link LLM calls to your application traces!');

  await orchestraWithContext.shutdown();

  // Summary of trace export options
  console.log('\n=== Trace Export Options Summary ===');
  console.log(`
1. Built-in OTEL Export:
   - Configure via observability.tracing.otel
   - Automatic batching and flushing
   - Supports Jaeger, Zipkin, Tempo, etc.

2. Manual Exporter:
   - Create OtlpHttpExporter instance
   - Full control over export timing
   - Custom span creation

3. Distributed Context:
   - Pass traceId to link calls
   - Connect LLM traces to app traces
   - Full observability pipeline

Supported OTEL Backends:
   - Jaeger: http://localhost:14268/api/traces
   - Zipkin: http://localhost:9411/api/v2/spans
   - Tempo: http://localhost:4318/v1/traces
   - Honeycomb: https://api.honeycomb.io/v1/traces
   - Datadog: https://trace.agent.datadoghq.com/v1/traces
`);
}

main().catch(console.error);
