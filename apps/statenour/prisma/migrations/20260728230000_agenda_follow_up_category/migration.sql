-- 2026-07-28 · spine-4: FOLLOW_UP joins AgendaItemCategory so Home
-- follow-up decisions live in the EXISTING agenda_items ledger instead
-- of browser localStorage. Purely additive enum value; runs in
-- AUTOCOMMIT via scripts/apply-pending-migration.ts (ADD VALUE cannot
-- run inside a transaction block).
ALTER TYPE "AgendaItemCategory" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';
