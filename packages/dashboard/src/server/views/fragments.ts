/**
 * HTML fragments for partial rendering (SSE/HTMX)
 */

import type { TraceListItem } from '../../connectors/types.js';

const formatCost = (cost: number): string => {
  if (!Number.isFinite(cost)) return '$0.0000';
  return `$${cost.toFixed(4)}`;
};

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTime = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) return 'Invalid';
  return new Date(timestamp).toLocaleTimeString();
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const sanitizeClass = (value: string): string => {
  return value.replace(/[^a-z0-9_-]/gi, '').toLowerCase();
};

export function renderTraceFeedItem(trace: TraceListItem): string {
  // Sanitize status to prevent XSS via class names
  const validStatuses = ['ok', 'error', 'unset'] as const;
  const safeStatus = validStatuses.includes(trace.status as any) ? trace.status : 'unset';
  
  const providerBadge = trace.provider
    ? `<span class="provider-badge provider-${sanitizeClass(trace.provider)}">${escapeHtml(trace.provider)}</span>`
    : '';
  const cost = trace.cost !== undefined ? ` | ${formatCost(trace.cost)}` : '';
  const time = formatTime(trace.startTime);

  return `
    <div class="feed-item">
      <span class="status-${safeStatus}">●</span>
      <strong>${escapeHtml(trace.name)}</strong>
      ${providerBadge}
      <span>${formatDuration(trace.duration)}</span>
      ${cost}
      <span style="float: right; color: var(--pico-muted-color);">
        ${escapeHtml(time)}
      </span>
    </div>
  `.trim();
}
