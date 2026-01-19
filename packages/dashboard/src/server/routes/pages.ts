/**
 * Page Routes
 * HTML pages for the dashboard UI
 */

import { Hono } from 'hono';
import type { ProviderName } from 'llm-orchestra';
import type { DashboardConnector } from '../../connectors/types.js';

/**
 * Escape HTML to prevent XSS attacks
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function layout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - LLM Orchestra Dashboard</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --pico-font-size: 15px;
    }
    .stat-card {
      background: var(--pico-card-background-color);
      border-radius: var(--pico-border-radius);
      padding: 1rem 1.5rem;
      text-align: center;
    }
    .stat-card h3 {
      margin: 0;
      font-size: 0.875rem;
      color: var(--pico-muted-color);
      text-transform: uppercase;
    }
    .stat-card .value {
      font-size: 2rem;
      font-weight: bold;
      margin: 0.5rem 0;
    }
    .stat-card .subtext {
      font-size: 0.75rem;
      color: var(--pico-muted-color);
    }
    .grid-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    }
    @media (max-width: 768px) {
      .grid-4 { grid-template-columns: repeat(2, 1fr); }
    }
    .feed-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      border-bottom: 1px solid var(--pico-muted-border-color);
    }
    .feed-item:last-child { border-bottom: none; }
    .feed-item .provider {
      font-weight: bold;
      min-width: 80px;
    }
    .feed-item .model {
      flex: 1;
      font-family: monospace;
      font-size: 0.875rem;
    }
    .feed-item .tokens {
      font-size: 0.875rem;
      color: var(--pico-muted-color);
    }
    .feed-item .cost {
      font-weight: bold;
      color: var(--pico-primary);
    }
    .feed-item .latency {
      font-size: 0.75rem;
      color: var(--pico-muted-color);
    }
    .status-ok { color: #22c55e; }
    .status-error { color: #ef4444; }
    nav ul li strong {
      font-size: 1.25rem;
    }
    #live-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #22c55e;
      border-radius: 50%;
      margin-left: 8px;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body>
  <nav class="container-fluid">
    <ul>
      <li><strong>LLM Orchestra</strong><span id="live-indicator"></span></li>
    </ul>
    <ul>
      <li><a href="/">Overview</a></li>
      <li><a href="/traces">Traces</a></li>
      <li><a href="/costs">Costs</a></li>
      <li><a href="/health">Health</a></li>
    </ul>
  </nav>
  <main class="container">
    ${content}
  </main>
  <script>
    // SSE connection for real-time updates
    const evtSource = new EventSource('/api/events');
    
    evtSource.addEventListener('stats', (e) => {
      const stats = JSON.parse(e.data);
      updateStats(stats);
    });
    
    evtSource.addEventListener('request', (e) => {
      const req = JSON.parse(e.data);
      addRequestToFeed(req);
    });
    
    evtSource.addEventListener('health', (e) => {
      const health = JSON.parse(e.data);
      updateHealth(health);
    });
    
    function updateStats(stats) {
      const el = (id) => document.getElementById(id);
      if (el('stat-requests')) el('stat-requests').textContent = stats.totalRequests.toLocaleString();
      if (el('stat-tokens')) el('stat-tokens').textContent = (stats.totalTokens.input + stats.totalTokens.output).toLocaleString();
      if (el('stat-cost')) el('stat-cost').textContent = '$' + stats.totalCost.toFixed(4);
      if (el('stat-rpm')) el('stat-rpm').textContent = stats.requestsPerMinute;
    }
    
    function addRequestToFeed(req) {
      const feed = document.getElementById('request-feed');
      if (!feed) return;
      const item = document.createElement('div');
      item.className = 'feed-item';
      item.innerHTML = \`
        <span class="status-\${req.status}">●</span>
        <span class="provider">\${req.provider}</span>
        <span class="model">\${req.model}</span>
        <span class="tokens">\${req.tokens.input}→\${req.tokens.output}</span>
        <span class="cost">$\${req.cost.toFixed(4)}</span>
        <span class="latency">\${req.latencyMs}ms</span>
      \`;
      feed.prepend(item);
      if (feed.children.length > 20) feed.lastChild.remove();
    }
    
    function updateHealth(providers) {
      const el = document.getElementById('health-status');
      if (!el) return;
      el.innerHTML = providers.map(p => \`
        <span class="status-\${p.available ? 'ok' : 'error'}">\${p.name}: \${p.available ? 'OK' : 'Down'}</span>
      \`).join(' | ');
    }
  </script>
</body>
</html>`;
}

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
          <div class="subtext" id="health-status">${health.map(p => `${escapeHtml(p.name)}: ${p.available ? 'OK' : 'Down'}`).join(' | ')}</div>
        </article>
      </div>
      
      <h2>Recent Requests</h2>
      <article>
        <div id="request-feed">
          ${requests.map(req => `
            <div class="feed-item">
              <span class="status-${req.status}">●</span>
              <span class="provider">${escapeHtml(req.provider)}</span>
              <span class="model">${escapeHtml(req.model)}</span>
              <span class="tokens">${req.tokens.input}→${req.tokens.output}</span>
              <span class="cost">$${req.cost.toFixed(4)}</span>
              <span class="latency">${req.latencyMs}ms</span>
            </div>
          `).join('')}
          ${requests.length === 0 ? '<p>No requests yet. Make some API calls to see them here.</p>' : ''}
        </div>
      </article>
      
      <h2>Cost by Provider</h2>
      <article>
        <canvas id="cost-chart" height="200"></canvas>
      </article>
      
      <script>
        const ctx = document.getElementById('cost-chart');
        if (ctx) {
          const providerData = ${JSON.stringify(Object.entries(stats.byProvider).map(([name, data]) => ({
            name,
            cost: data.cost,
            requests: data.requests,
          })))};
          
          new Chart(ctx, {
            type: 'bar',
            data: {
              labels: providerData.map(p => p.name),
              datasets: [{
                label: 'Cost ($)',
                data: providerData.map(p => p.cost),
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
      </script>
    `;
    return c.html(layout('Overview', content));
  });

  // GET /traces - Trace viewer
  pages.get('/traces', async (c) => {
    const traces = await connector.getTraces({ limit: 50 });
    
    const content = `
      <h1>Traces</h1>
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
            ${traces.map(trace => `
              <tr>
                <td><a href="/traces/${encodeURIComponent(trace.id)}">${escapeHtml(trace.id.substring(0, 12))}...</a></td>
                <td>${escapeHtml(trace.name)}</td>
                <td>${trace.durationMs ? `${trace.durationMs}ms` : '-'}</td>
                <td class="status-${trace.status}">${trace.status}</td>
                <td>${new Date(trace.startTime).toLocaleTimeString()}</td>
              </tr>
            `).join('')}
            ${traces.length === 0 ? '<tr><td colspan="5">No traces yet.</td></tr>' : ''}
          </tbody>
        </table>
      </article>
    `;
    return c.html(layout('Traces', content));
  });

  // GET /traces/:id - Single trace detail
  pages.get('/traces/:id', async (c) => {
    const id = c.req.param('id');
    const trace = await connector.getTrace(id);
    
    if (!trace) {
      return c.html(layout('Trace Not Found', '<h1>Trace Not Found</h1><p>The requested trace could not be found.</p>'), 404);
    }
    
    const content = `
      <h1>Trace: ${escapeHtml(trace.name)}</h1>
      <article>
        <dl>
          <dt>ID</dt><dd><code>${escapeHtml(trace.id)}</code></dd>
          <dt>Status</dt><dd class="status-${trace.status}">${trace.status}</dd>
          <dt>Duration</dt><dd>${trace.durationMs ? `${trace.durationMs}ms` : 'In progress'}</dd>
          <dt>Started</dt><dd>${new Date(trace.startTime).toISOString()}</dd>
          ${trace.endTime ? `<dt>Ended</dt><dd>${new Date(trace.endTime).toISOString()}</dd>` : ''}
        </dl>
      </article>

      <h2>Attributes</h2>
      <article>
        <pre><code>${escapeHtml(JSON.stringify(trace.attributes, null, 2))}</code></pre>
      </article>

      ${trace.events.length > 0 ? `
        <h2>Events</h2>
        <article>
          <table>
            <thead>
              <tr><th>Name</th><th>Time</th><th>Attributes</th></tr>
            </thead>
            <tbody>
              ${trace.events.map(event => `
                <tr>
                  <td>${escapeHtml(event.name)}</td>
                  <td>${new Date(event.timestamp).toLocaleTimeString()}</td>
                  <td><code>${escapeHtml(JSON.stringify(event.attributes))}</code></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </article>
      ` : ''}

      <p><a href="/traces">← Back to Traces</a></p>
    `;
    return c.html(layout(`Trace: ${escapeHtml(trace.name)}`, content));
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
      
      <h2>By Provider</h2>
      <article>
        <table>
          <thead>
            <tr><th>Provider</th><th>Requests</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th><th>Avg Latency</th></tr>
          </thead>
          <tbody>
            ${Object.entries(stats.byProvider).map(([name, data]) => `
              <tr>
                <td><strong>${name}</strong></td>
                <td>${data.requests.toLocaleString()}</td>
                <td>${data.tokens.input.toLocaleString()}</td>
                <td>${data.tokens.output.toLocaleString()}</td>
                <td>$${data.cost.toFixed(4)}</td>
                <td>${data.avgLatencyMs.toFixed(0)}ms</td>
              </tr>
            `).join('')}
            ${Object.keys(stats.byProvider).length === 0 ? '<tr><td colspan="6">No data yet.</td></tr>' : ''}
          </tbody>
        </table>
      </article>
      
      <h2>By Model</h2>
      <article>
        <table>
          <thead>
            <tr><th>Model</th><th>Requests</th><th>Input Tokens</th><th>Output Tokens</th><th>Cost</th></tr>
          </thead>
          <tbody>
            ${Object.entries(stats.byModel).map(([name, data]) => `
              <tr>
                <td><code>${name}</code></td>
                <td>${data.requests.toLocaleString()}</td>
                <td>${data.tokens.input.toLocaleString()}</td>
                <td>${data.tokens.output.toLocaleString()}</td>
                <td>$${data.cost.toFixed(4)}</td>
              </tr>
            `).join('')}
            ${Object.keys(stats.byModel).length === 0 ? '<tr><td colspan="5">No data yet.</td></tr>' : ''}
          </tbody>
        </table>
      </article>
    `;
    return c.html(layout('Costs', content));
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
            <tr><th>Provider</th><th>Status</th><th>Avg Latency</th><th>Requests</th><th>Last Checked</th></tr>
          </thead>
          <tbody>
            ${health.map(p => {
              const providerStats = Object.prototype.hasOwnProperty.call(stats.byProvider, p.name)
                ? stats.byProvider[p.name as ProviderName]
                : undefined;
              return `
              <tr>
                <td><strong>${escapeHtml(p.name)}</strong></td>
                <td class="status-${p.available ? 'ok' : 'error'}">${p.available ? '● Available' : '● Unavailable'}</td>
                <td>${p.avgLatencyMs ? `${p.avgLatencyMs.toFixed(0)}ms` : '-'}</td>
                <td>${providerStats?.requests ?? 0}</td>
                <td>${new Date(p.lastChecked).toLocaleTimeString()}</td>
              </tr>
              `;
            }).join('')}
            ${health.length === 0 ? '<tr><td colspan="5">No providers configured.</td></tr>' : ''}
          </tbody>
        </table>
      </article>
    `;
    return c.html(layout('Health', content));
  });

  return pages;
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
