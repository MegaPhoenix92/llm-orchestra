/**
 * Health page - Provider health and status
 */

import type { FC } from 'hono/jsx';
import type { ProviderHealth } from '../../connectors/types.js';

interface HealthProps {
  health: ProviderHealth[];
}

const formatDuration = (ms: number): string => {
  if (ms === 0) return '-';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const formatTime = (timestamp: number): string => {
  return new Date(timestamp).toLocaleString();
};

export const HealthPage: FC<HealthProps> = ({ health }) => {
  const availableCount = health.filter((p) => p.available).length;
  const totalCount = health.length;

  return (
    <div>
      <h1>Provider Health</h1>

      {/* Summary */}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">
            {availableCount}/{totalCount}
          </div>
          <div class="stat-label">Providers Available</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {((availableCount / Math.max(totalCount, 1)) * 100).toFixed(0)}%
          </div>
          <div class="stat-label">Availability</div>
        </div>
      </div>

      {/* Provider Cards */}
      <h2>Provider Status</h2>
      <div class="health-grid">
        {health.map((provider) => (
          <article class="health-card">
            <header>
              <div class="health-status">
                <div
                  class={`health-indicator ${
                    provider.available ? 'available' : 'unavailable'
                  }`}
                />
                <span class={`provider-badge provider-${provider.name}`}>
                  {provider.name}
                </span>
                <span style="margin-left: auto">
                  {provider.available ? '✓ Online' : '✕ Offline'}
                </span>
              </div>
            </header>
            <dl>
              <dt>Average Latency</dt>
              <dd>{formatDuration(provider.avgLatencyMs)}</dd>
              <dt>Failover Count</dt>
              <dd>{provider.failoverCount}</dd>
              <dt>Last Checked</dt>
              <dd>{formatTime(provider.lastChecked)}</dd>
            </dl>
          </article>
        ))}
        {health.length === 0 && (
          <p>
            <em>No providers configured</em>
          </p>
        )}
      </div>

      {/* Latency Chart */}
      <h2>Latency Comparison</h2>
      <div class="chart-container">
        <canvas id="latencyChart"></canvas>
      </div>

      {/* Health Checks */}
      <h2>Health Check Details</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Status</th>
            <th>Avg Latency</th>
            <th>Failovers</th>
            <th>Last Check</th>
          </tr>
        </thead>
        <tbody>
          {health.map((provider) => (
            <tr>
              <td>
                <span class={`provider-badge provider-${provider.name}`}>
                  {provider.name}
                </span>
              </td>
              <td>
                <span
                  class={provider.available ? 'status-ok' : 'status-error'}
                >
                  {provider.available ? '● Available' : '● Unavailable'}
                </span>
              </td>
              <td>{formatDuration(provider.avgLatencyMs)}</td>
              <td>{provider.failoverCount}</td>
              <td>{formatTime(provider.lastChecked)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Auto-refresh */}
      <div
        hx-get="/health"
        hx-trigger="every 30s"
        hx-select="main"
        hx-target="main"
        hx-swap="outerHTML"
      >
        <small style="color: var(--pico-muted-color);">
          Auto-refreshing every 30 seconds
        </small>
      </div>

      <script>{`
        (function() {
          const healthData = ${JSON.stringify(health)};
          const colors = {
            anthropic: '#d97706',
            openai: '#10a37f',
            google: '#4285f4',
            mistral: '#ff7000',
          };

          new Chart(document.getElementById('latencyChart'), {
            type: 'bar',
            data: {
              labels: healthData.map(h => h.name),
              datasets: [{
                label: 'Avg Latency (ms)',
                data: healthData.map(h => h.avgLatencyMs),
                backgroundColor: healthData.map(h =>
                  h.available ? (colors[h.name] || '#6b7280') : '#ef4444'
                ),
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: 'Latency (ms)',
                    color: getComputedStyle(document.body).getPropertyValue('--pico-color')
                  },
                  ticks: { color: getComputedStyle(document.body).getPropertyValue('--pico-color') }
                },
                x: {
                  ticks: { color: getComputedStyle(document.body).getPropertyValue('--pico-color') }
                }
              }
            }
          });
        })();
      `}</script>
    </div>
  );
};
