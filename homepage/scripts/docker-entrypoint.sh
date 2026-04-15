#!/bin/sh
set -e

DB_HOST="${DB_HOST:-db}"
DB_PORT="${DB_PORT:-5432}"

echo "Waiting for database at $DB_HOST:$DB_PORT..."
until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
  echo "Database not ready, retrying in 2s..."
  sleep 2
done
echo "Database is ready."

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy || echo "Migration skipped (prisma cli not found in standalone)"

echo "Starting application..."
exec node server.js
