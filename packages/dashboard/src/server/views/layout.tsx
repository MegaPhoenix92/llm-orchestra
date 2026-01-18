/**
 * Base layout for all pages
 * Uses Pico CSS for classless styling and HTMX for interactivity
 */

import type { FC, PropsWithChildren } from 'hono/jsx';

interface LayoutProps {
  title: string;
  activeTab: 'overview' | 'traces' | 'costs' | 'health';
  children: unknown;
}

export const Layout: FC<LayoutProps> = ({ title, activeTab, children }) => {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        {/* Pico CSS for classless styling */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
        />
        {/* HTMX for dynamic updates */}
        <script src="https://unpkg.com/htmx.org@2.0.0"></script>
        {/* SSE extension */}
        <script src="https://unpkg.com/htmx-ext-sse@2.0.0/sse.js"></script>
        {/* Chart.js for charts */}
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>{`
          :root {
            --pico-font-size: 16px;
          }
          body {
            min-height: 100vh;
          }
          .nav-container {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .nav-tabs {
            display: flex;
            gap: 1rem;
            list-style: none;
            padding: 0;
            margin: 0;
          }
          .nav-tabs li a {
            text-decoration: none;
            padding: 0.5rem 1rem;
            border-radius: 4px;
          }
          .nav-tabs li a.active {
            background: var(--pico-primary);
            color: var(--pico-primary-inverse);
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
          }
          .stat-card {
            background: var(--pico-card-background-color);
            padding: 1.5rem;
            border-radius: 8px;
            text-align: center;
          }
          .stat-value {
            font-size: 2rem;
            font-weight: bold;
            color: var(--pico-primary);
          }
          .stat-label {
            color: var(--pico-muted-color);
            font-size: 0.875rem;
          }
          .trace-list {
            width: 100%;
          }
          .status-ok {
            color: #22c55e;
          }
          .status-error {
            color: #ef4444;
          }
          .status-unset {
            color: #94a3b8;
          }
          .provider-badge {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 500;
          }
          .provider-anthropic { background: #d97706; color: white; }
          .provider-openai { background: #10a37f; color: white; }
          .provider-google { background: #4285f4; color: white; }
          .provider-mistral { background: #ff7000; color: white; }
          .provider-multiple { background: #6b7280; color: white; }
          .provider-unknown { background: #6b7280; color: white; }
          .span-tree {
            font-family: monospace;
            padding: 1rem;
            background: var(--pico-card-background-color);
            border-radius: 8px;
          }
          .span-item {
            padding: 0.5rem;
            border-left: 2px solid var(--pico-muted-border-color);
            margin-left: 1rem;
          }
          .chart-container {
            position: relative;
            height: 300px;
            margin-bottom: 2rem;
          }
          .health-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
          }
          .health-card {
            background: var(--pico-card-background-color);
            padding: 1.5rem;
            border-radius: 8px;
          }
          .health-status {
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }
          .health-indicator {
            width: 12px;
            height: 12px;
            border-radius: 50%;
          }
          .health-indicator.available { background: #22c55e; }
          .health-indicator.unavailable { background: #ef4444; }
          #live-feed {
            max-height: 400px;
            overflow-y: auto;
          }
          .feed-item {
            padding: 0.5rem;
            border-bottom: 1px solid var(--pico-muted-border-color);
            font-size: 0.875rem;
          }
          .theme-toggle {
            cursor: pointer;
            background: none;
            border: none;
            font-size: 1.25rem;
          }
        `}</style>
      </head>
      <body>
        <nav class="container">
          <div class="nav-container">
            <div>
              <a href="/">
                <strong>LLM Orchestra</strong>
              </a>
            </div>
            <ul class="nav-tabs">
              <li>
                <a href="/" class={activeTab === 'overview' ? 'active' : ''}>
                  Overview
                </a>
              </li>
              <li>
                <a href="/traces" class={activeTab === 'traces' ? 'active' : ''}>
                  Traces
                </a>
              </li>
              <li>
                <a href="/costs" class={activeTab === 'costs' ? 'active' : ''}>
                  Costs
                </a>
              </li>
              <li>
                <a href="/health" class={activeTab === 'health' ? 'active' : ''}>
                  Health
                </a>
              </li>
            </ul>
            <button
              class="theme-toggle"
              onclick="document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'"
              aria-label="Toggle theme"
            >
              🌓
            </button>
          </div>
        </nav>
        <main class="container">{children}</main>
        <footer class="container">
          <small>
            LLM Orchestra Dashboard | Real-time observability for multi-model AI
          </small>
        </footer>
      </body>
    </html>
  );
};
