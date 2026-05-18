-- wave-181.51 · SMS instrumentation columns on sms_messages
--
-- Adds reply-rate tracking, conversion attribution, and A/B variant key
-- so we can answer "did this SMS work?" without keyword-sniffing the
-- body. Pairs with scripts/sms-attribution-report.ts (retrospective
-- legacy mode) — going forward, attribution is persisted at send-time
-- + reply-time + conversion-time.
--
-- Columns:
--   replyCount             — incremented when an inbound SMS arrives from the
--                            same phone within 7d of this outbound send.
--   firstReplyAt           — timestamp of the first inbound reply (NULL until).
--   optOutAt               — timestamp the customer texted STOP after this send
--                            (a subset of replies — tracked separately because
--                            opt-out is the most consequential reply type).
--   convertedCount         — incremented when a booking/lead is created from
--                            the same phone within 14d of this outbound send.
--   attributedBookingId    — the booking id we credit this send for (first
--                            one inside the conversion window). NULL until.
--   attributedAt           — timestamp the attribution was recorded.
--   variantKey             — A/B test bucket label ("v1" / "v2" / etc.).
--                            NULL for sends made before variant rollout.
--
-- Indexes:
--   sms_attribution_idx on (direction, createdAt) — narrows the
--     "find most recent outbound to phone X" lookup the webhook does
--     on every inbound. Drizzle already has idx_sms_msg_status_created;
--     this one is direction-specific because attribution only cares
--     about outbound rows.
--   sms_variant_idx on (variantKey, createdAt) — supports the A/B
--     comparator queries in the admin tile ("reply rate · variant=v1
--     vs v2 in last 30d"). Composite leading on variantKey because
--     queries filter by variant first, then time-window.
--
-- FAIL-OPEN at the application layer: every writer is wrapped in
-- try/catch with log-only on error, so an unapplied migration cannot
-- break an SMS send or a webhook. Safe to apply at any time.
--
-- ROLLBACK:
--   ALTER TABLE sms_messages
--     DROP INDEX sms_attribution_idx,
--     DROP INDEX sms_variant_idx,
--     DROP COLUMN variantKey,
--     DROP COLUMN attributedAt,
--     DROP COLUMN attributedBookingId,
--     DROP COLUMN convertedCount,
--     DROP COLUMN optOutAt,
--     DROP COLUMN firstReplyAt,
--     DROP COLUMN replyCount;

ALTER TABLE sms_messages
  ADD COLUMN replyCount INT NOT NULL DEFAULT 0,
  ADD COLUMN firstReplyAt TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN optOutAt TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN convertedCount INT NOT NULL DEFAULT 0,
  ADD COLUMN attributedBookingId INT NULL DEFAULT NULL,
  ADD COLUMN attributedAt TIMESTAMP NULL DEFAULT NULL,
  ADD COLUMN variantKey VARCHAR(50) NULL DEFAULT NULL;

CREATE INDEX sms_attribution_idx ON sms_messages (direction, createdAt);
CREATE INDEX sms_variant_idx ON sms_messages (variantKey, createdAt);
