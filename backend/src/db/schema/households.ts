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
  timezone?: string;
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
    mode: 'local_only' | 'cloudflare' | 'tailscale' | 'custom_domain' | 'basis_remote';
    publicUrl?: string;
    localUrl?: string;
    cloudflare?: {
      tunnelId: string;
      tunnelToken: string;
    };
    /** Basis Remote (paid lastname.home-basis.com tunnel). Written only by the
     *  claim/disconnect routes — never via the generic PATCH. */
    basisRemote?: {
      tenantId: string;
      subdomain: string;
      hostname: string;
      tunnelToken: string;
      relay: { serverAddr: string; serverPort: number };
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
  inventory?: {
    /** basic = manual shopping list, advanced = full inventory tracking with confidence */
    tier: 'basic' | 'advanced';
    /** Confidence thresholds for shopping list behavior. Defaults: high=80, medium=40 */
    confidenceThresholds?: { high: number; medium: number };
    /** Which unit keys are enabled for this household. null = use defaults from units.ts */
    enabledUnits?: string[] | null;
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
