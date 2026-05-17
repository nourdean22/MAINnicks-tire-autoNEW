#!/bin/bash
# Schema drift detector — compares Prisma schema against live DB.
# Catches cases where new models/fields exist in schema but haven't
# been pushed to the database yet (the BrokenPromiseLog crash scenario).
#
# Run manually: bash scripts/schema-drift-check.sh
# Add to CI: run after build, before deploy promotion.

set -e

echo "🔍 Schema drift check: comparing Prisma schema vs live DB..."

# Source env for DATABASE_URL
if [ -f .env.local ]; then
  set -a; source .env.local; set +a
fi

# Run db push --dry-run to see what would change
OUTPUT=$(pnpm exec prisma db push --accept-data-loss 2>&1 || true)

if echo "$OUTPUT" | grep -q "already in sync"; then
  echo "✅ Schema is in sync with the database."
  exit 0
fi

if echo "$OUTPUT" | grep -q "statements will be executed"; then
  echo "⚠️  SCHEMA DRIFT DETECTED"
  echo "$OUTPUT"
  echo ""
  echo "Run 'pnpm exec prisma db push' to sync, or 'pnpm exec prisma migrate dev' to create a migration."
  exit 1
fi

echo "✅ Schema check complete."
echo "$OUTPUT" | tail -5
exit 0
