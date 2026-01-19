/**
 * SSE Routes
 * Server-Sent Events for real-time dashboard updates
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { DashboardConnector } from '../../connectors/types.js';

export function createSseRoutes(connector: DashboardConnector): Hono {
  const sse = new Hono();

  // GET /api/events - SSE stream for real-time updates
  sse.get('/events', async (c) => {
    return streamSSE(c, async (stream) => {
      let isActive = true;

      // Send initial stats
      const stats = await connector.getStats();
      await stream.writeSSE({
        event: 'stats',
        data: JSON.stringify(stats),
      });

      // Send initial health
      const health = await connector.getProviderHealth();
      await stream.writeSSE({
        event: 'health',
        data: JSON.stringify(health),
      });

      // Subscribe to events
      const unsubscribe = connector.subscribe(async (event) => {
        if (!isActive) return;
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        } catch (error) {
          // Client disconnected
          isActive = false;
        }
      });

      // Keep connection alive with periodic stats updates
      const interval = setInterval(async () => {
        if (!isActive) {
          clearInterval(interval);
          return;
        }
        try {
          const currentStats = await connector.getStats();
          await stream.writeSSE({
            event: 'stats',
            data: JSON.stringify(currentStats),
          });
        } catch (error) {
          isActive = false;
          clearInterval(interval);
        }
      }, 5000);

      // Wait for client disconnect - use a Promise that resolves on abort
      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          isActive = false;
          clearInterval(interval);
          unsubscribe();
          resolve();
        });
      });
    });
  });

  return sse;
}
