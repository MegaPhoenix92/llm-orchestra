# Cloud Dashboard Deployment

This guide covers deploying the LLM Orchestra cloud dashboard with PostgreSQL,
JWT auth, and API key ingestion.

## Requirements

- Node.js 18+
- PostgreSQL 14+

## Environment Variables

Set these in your process environment:

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - long random string used to sign JWTs
- `PORT` - optional (default: 3737)
- `HOSTNAME` - optional (default: localhost)

## Database Setup

From the repo root:

```bash
npm run db:push -w llm-orchestra-dashboard
```

Or from the package directory:

```bash
cd packages/dashboard
npm run db:push
```

## Start the Cloud Dashboard

Create a small entry file (example: `cloud-server.ts`):

```ts
import { createCloudDashboard } from 'llm-orchestra-dashboard';

const dashboard = await createCloudDashboard({
  port: Number(process.env.PORT || 3737),
  hostname: process.env.HOSTNAME || '0.0.0.0',
  database: { connectionString: process.env.DATABASE_URL! },
  auth: { jwtSecret: process.env.JWT_SECRET! },
});

await dashboard.start();

process.on('SIGTERM', () => dashboard.stop());
process.on('SIGINT', () => dashboard.stop());
```

Run it with:

```bash
npx tsx cloud-server.ts
```

Or build the package and run the compiled output if you prefer production mode.

## Initial Setup (API)

1) Register a user and organization:

```bash
curl -s -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"strong-pass","orgName":"Acme"}' \
  http://localhost:3737/api/auth/register
```

The response includes an access token under `tokens.accessToken`. Save it:

```bash
ACCESS_TOKEN=...
```

2) Create a project:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"orgId":"org_...","name":"prod"}' \
  http://localhost:3737/api/admin/projects
```

3) Create an API key for ingestion:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"prj_...","name":"default","scopes":["ingest"]}' \
  http://localhost:3737/api/admin/api-keys
```

The response includes `apiKey.key` once. Store it securely:

```bash
INGEST_KEY=orch_...
```

4) Send telemetry:

```bash
curl -s -H "Authorization: Bearer $INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{"spans":[{"traceId":"trace-1","spanId":"span-1","name":"demo","startTime":1700000000000,"status":"ok"}]}' \
  http://localhost:3737/api/v1/ingest
```

5) Query traces:

```bash
curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:3737/api/traces?projectId=prj_..."
```

## Deployment Notes

- Run behind HTTPS in production. The refresh cookie is `HttpOnly` with
  `SameSite=Strict` and only marks `Secure` when the request is HTTPS.
- If you terminate TLS at a proxy, pass `X-Forwarded-Proto: https` so cookies
  are set with `Secure`.
- The ingest endpoint enforces a 5 MB body limit and requires `ingest` scope.
