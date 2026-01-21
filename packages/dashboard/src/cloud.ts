/**
 * Cloud Dashboard Entry Point
 *
 * Multi-tenant cloud deployment of the LLM Orchestra Dashboard
 * with PostgreSQL storage, JWT authentication, and API key-based ingestion.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createDatabase, type Database } from './db/index.js';
import { PostgresConnector } from './connectors/postgres.js';
import { requireProjectPermission } from './auth/rbac.js';
import { createAuthMiddleware, createApiKeyMiddleware } from './server/middleware/index.js';
import { createAuthRoutes } from './server/routes/auth.js';
import { createAdminRoutes } from './server/routes/admin.js';
import { createIngestRoutes } from './server/routes/ingest.js';
import { createPageRoutes } from './server/routes/pages.js';
import { createSsoRoutes } from './server/routes/sso.js';
import { getRequestMetadata, writeAuditLog } from './utils/audit.js';
import { isSsoEnabled, type SsoConfig } from './auth/sso.js';
import type { Pool } from 'pg';

// ============================================================================
// Types
// ============================================================================

export interface CloudDashboardOptions {
  /** Port to listen on (default: 3737) */
  port?: number;
  /** Hostname to bind to (default: localhost) */
  hostname?: string;
  /** Database configuration */
  database: {
    /** PostgreSQL connection string */
    connectionString: string;
  };
  /** Authentication configuration */
  auth: {
    /** JWT signing secret */
    jwtSecret: string;
  };
  /** Azure AD SSO configuration (optional) */
  sso?: SsoConfig;
  /** Open browser on start (default: false) */
  open?: boolean;
}

export interface CloudDashboard {
  /** The Hono application */
  app: Hono;
  /** The database instance */
  db: Database;
  /** Port the server is running on */
  port: number;
  /** Start the server */
  start(): Promise<void>;
  /** Stop the server and close database connections */
  stop(): Promise<void>;
}

// ============================================================================
// HTML Templates
// ============================================================================

/**
 * Escape HTML entities to prevent XSS - server-side sanitization
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

/**
 * Login page HTML template
 * @param ssoEnabled - Whether SSO is enabled
 */
function getLoginPageHtml(ssoEnabled: boolean = false): string {
  const ssoButton = ssoEnabled
    ? `
    <div class="divider">
      <span>or</span>
    </div>
    <a href="/api/auth/sso/azure" class="btn-sso">
      <svg width="20" height="20" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0V0zm11 0h10v10H11V0zM0 11h10v10H0V11zm11 0h10v10H11V11z" fill="#00a4ef"/></svg>
      Sign in with Microsoft
    </a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - LLM Orchestra Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { width: 100%; max-width: 400px; padding: 2rem; }
    h1 { text-align: center; margin-bottom: 2rem; font-size: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #334155; border-radius: 0.5rem; background: #1e293b; color: #e2e8f0; font-size: 1rem; }
    input:focus { outline: none; border-color: #6366f1; }
    button { width: 100%; padding: 0.75rem; background: #6366f1; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
    button:hover { background: #4f46e5; }
    .error { color: #f87171; font-size: 0.875rem; margin-top: 0.5rem; display: none; }
    .link { text-align: center; margin-top: 1rem; }
    .link a { color: #6366f1; text-decoration: none; }
    .divider { display: flex; align-items: center; margin: 1.5rem 0; }
    .divider::before, .divider::after { content: ''; flex: 1; border-bottom: 1px solid #334155; }
    .divider span { padding: 0 1rem; color: #64748b; font-size: 0.875rem; }
    .btn-sso { display: flex; align-items: center; justify-content: center; gap: 0.75rem; width: 100%; padding: 0.75rem; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; text-decoration: none; transition: border-color 0.2s; }
    .btn-sso:hover { border-color: #6366f1; }
  </style>
</head>
<body>
  <div class="container">
    <h1>LLM Orchestra Dashboard</h1>
    <form id="login-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required>
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required>
      </div>
      <div class="error" id="error"></div>
      <button type="submit">Sign In</button>
    </form>${ssoButton}
    <div class="link">
      <a href="/register">Don't have an account? Register</a>
    </div>
  </div>
  <script>
    document.getElementById('login-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var email = document.getElementById('email').value;
      var password = document.getElementById('password').value;
      var errorEl = document.getElementById('error');

      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password }),
        });

        var data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.error || 'Login failed';
          errorEl.style.display = 'block';
          return;
        }

        window.location.href = '/';
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Register page HTML template
 */
function getRegisterPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register - LLM Orchestra Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { width: 100%; max-width: 400px; padding: 2rem; }
    h1 { text-align: center; margin-bottom: 2rem; font-size: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
    input { width: 100%; padding: 0.75rem; border: 1px solid #334155; border-radius: 0.5rem; background: #1e293b; color: #e2e8f0; font-size: 1rem; }
    input:focus { outline: none; border-color: #6366f1; }
    button { width: 100%; padding: 0.75rem; background: #6366f1; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; margin-top: 1rem; }
    button:hover { background: #4f46e5; }
    .error { color: #f87171; font-size: 0.875rem; margin-top: 0.5rem; display: none; }
    .link { text-align: center; margin-top: 1rem; }
    .link a { color: #6366f1; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Create Account</h1>
    <form id="register-form">
      <div class="form-group">
        <label for="name">Name (optional)</label>
        <input type="text" id="name" name="name">
      </div>
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required>
      </div>
      <div class="form-group">
        <label for="password">Password (min 8 characters)</label>
        <input type="password" id="password" name="password" required minlength="8">
      </div>
      <div class="form-group">
        <label for="orgName">Organization Name</label>
        <input type="text" id="orgName" name="orgName" required>
      </div>
      <div class="error" id="error"></div>
      <button type="submit">Create Account</button>
    </form>
    <div class="link">
      <a href="/login">Already have an account? Sign in</a>
    </div>
  </div>
  <script>
    document.getElementById('register-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var name = document.getElementById('name').value;
      var email = document.getElementById('email').value;
      var password = document.getElementById('password').value;
      var orgName = document.getElementById('orgName').value;
      var errorEl = document.getElementById('error');

      try {
        var res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, email: email, password: password, orgName: orgName }),
        });

        var data = await res.json();

        if (!res.ok) {
          errorEl.textContent = data.error || 'Registration failed';
          errorEl.style.display = 'block';
          return;
        }

        window.location.href = '/';
      } catch (err) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

/**
 * Dashboard home page HTML template (organization/project selector)
 */
function getDashboardHomeHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Orchestra Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .navbar { background: #1e293b; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .logo { font-size: 1.25rem; font-weight: bold; color: #6366f1; }
    .user-menu { display: flex; gap: 1rem; align-items: center; }
    .btn { padding: 0.5rem 1rem; background: #6366f1; color: white; border: none; border-radius: 0.375rem; cursor: pointer; text-decoration: none; font-size: 0.875rem; }
    .btn:hover { background: #4f46e5; }
    .btn-outline { background: transparent; border: 1px solid #334155; color: #94a3b8; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }
    h1 { margin-bottom: 1.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .card { background: #1e293b; padding: 1.5rem; border-radius: 0.5rem; border: 1px solid #334155; }
    .card h2 { font-size: 1.125rem; margin-bottom: 1rem; }
    .project-list { list-style: none; }
    .project-item { padding: 0.75rem; background: #0f172a; border-radius: 0.375rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .project-name { font-weight: 500; }
    .empty { color: #64748b; font-size: 0.875rem; }
    .modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); align-items: center; justify-content: center; }
    .modal.active { display: flex; }
    .modal-content { background: #1e293b; padding: 2rem; border-radius: 0.5rem; width: 100%; max-width: 400px; }
    .modal-content h2 { margin-bottom: 1.5rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; margin-bottom: 0.5rem; font-size: 0.875rem; color: #94a3b8; }
    input, select { width: 100%; padding: 0.75rem; border: 1px solid #334155; border-radius: 0.5rem; background: #0f172a; color: #e2e8f0; font-size: 1rem; }
    .modal-actions { display: flex; gap: 1rem; margin-top: 1.5rem; }
    .loading { text-align: center; padding: 2rem; color: #64748b; }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="logo">LLM Orchestra</div>
    <div class="user-menu">
      <span id="user-email"></span>
      <button class="btn btn-outline" onclick="logout()">Logout</button>
    </div>
  </nav>
  <div class="container">
    <h1>Your Organizations</h1>
    <div id="orgs-container" class="loading">Loading...</div>
  </div>

  <div id="create-project-modal" class="modal">
    <div class="modal-content">
      <h2>Create Project</h2>
      <form id="create-project-form">
        <input type="hidden" id="project-org-id">
        <div class="form-group">
          <label for="project-name">Project Name</label>
          <input type="text" id="project-name" required>
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn">Create</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    var accessToken = null;
    var headers = null;
    var refreshInFlight = null;

    function buildHeaders() {
      return { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
    }

    async function refreshAccessToken() {
      if (refreshInFlight) return refreshInFlight;

      refreshInFlight = fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
        .then(async function(res) {
          if (!res.ok) {
            throw new Error('Unauthorized');
          }
          var data = await res.json();
          accessToken = data.tokens.accessToken;
          headers = buildHeaders();
          return accessToken;
        })
        .catch(function(err) {
          window.location.href = '/login';
          throw err;
        })
        .finally(function() {
          refreshInFlight = null;
        });

      return refreshInFlight;
    }

    async function loadDashboard() {
      try {
        var meRes = await fetch('/api/auth/me', { headers: headers });
        if (!meRes.ok) throw new Error('Failed to get user info');
        var meData = await meRes.json();
        document.getElementById('user-email').textContent = meData.user.email;

        var orgsRes = await fetch('/api/admin/organizations', { headers: headers });
        if (!orgsRes.ok) throw new Error('Failed to get organizations');
        var orgsData = await orgsRes.json();

        renderOrganizations(orgsData.organizations);
      } catch (err) {
        document.getElementById('orgs-container').textContent = 'Failed to load data. Please try again.';
      }
    }

    async function renderOrganizations(orgs) {
      var container = document.getElementById('orgs-container');
      if (orgs.length === 0) {
        container.textContent = 'No organizations yet. Create one to get started.';
        return;
      }

      container.textContent = '';
      var grid = document.createElement('div');
      grid.className = 'grid';

      for (var i = 0; i < orgs.length; i++) {
        var org = orgs[i];
        var projectsRes = await fetch('/api/admin/projects?orgId=' + org.id, { headers: headers });
        var projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] };

        var card = document.createElement('div');
        card.className = 'card';

        var h2 = document.createElement('h2');
        h2.textContent = org.name;
        card.appendChild(h2);

        var roleP = document.createElement('p');
        roleP.style.cssText = 'color: #64748b; font-size: 0.875rem; margin-bottom: 1rem;';
        roleP.textContent = 'Role: ' + org.role;
        card.appendChild(roleP);

        if (projectsData.projects.length > 0) {
          var ul = document.createElement('ul');
          ul.className = 'project-list';
          for (var j = 0; j < projectsData.projects.length; j++) {
            var project = projectsData.projects[j];
            var li = document.createElement('li');
            li.className = 'project-item';

            var span = document.createElement('span');
            span.className = 'project-name';
            span.textContent = project.name;
            li.appendChild(span);

            var link = document.createElement('a');
            link.href = '/project/' + project.id;
            link.className = 'btn';
            link.textContent = 'Open';
            li.appendChild(link);

            ul.appendChild(li);
          }
          card.appendChild(ul);
        } else {
          var emptyP = document.createElement('p');
          emptyP.className = 'empty';
          emptyP.textContent = 'No projects yet.';
          card.appendChild(emptyP);
        }

        if (org.role === 'owner' || org.role === 'admin') {
          var btn = document.createElement('button');
          btn.className = 'btn btn-outline';
          btn.style.cssText = 'margin-top: 1rem; width: 100%;';
          btn.textContent = 'Create Project';
          btn.setAttribute('data-org-id', org.id);
          btn.onclick = function() { openCreateProject(this.getAttribute('data-org-id')); };
          card.appendChild(btn);
        }

        grid.appendChild(card);
      }
      container.appendChild(grid);
    }

    function openCreateProject(orgId) {
      document.getElementById('project-org-id').value = orgId;
      document.getElementById('create-project-modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('create-project-modal').classList.remove('active');
    }

    document.getElementById('create-project-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var orgId = document.getElementById('project-org-id').value;
      var name = document.getElementById('project-name').value;

      try {
        var res = await fetch('/api/admin/projects', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ orgId: orgId, name: name }),
        });

        if (!res.ok) {
          var data = await res.json();
          alert(data.error || 'Failed to create project');
          return;
        }

        closeModal();
        loadDashboard();
      } catch (err) {
        alert('Network error. Please try again.');
      }
    });

    async function logout() {
      try {
        await refreshAccessToken();
        await fetch('/api/auth/logout', { method: 'POST', headers: headers });
      } catch (err) {
        // Ignore logout errors and redirect to login.
      }
      window.location.href = '/login';
    }

    (async function bootstrap() {
      await refreshAccessToken();
      await loadDashboard();
    })();
  </script>
</body>
</html>`;
}

// ============================================================================
// Cloud Dashboard Factory
// ============================================================================

/**
 * Creates a cloud-deployed LLM Orchestra Dashboard
 *
 * This function sets up a complete multi-tenant dashboard with:
 * - PostgreSQL database for persistent storage
 * - JWT authentication for web users
 * - API key authentication for SDK ingestion
 * - Full admin routes for organization/project/team management
 * - Real-time updates via SSE
 *
 * @param options - Configuration options
 * @returns Cloud dashboard instance
 *
 * @example
 * ```typescript
 * const dashboard = await createCloudDashboard({
 *   database: {
 *     connectionString: process.env.DATABASE_URL!,
 *   },
 *   auth: {
 *     jwtSecret: process.env.JWT_SECRET!,
 *   },
 *   port: 3737,
 *   open: true,
 * });
 *
 * await dashboard.start();
 *
 * // Dashboard is now available at http://localhost:3737
 *
 * // Graceful shutdown
 * process.on('SIGTERM', () => dashboard.stop());
 * ```
 */
export async function createCloudDashboard(
  options: CloudDashboardOptions
): Promise<CloudDashboard> {
  const port = options.port ?? 3737;
  const hostname = options.hostname ?? 'localhost';
  const { jwtSecret } = options.auth;

  // Create database connection
  const { db, pool } = createDatabase(options.database.connectionString);

  // Create Hono app
  const app = new Hono();

  // ============================================================================
  // Global Middleware
  // ============================================================================

  // Request logging
  app.use('*', logger());

  // CORS for API routes
  app.use('/api/*', cors());

  // ============================================================================
  // Public Routes (no authentication required)
  // ============================================================================

  // Authentication routes (login, register, refresh, etc.)
  app.route('/api/auth', createAuthRoutes({ db, jwtSecret }));

  // SSO routes (Azure AD / OIDC)
  if (options.sso && isSsoEnabled(options.sso)) {
    app.route('/api/auth/sso', createSsoRoutes({ db, jwtSecret, sso: options.sso }));
  }

  // ============================================================================
  // SDK Ingestion Routes (API key authentication)
  // ============================================================================

  // API key middleware for ingestion
  const apiKeyMiddleware = createApiKeyMiddleware({ db });

  // Ingest routes - authenticated via API key
  app.use('/api/v1/ingest/*', apiKeyMiddleware);
  app.route('/api/v1/ingest', createIngestRoutes({ db }));

  // ============================================================================
  // Admin Routes (JWT authentication)
  // ============================================================================

  // Admin routes already include their own auth middleware internally
  app.route('/api/admin', createAdminRoutes({ db, jwtSecret }));

  // ============================================================================
  // Dashboard API Routes (JWT authentication with project scope)
  // ============================================================================

  // JWT middleware for dashboard API routes
  const jwtMiddleware = createAuthMiddleware({ jwtSecret });

  // Protected API routes for stats, traces, health, requests
  // These need to be scoped to a specific project
  app.use('/api/stats', jwtMiddleware);
  app.use('/api/traces', jwtMiddleware);
  app.use('/api/traces/*', jwtMiddleware);
  app.use('/api/health', jwtMiddleware);
  app.use('/api/requests', jwtMiddleware);
  app.use('/api/events', jwtMiddleware);

  // Project-scoped API routes handler
  // These routes require a projectId query parameter
  app.get('/api/stats', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const permission = await requireProjectPermission(db, userId, projectId, 'stats:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const connector = new PostgresConnector(db, projectId);
    const stats = await connector.getStats();

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'stats.read',
      resourceType: 'stats',
      resourceId: projectId,
      ip,
      userAgent,
    });

    return c.json(stats);
  });

  app.get('/api/traces', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const limit = parseInt(c.req.query('limit') || '50', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const permission = await requireProjectPermission(db, userId, projectId, 'traces:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const connector = new PostgresConnector(db, projectId);
    const traces = await connector.getTraces({ limit, offset });

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'traces.read',
      resourceType: 'trace',
      resourceId: projectId,
      ip,
      userAgent,
      metadata: { limit, offset },
    });

    return c.json({ traces, limit, offset });
  });

  app.get('/api/traces/:id', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const permission = await requireProjectPermission(db, userId, projectId, 'traces:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const id = c.req.param('id');
    const connector = new PostgresConnector(db, projectId);
    const trace = await connector.getTrace(id);

    if (!trace) {
      return c.json({ error: 'Trace not found' }, 404);
    }

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'trace.read',
      resourceType: 'trace',
      resourceId: id,
      ip,
      userAgent,
    });
    return c.json(trace);
  });

  app.get('/api/health', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const permission = await requireProjectPermission(db, userId, projectId, 'health:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const connector = new PostgresConnector(db, projectId);
    const health = await connector.getProviderHealth();

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'health.read',
      resourceType: 'health',
      resourceId: projectId,
      ip,
      userAgent,
    });

    return c.json({ providers: health });
  });

  app.get('/api/requests', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const limit = parseInt(c.req.query('limit') || '20', 10);

    const permission = await requireProjectPermission(db, userId, projectId, 'requests:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const connector = new PostgresConnector(db, projectId);
    const requests = await connector.getRecentRequests(limit);

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'requests.read',
      resourceType: 'request',
      resourceId: projectId,
      ip,
      userAgent,
      metadata: { limit },
    });

    return c.json({ requests });
  });

  // ============================================================================
  // SSE Routes (JWT authentication)
  // ============================================================================

  app.get('/api/events', async (c) => {
    const userId = c.get('userId');
    const projectId = c.req.query('projectId');
    if (!projectId) {
      return c.json({ error: 'projectId query parameter is required' }, 400);
    }

    const permission = await requireProjectPermission(db, userId, projectId, 'stats:read');
    if (!permission) {
      return c.json({ error: 'Project not found or access denied' }, 403);
    }

    const connector = new PostgresConnector(db, projectId);

    // Import streamSSE dynamically to avoid import issues
    const { streamSSE } = await import('hono/streaming');

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'events.subscribe',
      resourceType: 'events',
      resourceId: projectId,
      ip,
      userAgent,
    });

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
        } catch {
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
        } catch {
          isActive = false;
          clearInterval(interval);
        }
      }, 5000);

      // Wait for client disconnect
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

  // ============================================================================
  // Page Routes (JWT authentication for cloud, redirect to login)
  // ============================================================================

  // For cloud deployment, page routes require authentication
  // Check for JWT token in cookie or redirect to login
  app.use('/*', async (c, next) => {
    // Skip API routes
    if (c.req.path.startsWith('/api/')) {
      return next();
    }

    // Check for login/register pages - allow access
    if (c.req.path === '/login' || c.req.path === '/register') {
      return next();
    }

    // Check for JWT token in Authorization header (access) or refresh cookie
    const authHeader = c.req.header('Authorization');
    const cookieHeader = c.req.header('Cookie');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const refreshToken = cookieHeader?.match(/refresh_token=([^;]+)/)?.[1];
    const token = accessToken || refreshToken;

    if (!token) {
      // Redirect to login for page requests
      return c.redirect('/login');
    }

    // Verify token
    const { verifyToken } = await import('./auth/jwt.js');
    const payload = verifyToken(token, jwtSecret);

    if (!payload) {
      return c.redirect('/login');
    }

    if (accessToken && payload.type !== 'access') {
      return c.redirect('/login');
    }
    if (!accessToken && payload.type !== 'refresh') {
      return c.redirect('/login');
    }

    // Set user on context
    c.set('user', payload);
    c.set('userId', payload.sub);

    return next();
  });

  // Login page
  const ssoEnabled = !!(options.sso && isSsoEnabled(options.sso));
  app.get('/login', (c) => {
    return c.html(getLoginPageHtml(ssoEnabled));
  });

  // Register page
  app.get('/register', (c) => {
    return c.html(getRegisterPageHtml());
  });

  // Cloud dashboard home - shows org/project selector
  app.get('/', async (c) => {
    return c.html(getDashboardHomeHtml());
  });

  // Project dashboard page - shows the full dashboard for a specific project
  app.get('/project/:projectId', async (c) => {
    const projectId = c.req.param('projectId');
    const userId = c.get('userId');

    const permission = await requireProjectPermission(db, userId, projectId, 'project:read');
    if (!permission) {
      return c.redirect('/');
    }

    const { ip, userAgent } = getRequestMetadata(c);
    await writeAuditLog(db, {
      orgId: permission.orgId,
      projectId,
      actorType: 'user',
      actorId: userId,
      action: 'dashboard.view',
      resourceType: 'project_dashboard',
      resourceId: projectId,
      ip,
      userAgent,
    });

    // Create a connector for this project
    const connector = new PostgresConnector(db, projectId);

    // Use the existing page routes functionality
    const pageRoutes = createPageRoutes(connector);

    // Get the index page response
    const response = await pageRoutes.fetch(new Request('http://localhost/', { method: 'GET' }));
    const html = await response.text();

    // Modify the HTML to include project context and navigation
    const projectIdDisplay = escapeHtml(projectId.substring(0, 12));
    const modifiedHtml = html
      .replace('</head>', `
        <style>
          .project-nav { background: #1e293b; padding: 0.75rem 1rem; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; }
          .project-nav a { color: #6366f1; text-decoration: none; }
        </style>
        </head>`)
      .replace('<body>', `<body>
        <div class="project-nav">
          <a href="/">&larr; Back to Organizations</a>
          <span>Project: ${projectIdDisplay}...</span>
        </div>`);

    return c.html(modifiedHtml);
  });

  // Project sub-pages (traces, costs, health)
  app.get('/project/:projectId/:page', async (c) => {
    const projectId = c.req.param('projectId');
    const page = c.req.param('page');
    const userId = c.get('userId');

    const permission = await requireProjectPermission(db, userId, projectId, 'project:read');
    if (!permission) {
      return c.redirect('/');
    }

    const connector = new PostgresConnector(db, projectId);
    const pageRoutes = createPageRoutes(connector);

    const response = await pageRoutes.fetch(new Request(`http://localhost/${page}`, { method: 'GET' }));
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  });

  // Project trace detail page
  app.get('/project/:projectId/traces/:traceId', async (c) => {
    const projectId = c.req.param('projectId');
    const traceId = c.req.param('traceId');
    const userId = c.get('userId');

    const permission = await requireProjectPermission(db, userId, projectId, 'project:read');
    if (!permission) {
      return c.redirect('/');
    }

    const connector = new PostgresConnector(db, projectId);
    const pageRoutes = createPageRoutes(connector);

    const response = await pageRoutes.fetch(new Request(`http://localhost/traces/${traceId}`, { method: 'GET' }));
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  });

  // ============================================================================
  // Server Control
  // ============================================================================

  let server: ReturnType<typeof serve> | null = null;

  return {
    app,
    db,
    port,
    async start() {
      return new Promise((resolve) => {
        server = serve(
          {
            fetch: app.fetch,
            port,
            hostname,
          },
          (info) => {
            console.log(`\n🎭 LLM Orchestra Cloud Dashboard running at http://${hostname}:${info.port}\n`);

            if (options.open) {
              import('open').then((m) => m.default(`http://${hostname}:${info.port}`));
            }

            resolve();
          }
        );
      });
    },
    async stop() {
      if (server) {
        server.close();
        server = null;
      }

      // Close database pool
      await (pool as Pool).end();
    },
  };
}
