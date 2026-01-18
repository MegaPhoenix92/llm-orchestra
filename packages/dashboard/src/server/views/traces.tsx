/**
 * Traces page - Trace list and detail view
 */

import type { FC } from 'hono/jsx';
import type { TraceListItem, TraceDetail } from '../../connectors/types.js';
import type { SpanData } from 'llm-orchestra';
import { sanitizeClass } from '../utils.js';

interface TracesProps {
  traces: TraceListItem[];
  traceDetail?: TraceDetail;
  filters: {
    limit?: number;
    offset?: number;
    status?: string;
    provider?: string;
  };
}

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

const SpanTree: FC<{ spans: SpanData[]; rootId?: string; depth?: number }> = ({
  spans,
  rootId,
  depth = 0,
}) => {
  const children = rootId
    ? spans.filter((s) => s.context.parentSpanId === rootId)
    : spans.filter(
        (s) =>
          !s.context.parentSpanId ||
          !spans.find((p) => p.context.spanId === s.context.parentSpanId)
      );

  return (
    <div>
      {children.map((span) => (
        <div class="span-item" style={`margin-left: ${depth * 20}px`}>
          <div>
            <span class={`status-${span.status}`}>●</span>{' '}
            <strong>{span.name}</strong>
            <span style="color: var(--pico-muted-color); margin-left: 1rem;">
              {formatDuration((span.endTime ?? Date.now()) - span.startTime)}
            </span>
          </div>
          {span.attributes['llm.provider'] && (
            <div style="font-size: 0.875rem; color: var(--pico-muted-color);">
              Provider: {span.attributes['llm.provider'] as string} | Model:{' '}
              {span.attributes['llm.model'] as string}
              {span.attributes['llm.tokens.input'] !== undefined && (
                <>
                  {' '}
                  | Tokens: {span.attributes['llm.tokens.input'] as number}→
                  {span.attributes['llm.tokens.output'] as number}
                </>
              )}
              {span.attributes['llm.cost'] !== undefined && (
                <> | Cost: {formatCost(span.attributes['llm.cost'] as number)}</>
              )}
            </div>
          )}
          {span.events.length > 0 && (
            <div style="font-size: 0.75rem; margin-top: 0.5rem;">
              {span.events.map((event) => (
                <div style="color: var(--pico-muted-color);">
                  📌 {event.name}
                  {event.attributes?.['exception.message'] && (
                    <span style="color: #ef4444;">
                      : {event.attributes['exception.message'] as string}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          <SpanTree spans={spans} rootId={span.context.spanId} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
};

export const TracesPage: FC<TracesProps> = ({ traces, traceDetail, filters }) => {
  if (traceDetail) {
    return (
      <div>
        <a href="/traces">← Back to traces</a>
        <h1>Trace Detail</h1>

        <article>
          <header>
            <strong>Trace ID:</strong> <code>{traceDetail.traceId}</code>
          </header>
          <p>
            <strong>Total Duration:</strong>{' '}
            {formatDuration(traceDetail.totalDuration)}
          </p>
          <p>
            <strong>Spans:</strong> {traceDetail.spans.length}
          </p>
        </article>

        <h2>Span Hierarchy</h2>
        <div class="span-tree">
          <SpanTree spans={traceDetail.spans} />
        </div>

        <h2>Raw Span Data</h2>
        <details>
          <summary>View JSON</summary>
          <pre>
            <code>{JSON.stringify(traceDetail.spans, null, 2)}</code>
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div>
      <h1>Traces</h1>

      {/* Filters */}
      <form method="get" class="grid">
        <label>
          Status
          <select name="status">
            <option value="">All</option>
            <option value="ok" selected={filters.status === 'ok'}>
              OK
            </option>
            <option value="error" selected={filters.status === 'error'}>
              Error
            </option>
          </select>
        </label>
        <label>
          Provider
          <select name="provider">
            <option value="">All</option>
            <option value="anthropic" selected={filters.provider === 'anthropic'}>
              Anthropic
            </option>
            <option value="openai" selected={filters.provider === 'openai'}>
              OpenAI
            </option>
            <option value="google" selected={filters.provider === 'google'}>
              Google
            </option>
            <option value="mistral" selected={filters.provider === 'mistral'}>
              Mistral
            </option>
          </select>
        </label>
        <label>
          Limit
          <select name="limit">
            <option value="25" selected={filters.limit === 25}>
              25
            </option>
            <option value="50" selected={filters.limit === 50 || !filters.limit}>
              50
            </option>
            <option value="100" selected={filters.limit === 100}>
              100
            </option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      {/* Trace Table */}
      <table class="trace-list">
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Duration</th>
            <th>Tokens</th>
            <th>Cost</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr>
              <td>
                <span class={`status-${trace.status}`}>●</span>
              </td>
              <td>
                <a href={`/traces/${trace.traceId}`}>{trace.name}</a>
              </td>
              <td>
                {trace.provider && (
                  <span class={`provider-badge provider-${sanitizeClass(trace.provider)}`}>
                    {trace.provider}
                  </span>
                )}
              </td>
              <td>
                <code>{trace.model || '-'}</code>
              </td>
              <td>{formatDuration(trace.duration)}</td>
              <td>
                {trace.tokens
                  ? `${trace.tokens.input}→${trace.tokens.output}`
                  : '-'}
              </td>
              <td>{trace.cost !== undefined ? formatCost(trace.cost) : '-'}</td>
              <td>{formatTime(trace.startTime)}</td>
            </tr>
          ))}
          {traces.length === 0 && (
            <tr>
              <td colSpan={8}>
                <em>No traces found</em>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination */}
      <nav aria-label="Page navigation">
        {(filters.offset ?? 0) > 0 && (
          <a
            href={`/traces?limit=${filters.limit ?? 50}&offset=${
              (filters.offset ?? 0) - (filters.limit ?? 50)
            }${filters.status ? `&status=${filters.status}` : ''}${
              filters.provider ? `&provider=${filters.provider}` : ''
            }`}
          >
            ← Previous
          </a>
        )}
        {traces.length === (filters.limit ?? 50) && (
          <a
            href={`/traces?limit=${filters.limit ?? 50}&offset=${
              (filters.offset ?? 0) + (filters.limit ?? 50)
            }${filters.status ? `&status=${filters.status}` : ''}${
              filters.provider ? `&provider=${filters.provider}` : ''
            }`}
            style="float: right"
          >
            Next →
          </a>
        )}
      </nav>
    </div>
  );
};
