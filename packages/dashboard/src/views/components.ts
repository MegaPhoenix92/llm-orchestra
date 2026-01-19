/**
 * Reusable View Components
 * Small, composable HTML generators for dashboard UI
 */

import { escapeHtml } from '../utils/html.js';

export interface StatCardProps {
  title: string;
  value: string;
  subtext?: string;
  id?: string;
}

export function renderStatCard({ title, value, subtext, id }: StatCardProps): string {
  return `
    <article class="stat-card">
      <h3>${escapeHtml(title)}</h3>
      <div class="value"${id ? ` id="${escapeHtml(id)}"` : ''}>${escapeHtml(value)}</div>
      ${subtext ? `<div class="subtext">${escapeHtml(subtext)}</div>` : ''}
    </article>
  `;
}

export interface FeedItemProps {
  status: 'ok' | 'error';
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  latencyMs: number;
}

export function renderFeedItem(props: FeedItemProps): string {
  return `
    <div class="feed-item">
      <span class="status-${props.status}">&bull;</span>
      <span class="provider">${escapeHtml(props.provider)}</span>
      <span class="model">${escapeHtml(props.model)}</span>
      <span class="tokens">${props.tokensIn}&rarr;${props.tokensOut}</span>
      <span class="cost">$${props.cost.toFixed(4)}</span>
      <span class="latency">${props.latencyMs}ms</span>
    </div>
  `;
}

export interface SpanNode {
  id: string;
  name: string;
  status: 'ok' | 'error' | 'unset';
  durationMs?: number;
  startTime: number;
  children?: SpanNode[];
}

export function renderSpanTree(spans: SpanNode[], depth = 0): string {
  if (!spans || spans.length === 0) return '';

  return spans
    .map((span) => {
      const statusClass = span.status === 'ok' ? 'status-ok' : span.status === 'error' ? 'status-error' : '';
      const duration = span.durationMs !== undefined ? `${span.durationMs}ms` : 'in progress';

      return `
      <div class="span-node">
        <span class="span-name">${escapeHtml(span.name)}</span>
        <span class="span-duration">${duration}</span>
        <span class="span-status ${statusClass}">${span.status}</span>
      </div>
      ${
        span.children && span.children.length > 0
          ? `<div class="span-children">${renderSpanTree(span.children, depth + 1)}</div>`
          : ''
      }
    `;
    })
    .join('');
}

export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
