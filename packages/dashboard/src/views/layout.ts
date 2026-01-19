/**
 * Base Layout Template
 * Common HTML wrapper for all dashboard pages
 */

export interface LayoutOptions {
  title: string;
  content: string;
  scripts?: string;
  activeNav?: 'overview' | 'traces' | 'costs' | 'health';
}

export function layout({ title, content, scripts = '', activeNav }: LayoutOptions): string {
  const navClass = (nav: string) => (nav === activeNav ? 'class="active"' : '');

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
    [data-theme="light"] {
      --card-bg: #fff;
      --code-bg: #f4f4f5;
    }
    [data-theme="dark"] {
      --card-bg: var(--pico-card-background-color);
      --code-bg: #1e1e2e;
    }
    .stat-card {
      background: var(--card-bg);
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
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }
    @media (max-width: 992px) {
      .grid-4 { grid-template-columns: repeat(2, 1fr); }
    }
    @media (max-width: 576px) {
      .grid-4, .grid-2 { grid-template-columns: 1fr; }
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
    nav a.active {
      font-weight: bold;
      text-decoration: underline;
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
    .theme-toggle {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.25rem;
      padding: 0.5rem;
    }
    /* Span tree styles */
    .span-tree {
      font-family: monospace;
      font-size: 0.875rem;
    }
    .span-node {
      padding: 0.5rem;
      margin: 0.25rem 0;
      border-left: 3px solid var(--pico-primary);
      background: var(--code-bg);
      border-radius: 0 4px 4px 0;
    }
    .span-node .span-name {
      font-weight: bold;
    }
    .span-node .span-duration {
      color: var(--pico-muted-color);
      margin-left: 1rem;
    }
    .span-node .span-status {
      margin-left: 1rem;
    }
    .span-children {
      margin-left: 1.5rem;
      border-left: 1px dashed var(--pico-muted-border-color);
      padding-left: 0.5rem;
    }
    /* Filter bar */
    .filter-bar {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .filter-bar input, .filter-bar select {
      margin: 0;
    }
    .filter-bar input[type="search"] {
      flex: 1;
      min-width: 200px;
    }
    /* Badge */
    .badge {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      font-size: 0.75rem;
      border-radius: 1rem;
      font-weight: bold;
    }
    .badge-ok { background: #22c55e20; color: #22c55e; }
    .badge-error { background: #ef444420; color: #ef4444; }
  </style>
</head>
<body>
  <nav class="container-fluid">
    <ul>
      <li><strong>LLM Orchestra</strong><span id="live-indicator"></span></li>
    </ul>
    <ul>
      <li><a href="/" ${navClass('overview')}>Overview</a></li>
      <li><a href="/traces" ${navClass('traces')}>Traces</a></li>
      <li><a href="/costs" ${navClass('costs')}>Costs</a></li>
      <li><a href="/health" ${navClass('health')}>Health</a></li>
      <li><button class="theme-toggle" onclick="toggleTheme()" title="Toggle theme">&#127763;</button></li>
    </ul>
  </nav>
  <main class="container">
    ${content}
  </main>
  <script>
    // Theme toggle
    function toggleTheme() {
      var html = document.documentElement;
      var current = html.getAttribute('data-theme');
      var next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('theme', next);
    }

    // Restore saved theme
    (function() {
      var savedTheme = localStorage.getItem('theme');
      if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
      }
    })();

    // SSE connection for real-time updates
    var evtSource = new EventSource('/api/events');

    evtSource.addEventListener('stats', function(e) {
      var stats = JSON.parse(e.data);
      updateStats(stats);
    });

    evtSource.addEventListener('request', function(e) {
      var req = JSON.parse(e.data);
      addRequestToFeed(req);
    });

    evtSource.addEventListener('health', function(e) {
      var health = JSON.parse(e.data);
      updateHealth(health);
    });

    function updateStats(stats) {
      function el(id) { return document.getElementById(id); }
      if (el('stat-requests')) el('stat-requests').textContent = stats.totalRequests.toLocaleString();
      if (el('stat-tokens')) el('stat-tokens').textContent = (stats.totalTokens.input + stats.totalTokens.output).toLocaleString();
      if (el('stat-cost')) el('stat-cost').textContent = '$' + stats.totalCost.toFixed(4);
      if (el('stat-rpm')) el('stat-rpm').textContent = stats.requestsPerMinute;
    }

    function addRequestToFeed(req) {
      var feed = document.getElementById('request-feed');
      if (!feed) return;
      var item = document.createElement('div');
      item.className = 'feed-item';
      var statusSpan = document.createElement('span');
      statusSpan.className = 'status-' + req.status;
      statusSpan.textContent = String.fromCharCode(9679);
      var providerSpan = document.createElement('span');
      providerSpan.className = 'provider';
      providerSpan.textContent = req.provider;
      var modelSpan = document.createElement('span');
      modelSpan.className = 'model';
      modelSpan.textContent = req.model;
      var tokensSpan = document.createElement('span');
      tokensSpan.className = 'tokens';
      tokensSpan.textContent = req.tokens.input + String.fromCharCode(8594) + req.tokens.output;
      var costSpan = document.createElement('span');
      costSpan.className = 'cost';
      costSpan.textContent = '$' + req.cost.toFixed(4);
      var latencySpan = document.createElement('span');
      latencySpan.className = 'latency';
      latencySpan.textContent = req.latencyMs + 'ms';
      item.appendChild(statusSpan);
      item.appendChild(providerSpan);
      item.appendChild(modelSpan);
      item.appendChild(tokensSpan);
      item.appendChild(costSpan);
      item.appendChild(latencySpan);
      feed.insertBefore(item, feed.firstChild);
      if (feed.children.length > 20 && feed.lastChild) feed.removeChild(feed.lastChild);
    }

    function updateHealth(providers) {
      var el = document.getElementById('health-status');
      if (!el) return;
      el.textContent = '';
      providers.forEach(function(p, i) {
        if (i > 0) {
          el.appendChild(document.createTextNode(' | '));
        }
        var span = document.createElement('span');
        span.className = 'status-' + (p.available ? 'ok' : 'error');
        span.textContent = p.name + ': ' + (p.available ? 'OK' : 'Down');
        el.appendChild(span);
      });
    }
    ${scripts}
  </script>
</body>
</html>`;
}
