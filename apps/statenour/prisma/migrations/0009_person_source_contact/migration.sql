-- 0009_person_source_contact · 2026-06-06 · PersonProfile origin + contact (feature #5).
-- STATUS: apply to prod via POST /api/system/apply-pending-migration
--   { "name": "0009_person_source_contact" } from an authed bdnick.info tab.
--   Additive · idempotent · zero data loss. COLUMN-FIRST: apply with/before the deploy.
-- source (operator|agent|digest — makes shop-vs-personal structural), phone, email. All nullable.
ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "person_profiles" ADD COLUMN IF NOT EXISTS "email" TEXT;
