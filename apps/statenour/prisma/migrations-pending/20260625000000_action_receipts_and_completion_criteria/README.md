# Migration 20260625000000 · action_receipts and completionCriteria on Mission

> **Status**: APPLIED to Neon prod 2026-06-26 via apply-migration.ts
> **ADR**: 0012 · action receipts and mission completion criteria tracking
> **Phase**: Wave-339 (patience xp ledger and auto-closer)
>
> This directory is historical. The schema lives in `schema.prisma`.

## What it does

1. Adds `completionCriteria` (JSONB) column to the `Mission` table.
2. Creates the `ActionStatus` enum type.
3. Creates the `action_receipts` table to log background automation executions.
4. Adds relations, foreign keys, and indexes for `action_receipts`.

## How to apply

This has already been applied to production database.
To run manually if needed:
```bash
psql "$DATABASE_URL" -f prisma/migrations-pending/20260625000000_action_receipts_and_completion_criteria/migration.sql
```
