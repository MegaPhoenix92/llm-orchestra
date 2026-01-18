/**
 * HTML page routes
 */

import { Hono } from 'hono';
import type { DashboardConnector } from '../../connectors/types.js';
import { Layout } from '../views/layout.js';
import { OverviewPage } from '../views/overview.js';
import { TracesPage } from '../views/traces.js';
import { CostsPage } from '../views/costs.js';
import { HealthPage } from '../views/health.js';

export function createPageRoutes(connector: DashboardConnector): Hono {
  const pages = new Hono();

  // GET / - Overview page
  pages.get('/', async (c) => {
    const stats = await connector.getStats();
    const traces = await connector.getTraces({ limit: 10 });
    const health = await connector.getProviderHealth();

    const html = Layout({
      title: 'LLM Orchestra Dashboard',
      activeTab: 'overview',
      children: OverviewPage({ stats, recentTraces: traces, health }),
    });

    return c.html(html as unknown as string);
  });

  // GET /traces - Trace viewer
  pages.get('/traces', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const status = c.req.query('status') as 'ok' | 'error' | undefined;
    const provider = c.req.query('provider');

    const traces = await connector.getTraces({ limit, offset, status, provider });

    const html = Layout({
      title: 'Traces - LLM Orchestra',
      activeTab: 'traces',
      children: TracesPage({ traces, filters: { limit, offset, status, provider } }),
    });

    return c.html(html as unknown as string);
  });

  // GET /traces/:id - Trace detail
  pages.get('/traces/:id', async (c) => {
    const traceId = c.req.param('id');
    const detail = await connector.getTraceDetail(traceId);

    if (!detail) {
      return c.text('Trace not found', 404);
    }

    const html = Layout({
      title: `Trace ${traceId} - LLM Orchestra`,
      activeTab: 'traces',
      children: TracesPage({ traces: [], traceDetail: detail, filters: {} }),
    });

    return c.html(html as unknown as string);
  });

  // GET /costs - Cost breakdown
  pages.get('/costs', async (c) => {
    const stats = await connector.getStats();

    const html = Layout({
      title: 'Costs - LLM Orchestra',
      activeTab: 'costs',
      children: CostsPage({ stats }),
    });

    return c.html(html as unknown as string);
  });

  // GET /health - Provider health
  pages.get('/health', async (c) => {
    const health = await connector.getProviderHealth();

    const html = Layout({
      title: 'Health - LLM Orchestra',
      activeTab: 'health',
      children: HealthPage({ health }),
    });

    return c.html(html as unknown as string);
  });

  return pages;
}
