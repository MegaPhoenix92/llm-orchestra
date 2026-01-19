/**
 * Page Routes
 * HTML pages for the dashboard UI
 */

import { Hono } from 'hono';
import type { ProviderName } from 'llm-orchestra';
import type { DashboardConnector } from '../../connectors/types.js';
import { escapeHtml } from '../../utils/html.js';
import { layout } from '../../views/layout.js';
import { formatUptime } from '../../views/components.js';

export function createPageRoutes(connector: DashboardConnector): Hono {
  const pages = new Hono();

  // GET / - Overview dashboard
  pages.get('/', async (c) => {
    const stats = await connector.getStats();
    const health = await connector.getProviderHealth();
    const requests = await connector.getRecentRequests(10);

    const content = `
      <h1>Dashboard</h1>

      <div class="grid-4">
        <article class="stat-card">
          <h3>Total Requests</h3>
          <div class="value" id="stat-requests">${stats.totalRequests.toLocaleString()}</div>
          <div class="subtext" id="stat-rpm">${stats.requestsPerMinute}</div>
          <div class="subtext">requests/min</div>
        </article>
        <article class="stat-card">
          <h3>Total Tokens</h3>
          <div class="value" id="stat-tokens">${(stats.totalTokens.input + stats.totalTokens.output).toLocaleString()}</div>
          <div class="subtext">${stats.totalTokens.input.toLocaleString()} in / ${stats.totalTokens.output.toLocaleString()} out</div>
        </article>
        <article class="stat-card">
          <h3>Total Cost</h3>
          <div class="value" id="stat-cost">$${stats.totalCost.toFixed(4)}</div>
          <div class="subtext">USD</div>
        </article>
        <article class="stat-card">
          <h3>Uptime</h3>
          <div class="value">${formatUptime(stats.uptime)}</div>
          <div class="subtext" id="health-status">${health.map((p) => `${escapeHtml(p.name)}: ${p.available ? 'OK' : 'Down'}`).join(' | ')}</div>
        </article>
      </div>

      <h2>Recent Requests</h2>
      <article>
        <div id="request-feed">
          ${requests
            .map(
              (req) => `
            <div class="feed-item">
              <span class="status-${req.status}">&bull;</span>
              <span class="provider">${escapeHtml(req.provider)}</span>
              <span class="model">${escapeHtml(req.model)}</span>
              <span class="tokens">${req.tokens.input}&rarr;${req.tokens.output}</span>
              <span class="cost">$${req.cost.toFixed(4)}</span>
              <span class="latency">${req.latencyMs}ms</span>
            </div>
          `
            )
            .join('')}
          ${requests.length === 0 ? '<p>No requests yet. Make some API calls to see them here.</p>' : ''}
        </div>
      </article>

      <h2>Cost by Provider</h2>
      <article>
        <canvas id="cost-chart" height="200"></canvas>
      </article>
    `;

    const scripts = `
      (function() {
        var ctx = document.getElementById('cost-chart');
        if (ctx) {
          var providerData = ${JSON.stringify(
            Object.entries(stats.byProvider).map(([name, data]) => ({
              name,
              cost: data.cost,
              requests: data.requests,
            }))
          )};

          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: providerData.map(function(p) { return p.name; }),
              datasets: [{
                label: 'Cost ($)',
                data: providerData.map(function(p) { return p.cost; }),
                backgroundColor: 'rgba(99, 102, 241, 0.5)',
                borderColor: 'rgb(99, 102, 241)',
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { display: false }
              },
              scales: {
                y: { beginAtZero: true }
              }
            }
          });
        }
      })();
    `;

    return c.html(layout({ title: 'Overview', content, scripts, activeNav: 'overview' }));
  });

  // GET /traces - Trace viewer with filtering
  pages.get('/traces', async (c) => {
    const status = c.req.query('status');
    const search = c.req.query('search');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    let traces = await connector.getTraces({ limit: 100 });

    // Apply filters
    if (status && status !== 'all') {
      traces = traces.filter((t) => t.status === status);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      traces = traces.filter(
        (t) => t.name.toLowerCase().includes(searchLower) || t.id.toLowerCase().includes(searchLower)
      );
    }

    traces = traces.slice(0, limit);

    const content = `
      <h1>Traces</h1>

      <div class="filter-bar">
        <input type="search" id="trace-search" placeholder="Search by name or ID..." value="${escapeHtml(search || '')}">
        <select id="status-filter">
          <option value="all"${!status || status === 'all' ? ' selected' : ''}>All Status</option>
          <option value="ok"${status === 'ok' ? ' selected' : ''}>OK</option>
          <option value="error"${status === 'error' ? ' selected' : ''}>Error</option>
        </select>
        <button onclick="applyFilters()">Filter</button>
      </div>

      <article>
        <table>
          <thead>
            <tr>
              <th>Trace ID</th>
              <th>Name</th>
              <th>Duration</th>
              <th>Status</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${traces
              .map(
                (trace) => `
              <tr>
                <td><a href="/traces/${encodeURIComponent(trace.id)}">${escapeHtml(trace.id.substring(0, 12))}...</a></td>
                <td>${escapeHtml(trace.name)}</td>
                <td>${trace.durationMs ? `${trace.durationMs}ms` : '-'}</td>
                <td><span class="badge badge-${trace.status}">${trace.status}</span></td>
                <td>${new Date(trace.startTime).toLocaleTimeString()}</td>
              </tr>
            `
              )
              .join('')}
            ${traces.length === 0 ? '<tr><td colspan="5">No traces found.</td></tr>' : ''}
          </tbody>
        </table>
      </article>

      <p>${traces.length} trace(s) shown</p>
    `;

    const scripts = `
      function applyFilters() {
        var search = document.getElementById('trace-search').value;
        var status = document.getElementById('status-filter').value;
        var params = new URLSearchParams();
        if (search) params.set('search', search);
        if (status !== 'all') params.set('status', status);
        window.location.href = '/traces' + (params.toString() ? '?' + params.toString() : '');
      }

      document.getElementById('trace-search').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') applyFilters();
      });
    `;

    return c.html(layout({ title: 'Traces', content, scripts, activeNav: 'traces' }));
  });

  // GET /traces/:id - Single trace detail with span tree
  pages.get('/traces/:id', async (c) => {
    const id = c.req.param('id');
    const trace = await connector.getTrace(id);

    if (!trace) {
      return c.html(
        layout({
          title: 'Trace Not Found',
          content: '<h1>Trace Not Found</h1><p>The requested trace could not be found.</p>',
          activeNav: 'traces',
        }),
        404
      );
    }

    // Build span tree visualization from trace hierarchy
    const spanTreeHtml = renderTraceTree(trace);

    const content = `
      <h1>Trace: ${escapeHtml(trace.name)}</h1>
      <article>
        <dl>
          <dt>ID</dt><dd><code>${escapeHtml(trace.id)}</code></dd>
          <dt>Status</dt><dd><span class="badge badge-${trace.status}">${trace.status}</span></dd>
          <dt>Duration</dt><dd>${trace.durationMs ? `${trace.durationMs}ms` : 'In progress'}</dd>
          <dt>Started</dt><dd>${new Date(trace.startTime).toISOString()}</dd>
          ${trace.endTime ? `<dt>Ended</dt><dd>${new Date(trace.endTime).toISOString()}</dd>` : ''}
        </dl>
      </article>

      <h2>Span Hierarchy</h2>
      <article>
        <div class="span-tree">
          ${spanTreeHtml}
        </div>
      </article>

      <h2>Attributes</h2>
      <article>
        <pre><code>${escapeHtml(JSON.stringify(trace.attributes, null, 2))}</code></pre>
      </article>

      ${
        trace.events.length > 0
          ? `
        <h2>Events (${trace.events.length})</h2>
        <article>
          <table>
            <thead>
              <tr><th>Name</th><th>Time</th><th>Attributes</th></tr>
            </thead>
            <tbody>
              ${trace.events
                .map(
                  (event) => `
                <tr>
                  <td>${escapeHtml(event.name)}</td>
                  <td>${new Date(event.timestamp).toLocaleTimeString()}</td>
                  <td><code>${escapeHtml(JSON.stringify(event.attributes))}</code></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </article>
      `
          : ''
      }

      <p><a href="/traces">&larr; Back to Traces</a></p>
    `;
    return c.html(layout({ title: `Trace: ${escapeHtml(trace.name)}`, content, activeNav: 'traces' }));
  });

  // GET /costs - Cost breakdown
  pages.get('/costs', async (c) => {
    const stats = await connector.getStats();

    const content = `
      <h1>Cost Breakdown</h1>

      <div class="grid-4">
        <article class="stat-card">
          <h3>Total Cost</h3>
          <div class="value">$${stats.totalCost.toFixed(4)}</div>
        </article>
        <article class="stat-card">
          <h3>Input Tokens</h3>
          <div class="value">${stats.totalTokens.input.toLocaleString()}</div>
        </article>
        <article class="stat-card">
          <h3>Output Tokens</h3>
          <div class="value">${stats.totalTokens.output.toLocaleString()}</div>
        </article>
        <article class="stat-card">
          <h3>Requests</h3>
          <div class="value">${stats.totalRequests.toLocaleString()}</div>
        </article>
      </div>

      <div class="grid-2">
        <div>
          <h2>By Provider</h2>
          <article>
            <table>
              <thead>
                <tr><th>Provider</th><th>Requests</th><th>Tokens</th><th>Cost</th><th>Avg Latency</th></tr>
              </thead>
              <tbody>
                ${Object.entries(stats.byProvider)
                  .map(
                    ([name, data]) => `
                  <tr>
                    <td><strong>${name}</strong></td>
                    <td>${data.requests.toLocaleString()}</td>
                    <td>${(data.tokens.input + data.tokens.output).toLocaleString()}</td>
                    <td>$${data.cost.toFixed(4)}</td>
                    <td>${data.avgLatencyMs.toFixed(0)}ms</td>
                  </tr>
                `
                  )
                  .join('')}
                ${Object.keys(stats.byProvider).length === 0 ? '<tr><td colspan="5">No data yet.</td></tr>' : ''}
              </tbody>
            </table>
          </article>
        </div>

        <div>
          <h2>By Model</h2>
          <article>
            <table>
              <thead>
                <tr><th>Model</th><th>Requests</th><th>Cost</th></tr>
              </thead>
              <tbody>
                ${Object.entries(stats.byModel)
                  .map(
                    ([name, data]) => `
                  <tr>
                    <td><code>${name}</code></td>
                    <td>${data.requests.toLocaleString()}</td>
                    <td>$${data.cost.toFixed(4)}</td>
                  </tr>
                `
                  )
                  .join('')}
                ${Object.keys(stats.byModel).length === 0 ? '<tr><td colspan="3">No data yet.</td></tr>' : ''}
              </tbody>
            </table>
          </article>
        </div>
      </div>

      <h2>Cost Distribution</h2>
      <article>
        <canvas id="cost-pie-chart" height="300"></canvas>
      </article>
    `;

    const scripts = `
      (function() {
        var ctx = document.getElementById('cost-pie-chart');
        if (ctx) {
          var modelData = ${JSON.stringify(
            Object.entries(stats.byModel).map(([name, data]) => ({
              name,
              cost: data.cost,
            }))
          )};

          if (modelData.length > 0) {
            new Chart(ctx, {
              type: 'doughnut',
              data: {
                labels: modelData.map(function(m) { return m.name; }),
                datasets: [{
                  data: modelData.map(function(m) { return m.cost; }),
                  backgroundColor: [
                    'rgba(99, 102, 241, 0.7)',
                    'rgba(34, 197, 94, 0.7)',
                    'rgba(249, 115, 22, 0.7)',
                    'rgba(236, 72, 153, 0.7)',
                    'rgba(14, 165, 233, 0.7)',
                  ]
                }]
              },
              options: {
                responsive: true,
                plugins: {
                  legend: { position: 'right' }
                }
              }
            });
          }
        }
      })();
    `;

    return c.html(layout({ title: 'Costs', content, scripts, activeNav: 'costs' }));
  });

  // GET /health - Provider health
  pages.get('/health', async (c) => {
    const health = await connector.getProviderHealth();
    const stats = await connector.getStats();

    const content = `
      <h1>Provider Health</h1>

      <article>
        <table>
          <thead>
            <tr><th>Provider</th><th>Status</th><th>Avg Latency</th><th>Requests</th><th>Error Rate</th><th>Last Checked</th></tr>
          </thead>
          <tbody>
            ${health
              .map((p) => {
                const providerStats = Object.prototype.hasOwnProperty.call(stats.byProvider, p.name)
                  ? stats.byProvider[p.name as ProviderName]
                  : undefined;
                // Error rate not tracked in current stats - show placeholder
                const errorRate = '0.0';
                return `
              <tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td><span class="badge badge-${p.available ? 'ok' : 'error'}">${p.available ? 'Available' : 'Unavailable'}</span></td>
                <td>${p.avgLatencyMs ? `${p.avgLatencyMs.toFixed(0)}ms` : '-'}</td>
                <td>${providerStats?.requests ?? 0}</td>
                <td>${errorRate}%</td>
                <td>${new Date(p.lastChecked).toLocaleTimeString()}</td>
              </tr>
              `;
              })
              .join('')}
            ${health.length === 0 ? '<tr><td colspan="6">No providers configured.</td></tr>' : ''}
          </tbody>
        </table>
      </article>

      <h2>Latency Comparison</h2>
      <article>
        <canvas id="latency-chart" height="200"></canvas>
      </article>
    `;

    const scripts = `
      (function() {
        var ctx = document.getElementById('latency-chart');
        if (ctx) {
          var healthData = ${JSON.stringify(health.map((h) => ({ name: h.name, latency: h.avgLatencyMs || 0 })))};

          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: healthData.map(function(h) { return h.name; }),
              datasets: [{
                label: 'Avg Latency (ms)',
                data: healthData.map(function(h) { return h.latency; }),
                backgroundColor: 'rgba(34, 197, 94, 0.5)',
                borderColor: 'rgb(34, 197, 94)',
                borderWidth: 1
              }]
            },
            options: {
              responsive: true,
              plugins: {
                legend: { display: false }
              },
              scales: {
                y: { beginAtZero: true }
              }
            }
          });
        }
      })();
    `;

    return c.html(layout({ title: 'Health', content, scripts, activeNav: 'health' }));
  });

  return pages;
}

// Helper to render a trace and its children as a hierarchical tree
function renderTraceTree(trace: { name: string; status: string; durationMs?: number; children: Array<{ name: string; status: string; durationMs?: number; children: unknown[] }> }): string {
  const status = trace.status || 'unset';
  const duration = trace.durationMs !== undefined ? `${trace.durationMs}ms` : 'in progress';

  return `
    <div class="span-node">
      <span class="span-name">${escapeHtml(trace.name)}</span>
      <span class="span-duration">${duration}</span>
      <span class="span-status status-${status === 'ok' ? 'ok' : status === 'error' ? 'error' : ''}">${status}</span>
    </div>
    ${
      trace.children && trace.children.length > 0
        ? `<div class="span-children">${trace.children.map((child) => renderTraceTree(child as typeof trace)).join('')}</div>`
        : ''
    }
  `;
}
