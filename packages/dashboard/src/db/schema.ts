/**
 * Database Schema for LLM Orchestra Dashboard
 * Drizzle ORM schema definitions for multi-tenancy and observability
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  numeric,
  unique,
} from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ============================================================================
// Multi-Tenancy Tables
// ============================================================================

/**
 * Organizations - Top-level tenant
 */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(), // prefix 'org_'
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  plan: text('plan').default('free'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;

/**
 * Projects - Scoped within organization
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(), // prefix 'proj_'
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    orgSlugUnique: unique('projects_org_slug_unique').on(table.orgId, table.slug),
  })
);

export type Project = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;

/**
 * Users - Web dashboard users
 */
export const users = pgTable('users', {
  id: text('id').primaryKey(), // prefix 'usr_'
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

/**
 * Organization Members - User-org relationship
 */
export const orgMembers = pgTable(
  'org_members',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    orgUserUnique: unique('org_members_org_user_unique').on(table.orgId, table.userId),
  })
);

export type OrgMember = InferSelectModel<typeof orgMembers>;
export type NewOrgMember = InferInsertModel<typeof orgMembers>;

/**
 * API Keys - SDK authentication
 *
 * Note on prefix uniqueness: The prefix column uses a unique constraint
 * to prevent collisions at the database level. While the 16-character prefix
 * (orch_ + 11 random chars from 64-char alphabet = 64^11 combinations)
 * makes collisions virtually impossible, the constraint provides:
 * 1. Database-level guarantee of uniqueness
 * 2. Efficient index for prefix lookups
 * 3. Clear error on the extremely rare collision attempt
 */
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(), // prefix 'key_'
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  hashedKey: text('hashed_key').notNull(),
  prefix: text('prefix').notNull().unique(), // for lookup (e.g., 'orch_xxxxxxxxxxx')
  scopes: text('scopes').array().default(['ingest']),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type ApiKey = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

/**
 * Sessions - JWT refresh tokens
 */
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  hashedToken: text('hashed_token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Session = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

/**
 * Invitations - Team invites
 */
export const invitations = pgTable('invitations', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).default('member'),
  token: text('token').unique().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Invitation = InferSelectModel<typeof invitations>;
export type NewInvitation = InferInsertModel<typeof invitations>;

// ============================================================================
// Observability Tables
// ============================================================================

/**
 * Traces - Root spans with aggregated metrics
 * Note: traceId (OTLP trace ID) is NOT globally unique - it's only unique within a project.
 * The composite (projectId, traceId) forms the true unique identity.
 * We use a surrogate primary key (id) to avoid PK violations when two projects have the same traceId.
 */
export const traces = pgTable(
  'traces',
  {
    id: text('id').primaryKey(), // Surrogate PK with prefix 'trc_'
    traceId: text('trace_id').notNull(), // OTLP trace ID - unique per project only
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name'),
    status: text('status', { enum: ['ok', 'error', 'unset'] }),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    duration: integer('duration'), // in milliseconds
    totalCost: numeric('total_cost', { precision: 10, scale: 6 }),
    totalTokensIn: integer('total_tokens_in'),
    totalTokensOut: integer('total_tokens_out'),
    provider: text('provider'),
    model: text('model'),
    attributes: jsonb('attributes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    // Composite unique constraint: traceId is only unique within a project
    projectTraceUnique: unique('traces_project_trace_unique').on(
      table.projectId,
      table.traceId
    ),
  })
);

export type Trace = InferSelectModel<typeof traces>;
export type NewTrace = InferInsertModel<typeof traces>;

/**
 * Spans - Individual operations
 * Note: spanId (OTLP span ID) is NOT globally unique - it's only unique within a trace.
 * The composite (traceId, spanId) forms the true unique identity.
 * We use a surrogate primary key (id) to avoid PK violations when two traces have the same spanId.
 */
export const spans = pgTable(
  'spans',
  {
    id: text('id').primaryKey(), // Surrogate PK with prefix 'spn_'
    spanId: text('span_id').notNull(), // OTLP span ID - unique per trace only
    traceId: text('trace_id').notNull(), // OTLP trace ID - links to traces via composite unique
    parentId: text('parent_id'),
    name: text('name').notNull(),
    startTime: timestamp('start_time').notNull(),
    endTime: timestamp('end_time'),
    duration: integer('duration'),
    status: text('status'),
    attributes: jsonb('attributes'),
    provider: text('provider'),
    model: text('model'),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    cost: numeric('cost', { precision: 10, scale: 6 }),
  },
  (table) => ({
    // Composite unique constraint: spanId is only unique within a trace
    traceSpanUnique: unique('spans_trace_span_unique').on(table.traceId, table.spanId),
  })
);

export type Span = InferSelectModel<typeof spans>;
export type NewSpan = InferInsertModel<typeof spans>;

/**
 * Span Events - Events within spans
 * Note: spanId here references the OTLP span ID, not the surrogate id.
 * Cascading deletes are handled at the application level since we removed the FK constraint.
 */
export const spanEvents = pgTable('span_events', {
  id: text('id').primaryKey(),
  spanId: text('span_id').notNull(), // OTLP span ID - links to spans via traceSpanUnique
  name: text('name').notNull(),
  timestamp: timestamp('timestamp').notNull(),
  attributes: jsonb('attributes'),
});

export type SpanEvent = InferSelectModel<typeof spanEvents>;
export type NewSpanEvent = InferInsertModel<typeof spanEvents>;

/**
 * Stats Snapshots - Hourly aggregated stats
 */
export const statsSnapshots = pgTable(
  'stats_snapshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp').notNull(),
    totalRequests: integer('total_requests'),
    totalTokensIn: integer('total_tokens_in'),
    totalTokensOut: integer('total_tokens_out'),
    totalCost: numeric('total_cost', { precision: 10, scale: 6 }),
    averageLatency: integer('average_latency'),
    errorCount: integer('error_count'),
  },
  (table) => ({
    projectTimestampUnique: unique('stats_snapshots_project_timestamp_unique').on(
      table.projectId,
      table.timestamp
    ),
  })
);

export type StatsSnapshot = InferSelectModel<typeof statsSnapshots>;
export type NewStatsSnapshot = InferInsertModel<typeof statsSnapshots>;

// ============================================================================
// Table Exports (for use in queries and migrations)
// ============================================================================

export const schema = {
  // Multi-tenancy
  organizations,
  projects,
  users,
  orgMembers,
  apiKeys,
  sessions,
  invitations,
  // Observability
  traces,
  spans,
  spanEvents,
  statsSnapshots,
};
