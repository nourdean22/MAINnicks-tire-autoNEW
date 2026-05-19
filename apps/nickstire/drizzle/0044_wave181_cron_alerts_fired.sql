-- wave-181.69: durable cron-alert dedup so the same critical alert
-- can't re-fire after a pod restart or across multiple Railway pods.
--
-- Current state: cron jobs that fire daily Telegram alerts (notably
-- server/cron/jobs/vapiLatencySync.ts) track "did we already alert
-- today?" via a module-level in-memory variable:
--
--   let lastAlertDate: string | null = null;
--   if (lastAlertDate !== todayIso) { sendTelegram(...); lastAlertDate = todayIso; }
--
-- Two failure modes:
--   1. Pod restart clears the variable · next cron tick after restart
--      re-fires the same critical alert.
--   2. Railway runs N>1 pods · each pod has its own variable · operator
--      receives N copies of the same alert.
--
-- Counter-shape "fired once per (key, date)" naturally maps to a unique
-- key + INSERT IGNORE pattern — atomic at the DB level, race-safe across
-- pods, survives restarts.
--
-- Indexes:
--   - PRIMARY (alert_key, fired_for) · the only lookup path (every cron
--     tick checks if today's alert was already claimed)
--   - idx_cron_alerts_fired_fired_at · for cleanup scans (prune rows
--     older than 90 days · alert history shouldn't grow unbounded)

CREATE TABLE IF NOT EXISTS `cron_alerts_fired` (
  `alert_key` varchar(100) NOT NULL,
  `fired_for` date NOT NULL,
  `fired_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `payload` text NULL,
  PRIMARY KEY (`alert_key`, `fired_for`),
  KEY `idx_cron_alerts_fired_fired_at` (`fired_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
