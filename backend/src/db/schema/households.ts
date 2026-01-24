import { pgTable, uuid, varchar, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  backupPassphraseHash: text('backup_passphrase_hash'),
  settings: jsonb('settings').$type<HouseholdSettings>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface HouseholdSettings {
  theme?: {
    mode: 'light' | 'dark' | 'system';
    primaryColor: string;
    accentColor: string;
    customCss?: string;
  };
  enabledFeatures?: {
    calendar: boolean;
    recipes: boolean;
    inventory: boolean;
    tasks: boolean;
    rewards: boolean;
    smartHome: boolean;
    nas: boolean;
  };
  storage?: {
    limitGb?: number | null; // null = use system default
    warnAtPercent?: number; // e.g., 80 (future enhancement)
  };
  defaultHiddenPages?: string[];
  mealPlan?: {
    autoShoppingList: boolean;
    lookaheadDays: number;
    notifyOnAdd: boolean;
  };
  remoteAccess?: {
    mode: 'local_only' | 'cloudflare' | 'tailscale' | 'custom_domain';
    publicUrl?: string;
    localUrl?: string;
    cloudflare?: {
      tunnelId: string;
      tunnelToken: string;
    };
    tailscale?: {
      hostname: string;
      tailnet: string;
      magicDnsUrl: string;
    };
    customDomain?: {
      domain: string;
      sslConfigured: boolean;
    };
  };
  roleDefaults?: Record<
    string,
    {
      allowedPages: string[];
      hiddenPages?: string[];
      defaultPermissionLevel: string;
      canCreateResources: boolean;
      resourceTypesAllowed?: string[];
      sessionDurationHours?: number;
    }
  >;
}

export type Household = typeof households.$inferSelect;
export type NewHousehold = typeof households.$inferInsert;
