import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import {
  households,
  users,
  calendars,
  inventoryAreas,
} from '../src/db/schema/index';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

async function seed() {
  console.log('Seeding database...');

  const sql = postgres(connectionString!);
  const db = drizzle(sql);

  try {
    // Create demo household
    const householdId = randomUUID();
    await db.insert(households).values({
      id: householdId,
      name: 'Demo Household',
      timezone: 'America/Los_Angeles',
      settings: {
        theme: {
          mode: 'system',
          primaryColor: '#3B82F6',
          accentColor: '#10B981',
        },
        enabledFeatures: {
          calendar: true,
          recipes: true,
          inventory: true,
          tasks: true,
          rewards: true,
          smartHome: false,
          nas: true,
        },
      },
    });
    console.log('Created demo household');

    // Create admin user
    const adminId = randomUUID();
    const passwordHash = await argon2.hash('demo123!', {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    await db.insert(users).values({
      id: adminId,
      householdId,
      email: 'admin@demo.local',
      passwordHash,
      displayName: 'Admin User',
      role: 'admin',
    });
    console.log('Created admin user (admin@demo.local / demo123!)');

    // Create member user
    const memberId = randomUUID();
    await db.insert(users).values({
      id: memberId,
      householdId,
      email: 'member@demo.local',
      passwordHash,
      displayName: 'Family Member',
      role: 'member',
    });
    console.log('Created member user (member@demo.local / demo123!)');

    // Create default calendar
    await db.insert(calendars).values({
      id: randomUUID(),
      householdId,
      name: 'Family Calendar',
      color: '#3B82F6',
      isDefault: true,
      createdBy: adminId,
    });
    console.log('Created default calendar');

    // Create default inventory areas
    const areas = [
      { name: 'Refrigerator', icon: 'refrigerator' },
      { name: 'Freezer', icon: 'snowflake' },
      { name: 'Pantry', icon: 'cabinet' },
      { name: 'Bathroom Cabinet', icon: 'cabinet' },
    ];

    for (const area of areas) {
      await db.insert(inventoryAreas).values({
        id: randomUUID(),
        householdId,
        name: area.name,
        icon: area.icon,
      });
    }
    console.log('Created default inventory areas');

    console.log('\nSeeding completed successfully!');
    console.log('\nDemo credentials:');
    console.log('  Admin: admin@demo.local / demo123!');
    console.log('  Member: member@demo.local / demo123!');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

seed();
