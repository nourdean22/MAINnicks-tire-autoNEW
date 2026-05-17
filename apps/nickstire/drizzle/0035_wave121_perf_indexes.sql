-- Wave-121 — performance indexes for hot WHERE/JOIN paths the admin polls
-- every 30s. Audit found 3 missing indexes that force full table scans
-- on every admin dashboard tick. Each ALTER is independent so they can
-- be applied in any order; safe to run concurrently with read traffic.
--
-- IMPACT (estimated, based on admin polling cadence):
--   · customerMetrics.customerId — fixes the JOIN in customers.list
--     (every 30s). 1,500 customer rows × full-scan = significant.
--   · callbackRequests.status — admin.ts polls
--     "WHERE status IN ('new','pending')" every 30s in 3 places.
--   · customerNotifications.status — followUpsRouter.pending polls
--     "WHERE status='pending'" every 30s.
--
-- COLUMN NAMES: this codebase uses camelCase column names (mysqlTable
-- declarations like `customerId: int("customerId")` map field name →
-- same MySQL column name). NOT snake_case. callEvents.createdAt
-- already has idx_call_created — not included here (was a false
-- positive in the audit; spot-checked on schema.ts line 1387).

-- ─── customer_metrics: JOIN target on customers.list (most-polled) ──
ALTER TABLE `customer_metrics`
  ADD INDEX `idx_cm_customer_id` (`customerId`);
--> statement-breakpoint

-- ─── callback_requests: status filter on todaysBrief + sectionInsight ─
ALTER TABLE `callback_requests`
  ADD INDEX `idx_callback_status` (`status`);
--> statement-breakpoint

-- ─── customer_notifications: status filter on followUps.pending ─────
ALTER TABLE `customer_notifications`
  ADD INDEX `idx_notification_status` (`status`);
