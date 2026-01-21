/**
 * Admin Routes for LLM Orchestra Dashboard
 * Handles organization, project, API key, and team management
 * All routes require JWT authentication
 */

import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Database } from '../../db/index.js';
import {
  organizations,
  projects,
  apiKeys,
  orgMembers,
  invitations,
  users,
  auditLogs,
} from '../../db/schema.js';
import { generateApiKey } from '../../auth/index.js';
import { requireOrgPermission, requireProjectPermission, type Role } from '../../auth/rbac.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { generateSlug } from '../../utils/slug.js';
import { getRequestMetadata, writeAuditLog } from '../../utils/audit.js';

export interface AdminRoutesOptions {
  db: Database;
  jwtSecret: string;
}

/**
 * Invitation expiration: 7 days
 */
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create admin routes for the dashboard
 * @param options - Options containing database instance and JWT secret
 * @returns Hono router with admin endpoints
 */
export function createAdminRoutes(options: AdminRoutesOptions): Hono {
  const { db, jwtSecret } = options;
  const admin = new Hono();

  // Apply JWT authentication middleware to all routes
  admin.use('*', createAuthMiddleware({ jwtSecret }));

  // ============================================================================
  // Organization Routes
  // ============================================================================

  /**
   * GET /api/admin/organizations
   * List all organizations the user belongs to
   */
  admin.get('/organizations', async (c) => {
    try {
      const userId = c.get('userId');

      const memberResults = await db
        .select({
          orgId: orgMembers.orgId,
          role: orgMembers.role,
          orgName: organizations.name,
          orgSlug: organizations.slug,
          orgPlan: organizations.plan,
          orgSettings: organizations.settings,
          createdAt: organizations.createdAt,
          updatedAt: organizations.updatedAt,
        })
        .from(orgMembers)
        .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
        .where(eq(orgMembers.userId, userId));

      const orgs = memberResults.map((m) => ({
        id: m.orgId,
        name: m.orgName,
        slug: m.orgSlug,
        plan: m.orgPlan,
        settings: m.orgSettings,
        role: m.role,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      }));

      return c.json({ organizations: orgs });
    } catch (error) {
      console.error('List organizations error:', error);
      return c.json({ error: 'Failed to list organizations' }, 500);
    }
  });

  /**
   * POST /api/admin/organizations
   * Create a new organization
   */
  admin.post('/organizations', async (c) => {
    try {
      const userId = c.get('userId');
      const body = await c.req.json();
      const { name, settings } = body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'Organization name is required' }, 400);
      }

      const orgId = `org_${nanoid(21)}`;
      const memberId = `mem_${nanoid(21)}`;
      const slug = generateSlug(name);

      // Check if slug exists and append random suffix if needed
      const existingOrg = await db
        .select()
        .from(organizations)
        .where(eq(organizations.slug, slug))
        .limit(1);

      const finalSlug = existingOrg.length > 0 ? `${slug}-${nanoid(6)}` : slug;
      const now = new Date();

      // Wrap organization and membership creation in a transaction
      // If either operation fails, both are rolled back
      await db.transaction(async (tx) => {
        // Create organization
        await tx.insert(organizations).values({
          id: orgId,
          name: name.trim(),
          slug: finalSlug,
          plan: 'free',
          settings: settings || null,
          createdAt: now,
          updatedAt: now,
        });

        // Create org membership with owner role
        await tx.insert(orgMembers).values({
          id: memberId,
          orgId,
          userId,
          role: 'owner',
          createdAt: now,
        });
      });

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        actorType: 'user',
        actorId: userId,
        action: 'org.create',
        resourceType: 'organization',
        resourceId: orgId,
        ip,
        userAgent,
        metadata: { name: name.trim(), slug: finalSlug },
      });

      return c.json({
        organization: {
          id: orgId,
          name: name.trim(),
          slug: finalSlug,
          plan: 'free',
          settings: settings || null,
          role: 'owner',
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error('Create organization error:', error);
      return c.json({ error: 'Failed to create organization' }, 500);
    }
  });

  /**
   * GET /api/admin/organizations/:id
   * Get organization details
   */
  admin.get('/organizations/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const orgId = c.req.param('id');

      // Check user has access to this organization
      const permission = await requireOrgPermission(db, userId, orgId, 'org:read');
      if (!permission) {
        return c.json({ error: 'Organization not found or access denied' }, 404);
      }

      const orgResults = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      if (orgResults.length === 0) {
        return c.json({ error: 'Organization not found' }, 404);
      }

      const org = orgResults[0];

      return c.json({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          settings: org.settings,
          role: permission.role,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        },
      });
    } catch (error) {
      console.error('Get organization error:', error);
      return c.json({ error: 'Failed to get organization' }, 500);
    }
  });

  /**
   * PUT /api/admin/organizations/:id
   * Update organization (name, settings)
   * Requires admin or owner role
   */
  admin.put('/organizations/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const orgId = c.req.param('id');
      const body = await c.req.json();
      const { name, settings } = body;

      // Check user has update permission
      const permission = await requireOrgPermission(db, userId, orgId, 'org:update');
      if (!permission) {
        return c.json({ error: 'Organization not found or insufficient permissions' }, 403);
      }

      // Validate at least one field to update
      if (!name && settings === undefined) {
        return c.json({ error: 'No fields to update' }, 400);
      }

      const updateData: Partial<{
        name: string;
        settings: unknown;
        updatedAt: Date;
      }> = {
        updatedAt: new Date(),
      };

      if (name && typeof name === 'string' && name.trim().length > 0) {
        updateData.name = name.trim();
      }

      if (settings !== undefined) {
        updateData.settings = settings;
      }

      await db.update(organizations).set(updateData).where(eq(organizations.id, orgId));

      // Fetch updated organization
      const orgResults = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      const org = orgResults[0];

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        actorType: 'user',
        actorId: userId,
        action: 'org.update',
        resourceType: 'organization',
        resourceId: orgId,
        ip,
        userAgent,
        metadata: { name: org.name, settings: org.settings },
      });

      return c.json({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          settings: org.settings,
          role: permission.role,
          createdAt: org.createdAt,
          updatedAt: org.updatedAt,
        },
      });
    } catch (error) {
      console.error('Update organization error:', error);
      return c.json({ error: 'Failed to update organization' }, 500);
    }
  });

  // ============================================================================
  // Project Routes
  // ============================================================================

  /**
   * GET /api/admin/projects
   * List projects for an organization
   * Query param: orgId (required)
   */
  admin.get('/projects', async (c) => {
    try {
      const userId = c.get('userId');
      const orgId = c.req.query('orgId');

      if (!orgId) {
        return c.json({ error: 'orgId query parameter is required' }, 400);
      }

      // Check user has permission to view projects
      const permission = await requireOrgPermission(db, userId, orgId, 'project:read');
      if (!permission) {
        return c.json({ error: 'Organization not found or access denied' }, 403);
      }

      // Get active projects (not soft-deleted)
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.orgId, orgId));

      return c.json({
        projects: projectResults.map((p) => ({
          id: p.id,
          orgId: p.orgId,
          name: p.name,
          slug: p.slug,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      });
    } catch (error) {
      console.error('List projects error:', error);
      return c.json({ error: 'Failed to list projects' }, 500);
    }
  });

  /**
   * POST /api/admin/projects
   * Create a new project
   * Requires admin or owner role
   */
  admin.post('/projects', async (c) => {
    try {
      const userId = c.get('userId');
      const body = await c.req.json();
      const { orgId, name } = body;

      if (!orgId) {
        return c.json({ error: 'orgId is required' }, 400);
      }

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'Project name is required' }, 400);
      }

      // Check user has permission to create projects
      const permission = await requireOrgPermission(db, userId, orgId, 'project:create');
      if (!permission) {
        return c.json({ error: 'Organization not found or insufficient permissions' }, 403);
      }

      const projectId = `proj_${nanoid(21)}`;
      const slug = generateSlug(name);

      // Check if slug exists in org and append random suffix if needed
      const existingProject = await db
        .select()
        .from(projects)
        .where(and(eq(projects.orgId, orgId), eq(projects.slug, slug)))
        .limit(1);

      const finalSlug = existingProject.length > 0 ? `${slug}-${nanoid(6)}` : slug;
      const now = new Date();

      await db.insert(projects).values({
        id: projectId,
        orgId,
        name: name.trim(),
        slug: finalSlug,
        createdAt: now,
        updatedAt: now,
      });

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        projectId,
        actorType: 'user',
        actorId: userId,
        action: 'project.create',
        resourceType: 'project',
        resourceId: projectId,
        ip,
        userAgent,
        metadata: { name: name.trim(), slug: finalSlug },
      });

      return c.json({
        project: {
          id: projectId,
          orgId,
          name: name.trim(),
          slug: finalSlug,
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error('Create project error:', error);
      return c.json({ error: 'Failed to create project' }, 500);
    }
  });

  /**
   * GET /api/admin/projects/:id
   * Get project details
   */
  admin.get('/projects/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const projectId = c.req.param('id');

      const permission = await requireProjectPermission(
        db,
        userId,
        projectId,
        'project:read'
      );
      if (!permission) {
        return c.json({ error: 'Project not found or access denied' }, 404);
      }

      // Get project
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const project = projectResults[0];

      return c.json({
        project: {
          id: project.id,
          orgId: project.orgId,
          name: project.name,
          slug: project.slug,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
      });
    } catch (error) {
      console.error('Get project error:', error);
      return c.json({ error: 'Failed to get project' }, 500);
    }
  });

  /**
   * PUT /api/admin/projects/:id
   * Update project (name)
   * Requires admin or owner role
   */
  admin.put('/projects/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const projectId = c.req.param('id');
      const body = await c.req.json();
      const { name } = body;

      const permission = await requireProjectPermission(
        db,
        userId,
        projectId,
        'project:update'
      );
      if (!permission) {
        return c.json({ error: 'Project not found or insufficient permissions' }, 403);
      }

      // Get project to check org
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const project = projectResults[0];

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'Project name is required' }, 400);
      }

      const now = new Date();

      await db
        .update(projects)
        .set({
          name: name.trim(),
          updatedAt: now,
        })
        .where(eq(projects.id, projectId));

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId: project.orgId,
        projectId,
        actorType: 'user',
        actorId: userId,
        action: 'project.update',
        resourceType: 'project',
        resourceId: projectId,
        ip,
        userAgent,
        metadata: { name: name.trim() },
      });

      return c.json({
        project: {
          id: project.id,
          orgId: project.orgId,
          name: name.trim(),
          slug: project.slug,
          createdAt: project.createdAt,
          updatedAt: now,
        },
      });
    } catch (error) {
      console.error('Update project error:', error);
      return c.json({ error: 'Failed to update project' }, 500);
    }
  });

  /**
   * DELETE /api/admin/projects/:id
   * Soft delete project (hard delete since schema has no deletedAt)
   * Requires admin or owner role
   * Note: This performs a hard delete as the schema doesn't support soft delete.
   * To implement soft delete, add a deletedAt column to the projects table.
   */
  admin.delete('/projects/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const projectId = c.req.param('id');

      const permission = await requireProjectPermission(
        db,
        userId,
        projectId,
        'project:delete'
      );
      if (!permission) {
        return c.json({ error: 'Project not found or insufficient permissions' }, 403);
      }

      // Get project to check org
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const project = projectResults[0];

      // Note: This is a hard delete. For soft delete, update schema to add deletedAt
      // and change this to: await db.update(projects).set({ deletedAt: new Date() }).where(...)
      await db.delete(projects).where(eq(projects.id, projectId));

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId: project.orgId,
        projectId,
        actorType: 'user',
        actorId: userId,
        action: 'project.delete',
        resourceType: 'project',
        resourceId: projectId,
        ip,
        userAgent,
        metadata: { name: project.name, slug: project.slug },
      });

      return c.json({ success: true, message: 'Project deleted successfully' });
    } catch (error) {
      console.error('Delete project error:', error);
      return c.json({ error: 'Failed to delete project' }, 500);
    }
  });

  // ============================================================================
  // API Key Routes
  // ============================================================================

  /**
   * GET /api/admin/api-keys
   * List API keys for a project
   * Query param: projectId (required)
   */
  admin.get('/api-keys', async (c) => {
    try {
      const userId = c.get('userId');
      const projectId = c.req.query('projectId');

      if (!projectId) {
        return c.json({ error: 'projectId query parameter is required' }, 400);
      }

      const permission = await requireProjectPermission(
        db,
        userId,
        projectId,
        'api_key:read'
      );
      if (!permission) {
        return c.json({ error: 'Project not found or access denied' }, 404);
      }

      // Get project to check org
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'Project not found' }, 404);
      }

      // Get API keys for project
      const keyResults = await db
        .select({
          id: apiKeys.id,
          projectId: apiKeys.projectId,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          scopes: apiKeys.scopes,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.projectId, projectId));

      return c.json({
        apiKeys: keyResults.map((k) => ({
          id: k.id,
          projectId: k.projectId,
          name: k.name,
          prefix: k.prefix,
          scopes: k.scopes,
          lastUsedAt: k.lastUsedAt,
          expiresAt: k.expiresAt,
          createdAt: k.createdAt,
        })),
      });
    } catch (error) {
      console.error('List API keys error:', error);
      return c.json({ error: 'Failed to list API keys' }, 500);
    }
  });

  /**
   * POST /api/admin/api-keys
   * Create a new API key
   * Returns full key only once
   * Requires member or higher role
   */
  admin.post('/api-keys', async (c) => {
    try {
      const userId = c.get('userId');
      const body = await c.req.json();
      const { projectId, name, scopes, expiresAt } = body;

      if (!projectId) {
        return c.json({ error: 'projectId is required' }, 400);
      }

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return c.json({ error: 'API key name is required' }, 400);
      }

      const permission = await requireProjectPermission(
        db,
        userId,
        projectId,
        'api_key:create'
      );
      if (!permission) {
        return c.json({ error: 'Project not found or insufficient permissions' }, 403);
      }

      // Get project to check org
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'Project not found' }, 404);
      }

      const project = projectResults[0];

      // Generate API key
      const keyId = `key_${nanoid(21)}`;
      const { key, prefix, hashedKey } = generateApiKey();
      const now = new Date();

      // Parse expiration if provided
      let parsedExpiresAt: Date | null = null;
      if (expiresAt) {
        parsedExpiresAt = new Date(expiresAt);
        if (isNaN(parsedExpiresAt.getTime())) {
          return c.json({ error: 'Invalid expiresAt date format' }, 400);
        }
      }

      await db.insert(apiKeys).values({
        id: keyId,
        projectId,
        name: name.trim(),
        hashedKey,
        prefix,
        scopes: Array.isArray(scopes) ? scopes : ['ingest'],
        expiresAt: parsedExpiresAt,
        createdAt: now,
      });

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId: project.orgId,
        projectId,
        actorType: 'user',
        actorId: userId,
        action: 'api_key.create',
        resourceType: 'api_key',
        resourceId: keyId,
        ip,
        userAgent,
        metadata: { name: name.trim(), prefix, scopes: Array.isArray(scopes) ? scopes : ['ingest'] },
      });

      return c.json({
        apiKey: {
          id: keyId,
          projectId,
          name: name.trim(),
          key, // Full key - shown only once
          prefix,
          scopes: Array.isArray(scopes) ? scopes : ['ingest'],
          expiresAt: parsedExpiresAt,
          createdAt: now,
        },
        message: 'Store this API key securely. It will not be shown again.',
      });
    } catch (error) {
      console.error('Create API key error:', error);
      return c.json({ error: 'Failed to create API key' }, 500);
    }
  });

  /**
   * DELETE /api/admin/api-keys/:id
   * Delete an API key
   * Requires member or higher role
   */
  admin.delete('/api-keys/:id', async (c) => {
    try {
      const userId = c.get('userId');
      const keyId = c.req.param('id');

      const keyResults = await db
        .select({
          id: apiKeys.id,
          projectId: apiKeys.projectId,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
        })
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId))
        .limit(1);

      if (keyResults.length === 0) {
        return c.json({ error: 'API key not found' }, 404);
      }

      const apiKey = keyResults[0];

      const permission = await requireProjectPermission(
        db,
        userId,
        apiKey.projectId,
        'api_key:delete'
      );
      if (!permission) {
        return c.json({ error: 'API key not found or insufficient permissions' }, 403);
      }

      // Get API key with project info
      const projectResults = await db
        .select()
        .from(projects)
        .where(eq(projects.id, apiKey.projectId))
        .limit(1);

      if (projectResults.length === 0) {
        return c.json({ error: 'API key not found' }, 404);
      }

      const project = projectResults[0];

      await db.delete(apiKeys).where(eq(apiKeys.id, keyId));

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId: project.orgId,
        projectId: apiKey.projectId,
        actorType: 'user',
        actorId: userId,
        action: 'api_key.delete',
        resourceType: 'api_key',
        resourceId: keyId,
        ip,
        userAgent,
        metadata: { name: apiKey.name, prefix: apiKey.prefix },
      });

      return c.json({ success: true, message: 'API key deleted successfully' });
    } catch (error) {
      console.error('Delete API key error:', error);
      return c.json({ error: 'Failed to delete API key' }, 500);
    }
  });

  // ============================================================================
  // Team Routes
  // ============================================================================

  /**
   * GET /api/admin/team
   * List team members for an organization
   * Query param: orgId (required)
   */
  admin.get('/team', async (c) => {
    try {
      const userId = c.get('userId');
      const orgId = c.req.query('orgId');

      if (!orgId) {
        return c.json({ error: 'orgId query parameter is required' }, 400);
      }

      const permission = await requireOrgPermission(db, userId, orgId, 'team:read');
      if (!permission) {
        return c.json({ error: 'Organization not found or access denied' }, 403);
      }

      // Get all members with user info
      const memberResults = await db
        .select({
          id: orgMembers.id,
          userId: orgMembers.userId,
          role: orgMembers.role,
          createdAt: orgMembers.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(orgMembers)
        .innerJoin(users, eq(users.id, orgMembers.userId))
        .where(eq(orgMembers.orgId, orgId));

      // Get pending invitations
      const invitationResults = await db
        .select({
          id: invitations.id,
          email: invitations.email,
          role: invitations.role,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.orgId, orgId));

      return c.json({
        members: memberResults.map((m) => ({
          id: m.id,
          userId: m.userId,
          name: m.userName,
          email: m.userEmail,
          role: m.role,
          createdAt: m.createdAt,
        })),
        pendingInvitations: invitationResults.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expiresAt: i.expiresAt,
          createdAt: i.createdAt,
        })),
      });
    } catch (error) {
      console.error('List team error:', error);
      return c.json({ error: 'Failed to list team members' }, 500);
    }
  });

  /**
   * POST /api/admin/team/invite
   * Send an invitation to join the organization
   * Requires admin or owner role
   */
  admin.post('/team/invite', async (c) => {
    try {
      const userId = c.get('userId');
      const body = await c.req.json();
      const { orgId, email, role } = body;

      if (!orgId) {
        return c.json({ error: 'orgId is required' }, 400);
      }

      if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return c.json({ error: 'Valid email is required' }, 400);
      }

      // Validate role
      const validRoles: Role[] = ['admin', 'member', 'viewer'];
      const inviteRole: Role = validRoles.includes(role as Role) ? (role as Role) : 'member';

      const permission = await requireOrgPermission(db, userId, orgId, 'team:invite');
      if (!permission) {
        return c.json({ error: 'Organization not found or insufficient permissions' }, 403);
      }

      // Check if user already exists in org
      const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);

      if (existingUser.length > 0) {
        const existingMember = await db
          .select()
          .from(orgMembers)
          .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, existingUser[0].id)))
          .limit(1);

        if (existingMember.length > 0) {
          return c.json({ error: 'User is already a member of this organization' }, 409);
        }
      }

      // Check for existing pending invitation
      const existingInvite = await db
        .select()
        .from(invitations)
        .where(and(eq(invitations.orgId, orgId), eq(invitations.email, email)))
        .limit(1);

      if (existingInvite.length > 0) {
        return c.json({ error: 'An invitation has already been sent to this email' }, 409);
      }

      // Create invitation
      const inviteId = `inv_${nanoid(21)}`;
      const token = nanoid(32);
      const now = new Date();
      const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_MS);

      await db.insert(invitations).values({
        id: inviteId,
        orgId,
        email: email.toLowerCase(),
        role: inviteRole,
        token,
        expiresAt,
        createdAt: now,
      });

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        actorType: 'user',
        actorId: userId,
        action: 'team.invite',
        resourceType: 'invitation',
        resourceId: inviteId,
        ip,
        userAgent,
        metadata: { email: email.toLowerCase(), role: inviteRole },
      });

      return c.json({
        invitation: {
          id: inviteId,
          email: email.toLowerCase(),
          role: inviteRole,
          expiresAt,
          createdAt: now,
        },
        // In a real implementation, you would send an email with this token
        inviteToken: token,
      });
    } catch (error) {
      console.error('Send invitation error:', error);
      return c.json({ error: 'Failed to send invitation' }, 500);
    }
  });

  /**
   * DELETE /api/admin/team/:userId
   * Remove a member from the organization
   * Requires admin or owner role
   * Cannot remove the last owner
   */
  admin.delete('/team/:userId', async (c) => {
    try {
      const currentUserId = c.get('userId');
      const targetUserId = c.req.param('userId');
      const orgId = c.req.query('orgId');

      if (!orgId) {
        return c.json({ error: 'orgId query parameter is required' }, 400);
      }

      const permission = await requireOrgPermission(db, currentUserId, orgId, 'team:remove');
      if (!permission) {
        return c.json({ error: 'Organization not found or insufficient permissions' }, 403);
      }

      // Get target member info
      const targetMember = await db
        .select()
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)))
        .limit(1);

      if (targetMember.length === 0) {
        return c.json({ error: 'Member not found in this organization' }, 404);
      }

      const targetRole = targetMember[0].role as Role;

      // Only owners can remove admins
      if (targetRole === 'admin' && permission.role !== 'owner') {
        return c.json({ error: 'Only owners can remove admins' }, 403);
      }

      // Cannot remove an owner
      if (targetRole === 'owner') {
        return c.json({ error: 'Cannot remove an owner from the organization' }, 403);
      }

      // Cannot remove yourself (use leave org instead)
      if (targetUserId === currentUserId) {
        return c.json({ error: 'Cannot remove yourself. Use leave organization instead.' }, 400);
      }

      await db
        .delete(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, targetUserId)));

      const { ip, userAgent } = getRequestMetadata(c);
      await writeAuditLog(db, {
        orgId,
        actorType: 'user',
        actorId: currentUserId,
        action: 'team.remove',
        resourceType: 'org_member',
        resourceId: targetMember[0].id,
        ip,
        userAgent,
        metadata: { targetUserId, targetRole },
      });

      return c.json({ success: true, message: 'Member removed successfully' });
    } catch (error) {
      console.error('Remove member error:', error);
      return c.json({ error: 'Failed to remove member' }, 500);
    }
  });

  // ============================================================================
  // Audit Log Routes
  // ============================================================================

  /**
   * GET /api/admin/audit-logs
   * List audit logs for an organization
   * Query params: orgId (required), projectId, action, actorId, resourceType, limit, offset
   */
  admin.get('/audit-logs', async (c) => {
    try {
      const userId = c.get('userId');
      const orgId = c.req.query('orgId');

      if (!orgId) {
        return c.json({ error: 'orgId query parameter is required' }, 400);
      }

      const permission = await requireOrgPermission(db, userId, orgId, 'audit:read');
      if (!permission) {
        return c.json({ error: 'Organization not found or insufficient permissions' }, 403);
      }

      const projectId = c.req.query('projectId');
      const action = c.req.query('action');
      const actorId = c.req.query('actorId');
      const resourceType = c.req.query('resourceType');
      const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
      const offset = parseInt(c.req.query('offset') || '0', 10);

      const conditions = [eq(auditLogs.orgId, orgId)];
      if (projectId) conditions.push(eq(auditLogs.projectId, projectId));
      if (action) conditions.push(eq(auditLogs.action, action));
      if (actorId) conditions.push(eq(auditLogs.actorId, actorId));
      if (resourceType) conditions.push(eq(auditLogs.resourceType, resourceType));

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      const logs = await db
        .select()
        .from(auditLogs)
        .where(whereClause)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({ auditLogs: logs, limit, offset });
    } catch (error) {
      console.error('List audit logs error:', error);
      return c.json({ error: 'Failed to list audit logs' }, 500);
    }
  });

  return admin;
}
