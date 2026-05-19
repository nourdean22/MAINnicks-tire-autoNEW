-- wave-181.84 · AgentPhone Confirmation Bot · per-booking call tracking.
--
-- Stores the lifecycle of a confirmation call for each booking: requested
-- → in-progress → completed (confirmed/rescheduled/no-answer). Lets the
-- admin UI surface no-answer rows for operator follow-up + lets the cron
-- avoid double-dialing the same booking.
--
-- One row per (booking_id, attempt). Re-attempts on no-answer get a new
-- row (so we can see the full call history per booking).
--
-- Indexes:
--   - PRIMARY (id) · default
--   - idx_conf_call_booking · join from bookings to its calls
--   - idx_conf_call_status_attempted_at · cron queries "pending/in-progress
--     attempted in last hour" for retry logic

CREATE TABLE IF NOT EXISTS `confirmation_calls` (
  `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `booking_id` INT NOT NULL,
  `attempted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` TIMESTAMP NULL,
  `agentphone_call_id` VARCHAR(64) NULL,
  `status` ENUM('pending','dialing','confirmed','rescheduled','no_answer','failed') NOT NULL DEFAULT 'pending',
  `transcript_snippet` TEXT NULL,
  `reschedule_request` TEXT NULL,
  `error_message` TEXT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_conf_call_booking` (`booking_id`),
  KEY `idx_conf_call_status_attempted_at` (`status`, `attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
