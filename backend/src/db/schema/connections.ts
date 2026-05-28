import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { households } from './households.js';
import { users } from './users.js';

export const connectionStatusEnum = pgEnum('connection_status', [
  'pending',
  'active',
  'paused',
  'disconnected',
]);

export const connectedHouseholds = pgTable('connected_households', {
  id: uuid('id').primaryKey().defaultRandom(),
  localHouseholdId: uuid('local_household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  remoteHouseholdId: uuid('remote_household_id').notNull(),
  remoteHouseholdName: varchar('remote_household_name', { length: 255 }).notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  publicKey: text('public_key').notNull(),
  ourPrivateKey: text('our_private_key').notNull(),
  status: connectionStatusEnum('status').notNull().default('pending'),
  connectedAt: timestamp('connected_at'),
  lastSyncAt: timestamp('last_sync_at'),
  lastSeenAt: timestamp('last_seen_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const inviteStatusEnum = pgEnum('invite_status', [
  'pending',
  'accepted',
  'expired',
  'revoked',
]);

export const connectionInvites = pgTable('connection_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  inviteCode: varchar('invite_code', { length: 32 }).notNull().unique(),
  pairingToken: text('pairing_token').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  acceptedByHouseholdId: uuid('accepted_by_household_id'),
  status: inviteStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sharedResourceTypeEnum = pgEnum('shared_resource_type', [
  'calendar',
  'recipe',
  'album',
  'task_list',
]);

export const sharedResources = pgTable('shared_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  resourceType: sharedResourceTypeEnum('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  sharedWithHouseholdId: uuid('shared_with_household_id').notNull(),
  permissionLevel: varchar('permission_level', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
});

export const syncedResources = pgTable('synced_resources', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  sourceHouseholdId: uuid('source_household_id').notNull(),
  resourceType: sharedResourceTypeEnum('resource_type').notNull(),
  sourceResourceId: uuid('source_resource_id').notNull(),
  localResourceId: uuid('local_resource_id').notNull(),
  permissionLevel: varchar('permission_level', { length: 20 }).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  syncCursor: text('sync_cursor'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const syncChangeTypeEnum = pgEnum('sync_change_type', ['create', 'update', 'delete']);

export const syncQueue = pgTable('sync_queue', {
  id: uuid('id').primaryKey().defaultRandom(),
  targetHouseholdId: uuid('target_household_id').notNull(),
  resourceType: sharedResourceTypeEnum('resource_type').notNull(),
  resourceId: uuid('resource_id').notNull(),
  changeType: syncChangeTypeEnum('change_type').notNull(),
  payload: jsonb('payload'),
  attempts: integer('attempts').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const backupStatusEnum = pgEnum('backup_status', ['active', 'paused', 'error']);

export const backupPartners = pgTable('backup_partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  partnerHouseholdId: uuid('partner_household_id').notNull(),
  partnerEndpoint: text('partner_endpoint').notNull(),
  backupCategories: jsonb('backup_categories').$type<string[]>().default([]),
  encryptionKeyHash: text('encryption_key_hash'),
  lastBackupAt: timestamp('last_backup_at'),
  status: backupStatusEnum('backup_status').notNull().default('active'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const backupStorage = pgTable('backup_storage', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  sourceHouseholdId: uuid('source_household_id').notNull(),
  backupCategory: varchar('backup_category', { length: 100 }).notNull(),
  encryptedData: text('encrypted_data').notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  backupTimestamp: timestamp('backup_timestamp').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const passphraseEscrow = pgTable('passphrase_escrow', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  storedByHouseholdId: uuid('stored_by_household_id').notNull(),
  encryptedPassphrase: text('encrypted_passphrase').notNull(),
  hint: varchar('hint', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type ConnectedHousehold = typeof connectedHouseholds.$inferSelect;
export type NewConnectedHousehold = typeof connectedHouseholds.$inferInsert;
export type ConnectionInvite = typeof connectionInvites.$inferSelect;
export type NewConnectionInvite = typeof connectionInvites.$inferInsert;
export type SharedResource = typeof sharedResources.$inferSelect;
export type NewSharedResource = typeof sharedResources.$inferInsert;
export type SyncQueueItem = typeof syncQueue.$inferSelect;
export type NewSyncQueueItem = typeof syncQueue.$inferInsert;
export type BackupPartner = typeof backupPartners.$inferSelect;
export type NewBackupPartner = typeof backupPartners.$inferInsert;
