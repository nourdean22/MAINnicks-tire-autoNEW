-- ROS-058 human_pending state machine (2026-07-25).
-- A human-review outcome used to collapse to terminal 'suppressed', which
-- proved the AI chose not to send but NOT that any human ever answered the
-- customer. These three appended states make the human obligation durable:
--   human_pending     — a draft awaits an operator; dueAt becomes the SLA
--   human_replied     — an operator actually sent a reply (manual or approved draft)
--   no_reply_required — an operator explicitly closed it as needing no reply
-- TiDB: enum extension is APPEND-ONLY and a single schema change per ALTER.
ALTER TABLE sms_response_jobs MODIFY COLUMN status ENUM('pending','processing','responded','suppressed','failed','dead','human_pending','human_replied','no_reply_required') NOT NULL DEFAULT 'pending';
