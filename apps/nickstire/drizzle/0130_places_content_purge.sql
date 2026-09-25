-- 0130_places_content_purge.sql
-- Q-48 (2026-09-23): purge stored Google Places content. Keep place_id.
--
-- Google Maps Platform Terms (cloud.google.com/maps-platform/terms, "No Caching"):
-- "Customer will not cache Google Maps Content except as expressly permitted under
-- the Maps Service Specific Terms." The Service Specific Terms permit caching place_id
-- ("Google ID Caching") and, for the Places API, only latitude/longitude for 30 days
-- (section 14.3). Ratings, review counts and derived change strings have no carve-out.
--
-- The code that wrote these rows is removed in the same PR (competitorMonitor now
-- writes source='place_id' rows with no rating; google-reviews / reviewMonitor no
-- longer copy the rating/count into shop_settings). Apply AFTER that deploy is live,
-- or the old code re-writes rows between this purge and the deploy.
--
-- HAND-APPLIED. Operator-run only; never auto-applied. DML only, no DDL. Idempotent:
-- a second run deletes 0 rows. No backup step on purpose: a backup of this data would
-- be the same prohibited copy under another table name.
--
-- NOT purged here (see the PR): review_replies and review_pipeline hold the shop's OWN
-- Places reviews for the async reply-drafting queue, and prerendered/reviews/index.html
-- carries review cards baked by the weekly prerender-refresh workflow.
--
-- Pre-counts to record before running (read-only):
--   SELECT source, COUNT(*) FROM competitor_snapshots GROUP BY source;
--   SELECT `key`, value, updatedBy FROM shop_settings WHERE `key` IN ('reviewCount','reviewRating');
--   SELECT COUNT(*) FROM cron_alerts_fired WHERE alert_key LIKE 'cmp:%';
--   SELECT `key`, enabled FROM feature_flags WHERE `key` = 'competitor_threshold_alerts';

-- 1. Competitor rating/review-count history (every row the old cycle wrote).
DELETE FROM competitor_snapshots WHERE source = 'google_places';
--> statement-breakpoint

-- 2. Google's rating/count auto-copied into shop_settings. Admin-entered values
--    (updatedBy = 'admin') are the operator's own numbers and stay.
DELETE FROM shop_settings WHERE `key` IN ('reviewCount', 'reviewRating') AND updatedBy = 'system_sync';
--> statement-breakpoint

-- 3. Threshold-alert dedup rows: the payload holds the rating/count change string.
DELETE FROM cron_alerts_fired WHERE alert_key LIKE 'cmp:%';
--> statement-breakpoint

-- 4. The retired alert flag (removed from FLAG_DEFINITIONS; no reader remains).
DELETE FROM feature_flags WHERE `key` = 'competitor_threshold_alerts';
