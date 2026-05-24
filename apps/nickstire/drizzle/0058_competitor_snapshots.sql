-- wave-181.x · Tier S · competitor intel persistence
--
-- Stores periodic snapshots of competitor business profiles so the
-- in-memory change-detection in competitorMonitor.ts can survive pod
-- restarts and detect meaningful drift over weeks, not just minutes.
--
-- Why a new table (not shopSettings KV) · change detection needs
-- INDEXED time-series reads ("show me the last snapshot before today
-- for placeId X"), not a single blob fetch. shopSettings would force a
-- full JSON parse per read.
--
-- Storage cost · 6 competitors × 1 row/day × 365 days = 2,190 rows/yr.
-- Cheap forever.

CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  competitor_name VARCHAR(160) NOT NULL,
  place_id VARCHAR(128) NOT NULL,
  rating DECIMAL(3, 2) NOT NULL DEFAULT 0,
  review_count INT NOT NULL DEFAULT 0,
  source VARCHAR(32) NOT NULL DEFAULT 'google_places',
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  raw_payload JSON DEFAULT NULL,
  INDEX idx_competitor_captured (place_id, captured_at DESC),
  INDEX idx_captured_at (captured_at DESC)
);
