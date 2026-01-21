#!/bin/sh
set -e

echo "HomeManager Backend Starting..."

# Wait for postgres
echo "Waiting for PostgreSQL..."
until node -e "
  const pg = require('postgres');
  const sql = pg(process.env.DATABASE_URL);
  sql\`SELECT 1\`.then(() => { sql.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "PostgreSQL not ready, waiting..."
  sleep 2
done
echo "PostgreSQL is ready"

# Wait for redis
echo "Waiting for Redis..."
until node -e "
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL);
  redis.ping().then(() => { redis.quit(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "Redis not ready, waiting..."
  sleep 2
done
echo "Redis is ready"

# Run migrations if AUTO_MIGRATE is set
if [ "$AUTO_MIGRATE" = "true" ]; then
  echo "Running database migrations..."
  node dist/scripts/migrate.js || echo "Migration failed or already up to date"
fi

# Start the application
echo "Starting server..."
exec node dist/index.js
