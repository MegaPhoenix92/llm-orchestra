# @llm-orchestra/dashboard

Local observability dashboard for LLM Orchestra - monitor your multi-model AI applications in real-time.

## Features

- **Real-time Stats** - Track requests, tokens, costs, and latency
- **Trace Viewer** - Inspect distributed traces and span hierarchies
- **Cost Breakdown** - Analyze costs by provider and model
- **Provider Health** - Monitor provider availability and performance
- **CLI Commands** - Quick stats from the terminal
- **SSE Updates** - Live updates via Server-Sent Events

## Installation

```bash
npm install @llm-orchestra/dashboard
```

## Quick Start

### Embedded Mode (Recommended)

Attach the dashboard to your running Orchestra instance:

```typescript
import { Orchestra } from 'llm-orchestra';
import { attachDashboard } from '@llm-orchestra/dashboard';

const orchestra = new Orchestra({
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
  openai: { apiKey: process.env.OPENAI_API_KEY },
});

// Attach dashboard on port 3737
const dashboard = attachDashboard(orchestra, {
  port: 3737,
  open: true, // Opens browser automatically
});

// Your application code...
const response = await orchestra.complete({
  model: 'claude-3-opus',
  messages: [{ role: 'user', content: 'Hello!' }],
});

// Dashboard shows real-time stats and traces
```

### CLI Commands

```bash
# Show current stats
npx orchestra-dashboard stats

# List recent traces
npx orchestra-dashboard traces

# View cost breakdown
npx orchestra-dashboard costs

# Check provider health
npx orchestra-dashboard health

# Start standalone server
npx orchestra-dashboard serve --port 3737
```

## Web Dashboard

Navigate to `http://localhost:3737` to access:

| Page | Description |
|------|-------------|
| `/` | Overview with stats cards, live request feed, cost chart |
| `/traces` | List of traces with filtering and search |
| `/traces/:id` | Trace detail with span tree and attributes |
| `/costs` | Cost breakdown by provider and model |
| `/health` | Provider status and latency monitoring |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/stats` | Current statistics |
| `GET /api/traces` | Paginated trace list |
| `GET /api/traces/:id` | Single trace detail |
| `GET /api/health` | Provider health status |
| `GET /api/requests` | Recent requests |
| `GET /api/events` | SSE stream for real-time updates |

## Configuration

```typescript
attachDashboard(orchestra, {
  port: 3737,           // Server port (default: 3737)
  open: true,           // Auto-open browser (default: false)
  host: 'localhost',    // Bind address (default: 'localhost')
});
```

## Tech Stack

- **Hono** - Ultra-lightweight web framework
- **HTMX + SSE** - Real-time updates without React/Vue
- **Chart.js** - Cost visualization charts
- **Pico CSS** - Classless CSS with dark mode
- **Commander.js** - CLI framework

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Development mode with hot reload
npm run dev
```

## Test Coverage

The dashboard includes comprehensive tests:

- `api-routes.test.ts` - REST API endpoint tests
- `sse-routes.test.ts` - Server-Sent Events tests
- `pages-routes.test.ts` - HTML page rendering tests
- `cli-commands.test.ts` - CLI command tests
- `memory-connector.test.ts` - In-memory connector tests
- `html-utils.test.ts` - XSS protection tests

Run tests:

```bash
npm test
```

## License

MIT
