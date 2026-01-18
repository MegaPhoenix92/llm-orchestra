/**
 * @llm-orchestra/dashboard
 * Local observability dashboard for LLM Orchestra
 */

// Main exports
export {
  attachDashboard,
  createDashboardServer,
  createDashboardServerWithConnector,
  createDashboardApp,
} from './server/app.js';
export type { DashboardServer } from './server/app.js';

// Connector exports
export { MemoryConnector, RingBuffer } from './connectors/memory.js';
export type {
  DashboardConnector,
  DashboardConfig,
  DashboardStats,
  DashboardEvent,
  DashboardEventType,
  TraceListItem,
  TraceDetail,
  TraceQueryOptions,
  ProviderHealth,
  ProviderStats,
  ModelStats,
} from './connectors/types.js';
