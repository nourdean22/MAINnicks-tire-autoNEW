-- 2026-06-10 · drizzle/0069_expand_winback_target_segment.sql
--
-- Expand targetSegment enum to support all active segments:
-- ["lapsed", "unknown", "recent", "dormant", "lost", "vip", "fleet", "tire_customer"]
--
-- SAFETY: MODIFY COLUMN, expanding the enum options. This does not shrink or drop
-- any existing options, ensuring it is backwards-compatible and completely safe.
--

ALTER TABLE winback_campaigns MODIFY COLUMN targetSegment ENUM('lapsed', 'unknown', 'recent', 'dormant', 'lost', 'vip', 'fleet', 'tire_customer') NOT NULL;
