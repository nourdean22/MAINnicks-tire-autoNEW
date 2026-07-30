-- Drop provider_pings · the table's ONLY writer (app/api/cron/provider-ping)
-- was deleted in the wave-AE cron prune (f87fb7e62, 107 -> 35 crons); the
-- table has been write-dead since and the data-cleanup janitor purged any
-- remaining rows (>7d) long ago — prod SELECT returns 0 rows (verified
-- 2026-07-29 on Neon spring-art-47050555). Provider availability is served
-- live by getProviderHealth() (breaker state + AiGeneration telemetry);
-- nothing reads this table. Its indexes (provider_pings_provider_pinged_at
-- _idx + the v10.0.381 duplicate provider_pings_provider_pingedAt_idx)
-- drop with the table.
DROP TABLE IF EXISTS "provider_pings";
