/**
 * Data Ingestion Routes
 * Receives telemetry data from SDK clients via OTLP or legacy format
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import type { NewTrace, NewSpan, NewSpanEvent } from '../../db/schema.js';
import { traces, spans, spanEvents, projects } from '../../db/schema.js';
import { evaluateAlertRulesForProject } from '../../alerts/evaluator.js';
import { enqueueAlertWebhookDeliveries } from '../../webhooks/dispatcher.js';
import { createRateLimiter } from '../../utils/rate-limit.js';
import { getRequestMetadata, writeAuditLog } from '../../utils/audit.js';

// ============================================================================
// Types
// ============================================================================

export interface IngestRoutesOptions {
  db: Database;
}

/**
 * OTLP (OpenTelemetry Protocol) Format Types
 */
interface OTLPAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    doubleValue?: number;
    boolValue?: boolean;
    arrayValue?: { values: OTLPAttribute['value'][] };
    kvlistValue?: { values: OTLPAttribute[] };
  };
}

interface OTLPEvent {
  name: string;
  timeUnixNano: string | number;
  attributes?: OTLPAttribute[];
}

interface OTLPSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string | number;
  endTimeUnixNano?: string | number;
  status?: { code: 0 | 1 | 2; message?: string };
  attributes?: OTLPAttribute[];
  events?: OTLPEvent[];
}

interface OTLPScopeSpan {
  scope?: { name?: string; version?: string };
  spans: OTLPSpan[];
}

interface OTLPResourceSpan {
  resource?: { attributes?: OTLPAttribute[] };
  scopeSpans: OTLPScopeSpan[];
}

interface OTLPPayload {
  resourceSpans: OTLPResourceSpan[];
}

/**
 * Legacy Format Types
 */
interface LegacyEvent {
  name: string;
  timestamp: string | number;
  attributes?: Record<string, unknown>;
}

interface LegacySpan {
  traceId: string;
  spanId: string;
  parentId?: string | null;
  name: string;
  startTime: string | number;
  endTime?: string | number;
  status?: 'ok' | 'error' | 'unset';
  attributes?: Record<string, unknown>;
  events?: LegacyEvent[];
}

interface LegacyPayload {
  spans: LegacySpan[];
}

type IngestPayload = OTLPPayload | LegacyPayload;

/**
 * Normalized internal span representation
 */
interface NormalizedSpan {
  traceId: string;
  spanId: string;
  parentId: string | null;
  name: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
  status: 'ok' | 'error' | 'unset';
  attributes: Record<string, unknown>;
  events: Array<{
    name: string;
    timestamp: Date;
    attributes: Record<string, unknown>;
  }>;
  // LLM-specific extracted fields
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
}

// ============================================================================
// Rate Limiting
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB

/** Rate limiter for ingest endpoints */
const ingestRateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_WINDOW_MS,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
});

class BodyTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyTooLargeError';
  }
}

async function readJsonWithLimit(req: Request, maxBytes: number): Promise<unknown> {
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isNaN(contentLength) && contentLength > maxBytes) {
      throw new BodyTooLargeError('Payload too large');
    }
  }

  if (!req.body) {
    return {};
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > maxBytes) {
        throw new BodyTooLargeError('Payload too large');
      }
      chunks.push(value);
    }
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(buffer);
  return JSON.parse(text);
}

// ============================================================================
// Parsing Helpers
// ============================================================================

/**
 * Parse OTLP attribute value to JavaScript value
 */
function parseOTLPAttributeValue(value: OTLPAttribute['value']): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.intValue !== undefined) return Number(value.intValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.arrayValue) {
    return value.arrayValue.values.map(parseOTLPAttributeValue);
  }
  if (value.kvlistValue) {
    return parseOTLPAttributes(value.kvlistValue.values);
  }
  return null;
}

/**
 * Parse OTLP attributes array to Record
 */
function parseOTLPAttributes(
  attributes?: OTLPAttribute[]
): Record<string, unknown> {
  if (!attributes) return {};
  const result: Record<string, unknown> = {};
  for (const attr of attributes) {
    result[attr.key] = parseOTLPAttributeValue(attr.value);
  }
  return result;
}

/**
 * Convert nanoseconds to Date
 */
function nanoToDate(nanos: string | number): Date {
  const ns = typeof nanos === 'string' ? BigInt(nanos) : BigInt(nanos);
  const ms = Number(ns / BigInt(1_000_000));
  return new Date(ms);
}

/**
 * Parse timestamp to Date (handles ISO strings, timestamps, etc.)
 */
function parseTimestamp(timestamp: string | number): Date {
  if (typeof timestamp === 'number') {
    // Assume milliseconds if < 10^12 (year 2001), otherwise assume nanoseconds
    if (timestamp < 1e12) {
      return new Date(timestamp * 1000); // seconds to ms
    } else if (timestamp < 1e15) {
      return new Date(timestamp); // already in ms
    } else {
      return nanoToDate(timestamp); // nanoseconds
    }
  }
  // Try ISO string first
  const date = new Date(timestamp);
  if (!isNaN(date.getTime())) return date;
  // Try as numeric string
  return parseTimestamp(Number(timestamp));
}

/**
 * Map OTLP status code to string
 */
function mapOTLPStatus(status?: { code: 0 | 1 | 2 }): 'ok' | 'error' | 'unset' {
  if (!status) return 'unset';
  switch (status.code) {
    case 0:
      return 'unset';
    case 1:
      return 'ok';
    case 2:
      return 'error';
    default:
      return 'unset';
  }
}

/**
 * Extract LLM-specific attributes from span attributes
 */
function extractLLMAttributes(attributes: Record<string, unknown>): {
  provider: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  cost: number | null;
} {
  return {
    provider:
      (attributes['gen_ai.system'] as string) ||
      (attributes['llm.provider'] as string) ||
      (attributes['provider'] as string) ||
      null,
    model:
      (attributes['gen_ai.request.model'] as string) ||
      (attributes['llm.model'] as string) ||
      (attributes['model'] as string) ||
      null,
    tokensIn:
      Number(attributes['gen_ai.usage.input_tokens']) ||
      Number(attributes['gen_ai.usage.prompt_tokens']) ||
      Number(attributes['llm.tokens.input']) ||
      Number(attributes['tokensIn']) ||
      null,
    tokensOut:
      Number(attributes['gen_ai.usage.output_tokens']) ||
      Number(attributes['gen_ai.usage.completion_tokens']) ||
      Number(attributes['llm.tokens.output']) ||
      Number(attributes['tokensOut']) ||
      null,
    cost:
      Number(attributes['gen_ai.usage.cost']) ||
      Number(attributes['llm.cost']) ||
      Number(attributes['cost']) ||
      null,
  };
}

// ============================================================================
// Format Detection & Parsing
// ============================================================================

/**
 * Detect if payload is OTLP format
 */
function isOTLPPayload(payload: unknown): payload is OTLPPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'resourceSpans' in payload &&
    Array.isArray((payload as OTLPPayload).resourceSpans)
  );
}

/**
 * Detect if payload is Legacy format
 */
function isLegacyPayload(payload: unknown): payload is LegacyPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'spans' in payload &&
    Array.isArray((payload as LegacyPayload).spans)
  );
}

/**
 * Parse OTLP format to normalized spans
 */
function parseOTLPPayload(payload: OTLPPayload): NormalizedSpan[] {
  const normalizedSpans: NormalizedSpan[] = [];

  for (const resourceSpan of payload.resourceSpans) {
    const resourceAttrs = parseOTLPAttributes(resourceSpan.resource?.attributes);

    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const span of scopeSpan.spans) {
        const spanAttrs = parseOTLPAttributes(span.attributes);
        // Merge resource attributes with span attributes (span takes precedence)
        const mergedAttrs = { ...resourceAttrs, ...spanAttrs };

        const startTime = nanoToDate(span.startTimeUnixNano);
        const endTime = span.endTimeUnixNano
          ? nanoToDate(span.endTimeUnixNano)
          : null;
        const duration = endTime
          ? endTime.getTime() - startTime.getTime()
          : null;

        const llmAttrs = extractLLMAttributes(mergedAttrs);

        const events = (span.events || []).map((evt) => ({
          name: evt.name,
          timestamp: nanoToDate(evt.timeUnixNano),
          attributes: parseOTLPAttributes(evt.attributes),
        }));

        normalizedSpans.push({
          traceId: span.traceId,
          spanId: span.spanId,
          parentId: span.parentSpanId || null,
          name: span.name,
          startTime,
          endTime,
          duration,
          status: mapOTLPStatus(span.status),
          attributes: mergedAttrs,
          events,
          ...llmAttrs,
        });
      }
    }
  }

  return normalizedSpans;
}

/**
 * Parse Legacy format to normalized spans
 */
function parseLegacyPayload(payload: LegacyPayload): NormalizedSpan[] {
  return payload.spans.map((span) => {
    const startTime = parseTimestamp(span.startTime);
    const endTime = span.endTime ? parseTimestamp(span.endTime) : null;
    const duration = endTime ? endTime.getTime() - startTime.getTime() : null;

    const attributes = span.attributes || {};
    const llmAttrs = extractLLMAttributes(attributes);

    const events = (span.events || []).map((evt) => ({
      name: evt.name,
      timestamp: parseTimestamp(evt.timestamp),
      attributes: evt.attributes || {},
    }));

    return {
      traceId: span.traceId,
      spanId: span.spanId,
      parentId: span.parentId || null,
      name: span.name,
      startTime,
      endTime,
      duration,
      status: span.status || 'unset',
      attributes,
      events,
      ...llmAttrs,
    };
  });
}

// ============================================================================
// Database Storage
// ============================================================================

/**
 * Store normalized spans to database
 * Uses a transaction to ensure atomicity of trace/span/event inserts
 */
async function storeSpans(
  db: Database,
  projectId: string,
  normalizedSpans: NormalizedSpan[]
): Promise<number> {
  if (normalizedSpans.length === 0) return 0;

  // Group spans by traceId to identify root spans
  const spansByTrace = new Map<string, NormalizedSpan[]>();
  for (const span of normalizedSpans) {
    const traceSpans = spansByTrace.get(span.traceId) || [];
    traceSpans.push(span);
    spansByTrace.set(span.traceId, traceSpans);
  }

  let processed = 0;

  // Wrap all database operations in a transaction for atomicity
  await db.transaction(async (tx) => {
    for (const [traceId, traceSpans] of spansByTrace) {
      // Find root span(s) - spans without parentId or with parentId not in this batch
      const spanIds = new Set(traceSpans.map((s) => s.spanId));
      const rootSpans = traceSpans.filter(
        (s) => !s.parentId || !spanIds.has(s.parentId)
      );

      // Calculate trace-level aggregates
      const traceStartTime = new Date(
        Math.min(...traceSpans.map((s) => s.startTime.getTime()))
      );
      const endTimes = traceSpans
        .map((s) => s.endTime?.getTime())
        .filter((t): t is number => t !== undefined);
      const traceEndTime = endTimes.length > 0 ? new Date(Math.max(...endTimes)) : null;
      const traceDuration = traceEndTime
        ? traceEndTime.getTime() - traceStartTime.getTime()
        : null;

      // Aggregate tokens and cost from all spans
      const totalTokensIn = traceSpans.reduce(
        (sum, s) => sum + (s.tokensIn || 0),
        0
      );
      const totalTokensOut = traceSpans.reduce(
        (sum, s) => sum + (s.tokensOut || 0),
        0
      );
      const totalCost = traceSpans.reduce((sum, s) => sum + (s.cost || 0), 0);

      // Determine trace status (error if any span has error)
      const hasError = traceSpans.some((s) => s.status === 'error');
      const allOk = traceSpans.every((s) => s.status === 'ok');
      const traceStatus: 'ok' | 'error' | 'unset' = hasError
        ? 'error'
        : allOk
          ? 'ok'
          : 'unset';

      // Get primary provider/model from root span or first span with them
      const primarySpan =
        rootSpans.find((s) => s.provider || s.model) ||
        traceSpans.find((s) => s.provider || s.model) ||
        rootSpans[0] ||
        traceSpans[0];

      // Create trace record with surrogate ID
      const traceRecord: NewTrace = {
        id: `trc_${nanoid(16)}`, // Surrogate primary key
        traceId,
        projectId,
        name: primarySpan?.name || 'unnamed',
        status: traceStatus,
        startTime: traceStartTime,
        endTime: traceEndTime,
        duration: traceDuration,
        totalCost: totalCost > 0 ? String(totalCost) : null,
        totalTokensIn: totalTokensIn > 0 ? totalTokensIn : null,
        totalTokensOut: totalTokensOut > 0 ? totalTokensOut : null,
        provider: primarySpan?.provider || null,
        model: primarySpan?.model || null,
        attributes: primarySpan?.attributes || {},
      };

      // Check if trace exists for this project (to handle cross-project traceId collisions)
      const existingTrace = await tx
        .select({ traceId: traces.traceId })
        .from(traces)
        .where(and(eq(traces.projectId, projectId), eq(traces.traceId, traceId)))
        .limit(1);

      if (existingTrace.length > 0) {
        // Update existing trace
        await tx
          .update(traces)
          .set({
            endTime: traceRecord.endTime,
            duration: traceRecord.duration,
            status: traceRecord.status,
            totalCost: traceRecord.totalCost,
            totalTokensIn: traceRecord.totalTokensIn,
            totalTokensOut: traceRecord.totalTokensOut,
            provider: traceRecord.provider,
            model: traceRecord.model,
            attributes: traceRecord.attributes,
          })
          .where(and(eq(traces.projectId, projectId), eq(traces.traceId, traceId)));
      } else {
        // Insert new trace
        await tx.insert(traces).values(traceRecord);
      }

      // Insert spans
      for (const span of traceSpans) {
        const spanRecord: NewSpan = {
          id: `spn_${nanoid(16)}`, // Surrogate primary key
          spanId: span.spanId,
          traceId: span.traceId,
          parentId: span.parentId,
          name: span.name,
          startTime: span.startTime,
          endTime: span.endTime,
          duration: span.duration,
          status: span.status,
          attributes: span.attributes,
          provider: span.provider,
          model: span.model,
          tokensIn: span.tokensIn,
          tokensOut: span.tokensOut,
          cost: span.cost !== null ? String(span.cost) : null,
        };

        // Check if span exists for this trace (to handle cross-trace spanId collisions)
        const existingSpan = await tx
          .select({ spanId: spans.spanId })
          .from(spans)
          .where(and(eq(spans.traceId, span.traceId), eq(spans.spanId, span.spanId)))
          .limit(1);

        if (existingSpan.length > 0) {
          // Update existing span
          await tx
            .update(spans)
            .set({
              endTime: spanRecord.endTime,
              duration: spanRecord.duration,
              status: spanRecord.status,
              attributes: spanRecord.attributes,
              tokensIn: spanRecord.tokensIn,
              tokensOut: spanRecord.tokensOut,
              cost: spanRecord.cost,
            })
            .where(and(eq(spans.traceId, span.traceId), eq(spans.spanId, span.spanId)));
        } else {
          // Insert new span
          await tx.insert(spans).values(spanRecord);
        }

        // Insert span events
        for (const event of span.events) {
          const eventRecord: NewSpanEvent = {
            id: `evt_${nanoid(16)}`,
            spanId: span.spanId,
            name: event.name,
            timestamp: event.timestamp,
            attributes: event.attributes,
          };

          await tx.insert(spanEvents).values(eventRecord).onConflictDoNothing();
        }

        processed++;
      }
    }
  });

  return processed;
}

// ============================================================================
// Route Handler
// ============================================================================

export function createIngestRoutes(options: IngestRoutesOptions): Hono {
  const { db } = options;
  const ingest = new Hono();

  /**
   * POST /api/v1/ingest
   * Receives telemetry data from SDK clients
   *
   * Accepts two formats:
   * 1. OTLP Format (OpenTelemetry Protocol) - { resourceSpans: [...] }
   * 2. Legacy Format (simpler) - { spans: [...] }
   *
   * Authorization: Bearer orch_xxx... (API key validated by middleware)
   */
  ingest.post('/', async (c) => {
    // Get authenticated project ID from context (set by API key middleware)
    const projectId = c.get('projectId');
    const apiKey = c.get('apiKey');

    if (!projectId || !apiKey) {
      return c.json(
        {
          success: false,
          error: 'Unauthorized',
          message: 'Missing project context',
        },
        401
      );
    }

    const scopes = apiKey.scopes || [];
    if (!scopes.includes('ingest')) {
      return c.json(
        {
          success: false,
          error: 'Forbidden',
          message: 'API key does not have ingest scope',
        },
        403
      );
    }

    // Check rate limit
    const rate = ingestRateLimiter.check(apiKey.id);
    c.header('X-RateLimit-Limit', String(RATE_LIMIT_MAX_REQUESTS));
    c.header('X-RateLimit-Remaining', String(rate.remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(rate.resetAt / 1000)));

    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return c.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          message: `Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per minute exceeded`,
          retryAfter,
        },
        429
      );
    }

    // Parse request body
    let payload: IngestPayload;
    try {
      payload = (await readJsonWithLimit(c.req.raw, MAX_BODY_BYTES)) as IngestPayload;
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return c.json(
          {
            success: false,
            error: 'Payload too large',
            message: `Maximum request size is ${MAX_BODY_BYTES} bytes`,
          },
          413
        );
      }
      return c.json(
        {
          success: false,
          error: 'Invalid JSON',
          message: 'Request body must be valid JSON',
        },
        400
      );
    }

    // Validate payload format
    if (!isOTLPPayload(payload) && !isLegacyPayload(payload)) {
      return c.json(
        {
          success: false,
          error: 'Invalid payload format',
          message:
            'Payload must contain either "resourceSpans" (OTLP) or "spans" (Legacy) array',
        },
        400
      );
    }

    // Parse spans based on format
    let normalizedSpans: NormalizedSpan[];
    let format: 'otlp' | 'legacy';

    try {
      if (isOTLPPayload(payload)) {
        format = 'otlp';
        normalizedSpans = parseOTLPPayload(payload);
      } else {
        format = 'legacy';
        normalizedSpans = parseLegacyPayload(payload);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to parse payload';
      return c.json(
        {
          success: false,
          error: 'Parse error',
          message,
        },
        400
      );
    }

    // Validate we have spans to process
    if (normalizedSpans.length === 0) {
      return c.json(
        {
          success: true,
          processed: 0,
          format,
          message: 'No spans to process',
        },
        200
      );
    }

    // Store spans to database
    try {
      const processed = await storeSpans(db, projectId, normalizedSpans);

      const projectRows = await db
        .select({ orgId: projects.orgId })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      const orgId = projectRows[0]?.orgId ?? null;

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        projectId,
        actorType: 'api_key',
        actorId: apiKey.id,
        action: 'ingest.request',
        resourceType: 'ingest',
        resourceId: projectId,
        ip,
        userAgent,
        metadata: {
          format,
          processed,
          spanCount: normalizedSpans.length,
        },
      });

      void (async () => {
        try {
          const triggers = await evaluateAlertRulesForProject(db, projectId);
          if (triggers.length > 0) {
            await enqueueAlertWebhookDeliveries(db, triggers);
          }
        } catch (alertError) {
          console.error('Alert evaluation error:', alertError);
        }
      })();

      return c.json(
        {
          success: true,
          processed,
          format,
        },
        200
      );
    } catch (error) {
      console.error('Ingest storage error:', error);
      const message =
        error instanceof Error ? error.message : 'Failed to store spans';
      return c.json(
        {
          success: false,
          error: 'Storage error',
          message,
        },
        500
      );
    }
  });

  /**
   * GET /api/v1/ingest/health
   * Health check endpoint for ingest service
   */
  ingest.get('/health', (c) => {
    return c.json({
      status: 'ok',
      service: 'ingest',
      timestamp: new Date().toISOString(),
    });
  });

  return ingest;
}
