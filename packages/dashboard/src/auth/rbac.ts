/**
 * RBAC utilities for cloud dashboard access control.
 */

import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { orgMembers, projectMembers, projects } from '../db/schema.js';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export type Permission =
  | 'org:read'
  | 'org:update'
  | 'project:read'
  | 'project:create'
  | 'project:update'
  | 'project:delete'
  | 'team:read'
  | 'team:invite'
  | 'team:remove'
  | 'api_key:read'
  | 'api_key:create'
  | 'api_key:delete'
  | 'audit:read'
  | 'traces:read'
  | 'stats:read'
  | 'health:read'
  | 'requests:read';

const ALL_PERMISSIONS: Permission[] = [
  'org:read',
  'org:update',
  'project:read',
  'project:create',
  'project:update',
  'project:delete',
  'team:read',
  'team:invite',
  'team:remove',
  'api_key:read',
  'api_key:create',
  'api_key:delete',
  'audit:read',
  'traces:read',
  'stats:read',
  'health:read',
  'requests:read',
];

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: new Set(ALL_PERMISSIONS),
  admin: new Set(ALL_PERMISSIONS),
  member: new Set([
    'org:read',
    'project:read',
    'team:read',
    'api_key:read',
    'api_key:create',
    'api_key:delete',
    'traces:read',
    'stats:read',
    'health:read',
    'requests:read',
  ]),
  viewer: new Set([
    'org:read',
    'project:read',
    'traces:read',
    'stats:read',
    'health:read',
    'requests:read',
  ]),
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export async function getOrgRole(
  db: Database,
  userId: string,
  orgId: string
): Promise<Role | null> {
  const membership = await db
    .select({ role: orgMembers.role })
    .from(orgMembers)
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.orgId, orgId)))
    .limit(1);

  if (membership.length === 0) {
    return null;
  }

  return membership[0].role as Role;
}

export async function getProjectRole(
  db: Database,
  userId: string,
  projectId: string
): Promise<Role | null> {
  const membership = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.projectId, projectId)))
    .limit(1);

  if (membership.length === 0) {
    return null;
  }

  return membership[0].role as Role;
}

export async function requireOrgPermission(
  db: Database,
  userId: string,
  orgId: string,
  permission: Permission
): Promise<{ role: Role } | null> {
  const role = await getOrgRole(db, userId, orgId);
  if (!role) {
    return null;
  }

  if (!roleHasPermission(role, permission)) {
    return null;
  }

  return { role };
}

export async function requireProjectPermission(
  db: Database,
  userId: string,
  projectId: string,
  permission: Permission
): Promise<{ role: Role; orgId: string } | null> {
  const projectRows = await db
    .select({ orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (projectRows.length === 0) {
    return null;
  }

  const orgId = projectRows[0].orgId;
  const projectRole = await getProjectRole(db, userId, projectId);
  const role = projectRole ?? (await getOrgRole(db, userId, orgId));

  if (!role || !roleHasPermission(role, permission)) {
    return null;
  }

  return { role, orgId };
}
