/**
 * Server-Sent Events for real-time updates
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { DashboardConnector, DashboardEvent, TraceListItem } from '../../connectors/types.js';
import { renderTraceFeedItem } from '../views/fragments.js';

export function createSSERoutes(connector: DashboardConnector): Hono {
  const sse = new Hono();

  // GET /api/events - SSE stream for real-time updates
  sse.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      let isStreamOpen = true;

      const unsubscribe = connector.subscribe(async (event: DashboardEvent) => {
        if (!isStreamOpen) return;
        try {
          if (event.type === 'new_trace') {
            // Send HTML fragment for HTMX sse-swap
            const trace = event.data as TraceListItem;
            await stream.writeSSE({
              event: event.type,
              data: renderTraceFeedItem(trace),
            });
          } else {
            // For other events (stats_update, etc.), send JSON
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event.data),
            });
          }
        } catch {
          // Stream closed, will be cleaned up by onAbort
          isStreamOpen = false;
        }
      });

      // Send initial stats as JSON
      try {
        const stats = await connector.getStats();
        await stream.writeSSE({
          event: 'stats_update',
          data: JSON.stringify(stats),
        });
      } catch {
        // Ignore initial stats error
      }

      // Keep connection alive with heartbeat
      const heartbeat = setInterval(async () => {
        if (!isStreamOpen) return;
        try {
          await stream.writeSSE({
            event: 'heartbeat',
            data: JSON.stringify({ timestamp: Date.now() }),
          });
        } catch {
          isStreamOpen = false;
        }
      }, 30000);

      // Cleanup on disconnect
      stream.onAbort(() => {
        isStreamOpen = false;
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Wait indefinitely (stream stays open)
      await new Promise(() => {});
    });
  });

  return sse;
}
