-- wave-181.x · Tier A · Closed-loop delivery (metric-tied verification)
--
-- Every wave that ships gets a target metric and a 14-day measurement
-- window. The cron checks the metric against the baseline recorded at
-- ship time and reports lift / no-lift / regression. This is the "did
-- the wave actually work?" feedback loop that compounds over time.
--
-- Without this · we ship 8 compounding loops in a day and never know
-- which 3 actually moved the needle. With this · every wave is
-- accountable to a measurable outcome.
--
-- Metric resolvers live in server/services/closedLoop.ts · the
-- metric_key column references a registered resolver by name.

CREATE TABLE IF NOT EXISTS wave_metrics (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  wave_id VARCHAR(64) NOT NULL,
  metric_key VARCHAR(64) NOT NULL,
  baseline_value DECIMAL(12, 4) NOT NULL,
  measure_at TIMESTAMP NOT NULL,
  measured_value DECIMAL(12, 4) DEFAULT NULL,
  delta_percent DECIMAL(8, 2) DEFAULT NULL,
  status ENUM('pending', 'lifted', 'no_lift', 'regression', 'resolver_error') NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  measured_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_wave_measure_at (status, measure_at),
  INDEX idx_wave_id (wave_id)
);
