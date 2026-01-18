/**
 * Costs page - Cost breakdown and analytics
 */

import type { FC } from 'hono/jsx';
import type { DashboardStats } from '../../connectors/types.js';

interface CostsProps {
  stats: DashboardStats;
}

const formatCost = (cost: number): string => {
  return `$${cost.toFixed(4)}`;
};

export const CostsPage: FC<CostsProps> = ({ stats }) => {
  const providerCosts = Object.entries(stats.byProvider)
    .map(([name, data]) => ({ name, cost: data.cost, requests: data.requests }))
    .sort((a, b) => b.cost - a.cost);

  const modelCosts = Object.entries(stats.byModel)
    .map(([name, data]) => ({
      name,
      cost: data.cost,
      requests: data.requests,
      tokens: data.tokens,
    }))
    .sort((a, b) => b.cost - a.cost);

  const costPerToken =
    stats.totalTokens.input + stats.totalTokens.output > 0
      ? stats.totalCost / (stats.totalTokens.input + stats.totalTokens.output)
      : 0;

  const costPerRequest =
    stats.totalRequests > 0 ? stats.totalCost / stats.totalRequests : 0;

  return (
    <div>
      <h1>Cost Analytics</h1>

      {/* Summary Cards */}
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{formatCost(stats.totalCost)}</div>
          <div class="stat-label">Total Cost</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{formatCost(costPerRequest)}</div>
          <div class="stat-label">Cost per Request</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${(costPerToken * 1000).toFixed(6)}</div>
          <div class="stat-label">Cost per 1K Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">
            {(stats.totalTokens.input + stats.totalTokens.output).toLocaleString()}
          </div>
          <div class="stat-label">Total Tokens</div>
        </div>
      </div>

      <div class="grid">
        {/* Cost by Provider Chart */}
        <div>
          <h2>Cost by Provider</h2>
          <div class="chart-container">
            <canvas id="providerCostChart"></canvas>
          </div>
        </div>

        {/* Cost by Model Chart */}
        <div>
          <h2>Cost by Model</h2>
          <div class="chart-container">
            <canvas id="modelCostChart"></canvas>
          </div>
        </div>
      </div>

      {/* Provider Cost Table */}
      <h2>Provider Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Requests</th>
            <th>Cost</th>
            <th>% of Total</th>
            <th>Avg Cost/Request</th>
          </tr>
        </thead>
        <tbody>
          {providerCosts.map(({ name, cost, requests }) => (
            <tr>
              <td>
                <span class={`provider-badge provider-${name}`}>{name}</span>
              </td>
              <td>{requests}</td>
              <td>{formatCost(cost)}</td>
              <td>
                {stats.totalCost > 0
                  ? `${((cost / stats.totalCost) * 100).toFixed(1)}%`
                  : '-'}
              </td>
              <td>{requests > 0 ? formatCost(cost / requests) : '-'}</td>
            </tr>
          ))}
          {providerCosts.length === 0 && (
            <tr>
              <td colSpan={5}>
                <em>No cost data yet</em>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Model Cost Table */}
      <h2>Model Breakdown</h2>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>Requests</th>
            <th>Input Tokens</th>
            <th>Output Tokens</th>
            <th>Cost</th>
            <th>$/1K Input</th>
            <th>$/1K Output</th>
          </tr>
        </thead>
        <tbody>
          {modelCosts.map(({ name, cost, requests, tokens }) => {
            const inputCostPer1k =
              tokens.input > 0 ? (cost * 0.3 * 1000) / tokens.input : 0; // Estimate 30% input
            const outputCostPer1k =
              tokens.output > 0 ? (cost * 0.7 * 1000) / tokens.output : 0; // Estimate 70% output
            return (
              <tr>
                <td>
                  <code>{name}</code>
                </td>
                <td>{requests}</td>
                <td>{tokens.input.toLocaleString()}</td>
                <td>{tokens.output.toLocaleString()}</td>
                <td>{formatCost(cost)}</td>
                <td>${inputCostPer1k.toFixed(4)}</td>
                <td>${outputCostPer1k.toFixed(4)}</td>
              </tr>
            );
          })}
          {modelCosts.length === 0 && (
            <tr>
              <td colSpan={7}>
                <em>No model cost data yet</em>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <script>{`
        (function() {
          const providerData = ${JSON.stringify(providerCosts)};
          const modelData = ${JSON.stringify(modelCosts.slice(0, 10))};
          const colors = {
            anthropic: '#d97706',
            openai: '#10a37f',
            google: '#4285f4',
            mistral: '#ff7000',
          };
          const modelColors = [
            '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
            '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
          ];

          // Provider Cost Chart
          new Chart(document.getElementById('providerCostChart'), {
            type: 'bar',
            data: {
              labels: providerData.map(p => p.name),
              datasets: [{
                label: 'Cost ($)',
                data: providerData.map(p => p.cost),
                backgroundColor: providerData.map(p => colors[p.name] || '#6b7280'),
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
                  ticks: { color: getComputedStyle(document.body).getPropertyValue('--pico-color') }
                },
                x: {
                  ticks: { color: getComputedStyle(document.body).getPropertyValue('--pico-color') }
                }
              }
            }
          });

          // Model Cost Chart
          new Chart(document.getElementById('modelCostChart'), {
            type: 'bar',
            data: {
              labels: modelData.map(m => m.name.split('/').pop() || m.name),
              datasets: [{
                label: 'Cost ($)',
                data: modelData.map(m => m.cost),
                backgroundColor: modelColors,
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              indexAxis: 'y',
              plugins: {
                legend: { display: false }
              },
              scales: {
                x: {
                  beginAtZero: true,
                  ticks: { color: getComputedStyle(document.body).getPropertyValue('--pico-color') }
                },
                y: {
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
