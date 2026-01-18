/**
 * Overview page - Main dashboard view
 */

import type { FC } from 'hono/jsx';
import type {
  DashboardStats,
  TraceListItem,
  ProviderHealth,
} from '../../connectors/types.js';
import { escapeJsonForScript, sanitizeClass } from '../utils.js';

interface OverviewProps {
  stats: DashboardStats;
  recentTraces: TraceListItem[];
  health: ProviderHealth[];
}

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleTimeString();
};

export const OverviewPage: FC<OverviewProps> = ({
  stats,
  recentTraces,
  health,
}) => {
  return (
    <div>
      <h1>Dashboard Overview</h1>

      {/* Stats Cards */}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{stats.totalRequests}</div>
          <div class="stat-label">Total Requests</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.totalTokens.input.toLocaleString()}</div>
          <div class="stat-label">Input Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{stats.totalTokens.output.toLocaleString()}</div>
          <div class="stat-label">Output Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{formatCost(stats.totalCost)}</div>
          <div class="stat-label">Total Cost</div>
        </div>
      </div>

      <div class="grid">
        {/* Provider Health Summary */}
        <div>
          <h2>Provider Status</h2>
          <div class="health-grid">
            {health.map((p) => (
              <div class="health-card">
                <div class="health-status">
                  <div
                    class={`health-indicator ${p.available ? 'available' : 'unavailable'}`}
                  />
                  <span class={`provider-badge provider-${sanitizeClass(p.name)}`}>{p.name}</span>
                </div>
                <p>
                  <small>
                    Avg Latency: {formatDuration(p.avgLatencyMs)}
                  </small>
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Live Feed */}
        <div>
          <h2>Live Activity</h2>
          <div
            id="live-feed"
            hx-ext="sse"
            sse-connect="/api/events"
            sse-swap="new_trace"
            hx-swap="afterbegin"
            hx-target="#feed-container"
          >
            <div id="feed-container">
              {recentTraces.length === 0 ? (
                <p>
                  <em>No requests yet. Make an LLM call to see activity.</em>
                </p>
              ) : (
                recentTraces.map((trace) => (
                  <div class="feed-item">
                    <span class={`status-${trace.status}`}>●</span>{' '}
                    <strong>{trace.name}</strong>
                    {trace.provider && (
                      <span class={`provider-badge provider-${sanitizeClass(trace.provider)}`}>
                        {trace.provider}
                      </span>
                    )}{' '}
                    <span>{formatDuration(trace.duration)}</span>
                    {trace.cost !== undefined && (
                      <span> | {formatCost(trace.cost)}</span>
                    )}
                    <span style="float: right; color: var(--pico-muted-color);">
                      {formatTime(trace.startTime)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Provider Breakdown Chart */}
      <h2>Requests by Provider</h2>
      <div class="chart-container">
        <canvas id="providerChart"></canvas>
      </div>

      <script>{`
        (function() {
          const ctx = document.getElementById('providerChart');
          const stats = ${escapeJsonForScript(stats.byProvider)};
          const labels = Object.keys(stats);
          const data = labels.map(k => stats[k].requests);
          const colors = {
            anthropic: '#d97706',
            openai: '#10a37f',
            google: '#4285f4',
            mistral: '#ff7000',
          };

          new Chart(ctx, {
            type: 'doughnut',
            data: {
              labels: labels,
              datasets: [{
                data: data,
                backgroundColor: labels.map(l => colors[l] || '#6b7280'),
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'right',
                  labels: {
                    color: getComputedStyle(document.body).getPropertyValue('--pico-color')
                  }
                }
              }
            }
          });
        })();
      `}</script>

      {/* Model Breakdown Table */}
      <h2>Usage by Model</h2>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
            <th>Cost</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(stats.byModel).map(([model, data]) => (
            <tr>
              <td>
                <code>{model}</code>
              </td>
              <td>{data.requests}</td>
              <td>{data.tokens.input.toLocaleString()}</td>
              <td>{data.tokens.output.toLocaleString()}</td>
              <td>{formatCost(data.cost)}</td>
            </tr>
          ))}
          {Object.keys(stats.byModel).length === 0 && (
            <tr>
              <td colSpan={5}>
                <em>No model usage data yet</em>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
