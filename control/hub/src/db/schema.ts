import { pgTable, uuid, text, boolean, timestamp, bigserial, jsonb, integer } from 'drizzle-orm/pg-core';

// Registered Herdr servers
export const servers = pgTable('servers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  apiKeyHash: text('api_key_hash').notNull().unique(),
  hostname: text('hostname'),
  os: text('os'),
  herdrVersion: text('herdr_version'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  isOnline: boolean('is_online').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// Agent session history
export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  serverId: uuid('server_id').references(() => servers.id),
  workspaceId: text('workspace_id').notNull(),
  paneId: text('pane_id').notNull(),
  agent: text('agent'),
  displayAgent: text('display_agent'),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  cwd: text('cwd'),
});

// Event audit log
export const eventLog = pgTable('event_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  serverId: uuid('server_id').references(() => servers.id),
  eventKind: text('event_kind').notNull(),
  eventData: jsonb('event_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
