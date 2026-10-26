/**
 * Nick AI Agent — Intelligence gathering, operator command, context loading.
 * Handles: operatorCommand, pullFromStatenour, runMigrations, importCustomerCSV, syncShopDriver
 */
import { gte, and, sql, inArray } from "drizzle-orm";
import { reviewRequests } from "../../../drizzle/schema";
import { db } from "./utils";

/**
 * Review requests that actually went out since `since`. Only 'sent' and
 * 'clicked' are contacts: 'pending'/'failed'/'skipped' never reached the
 * customer, and a Q-21 'heldout' row is a deliberately withheld control.
 * Counting every status told the operator "N requests sent" for rows that
 * were never sent.
 */
export function reviewRequestsSentSinceQuery(d: NonNullable<Awaited<ReturnType<typeof db>>>, since: Date) {
  return d.select({ count: sql<number>`count(*)`.mapWith(Number) }).from(reviewRequests).where(and(
    gte(reviewRequests.createdAt, since),
    inArray(reviewRequests.status, ["sent", "clicked"]),
  ));
}

// ─── Run database migrations ──────────────────────────

export async function handleRunMigrations() {
  try {
    const { getDb } = await import("../../db");
    const d = await getDb();
    if (!d) return { success: false, error: "DB not available" };

    const migrations = [
      // 2026-06-23 · social_drafts — Stored briefs/drafts from Carousel/Reel Studios
      `CREATE TABLE IF NOT EXISTS social_drafts (id VARCHAR(64) PRIMARY KEY, contentType VARCHAR(16) NOT NULL, topic VARCHAR(255) NOT NULL, briefJson TEXT NOT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_social_drafts_type (contentType), INDEX idx_social_drafts_created (createdAt))`,
      // 2026-06-23 · customer_testimonials — Curated customer reviews and testimonials generated/validated by studios
      `CREATE TABLE IF NOT EXISTS customer_testimonials (id INT AUTO_INCREMENT PRIMARY KEY, author VARCHAR(100) NULL, text TEXT NOT NULL, rating INT NOT NULL DEFAULT 5, source VARCHAR(50) NOT NULL DEFAULT 'manual', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_testimonials_rating (rating))`,
      // 2026-07-21 · sms_response_jobs — durable inbound-response obligation spine (NCSOS #1/#2, matches drizzle/0092 + schema.ts)
      `CREATE TABLE IF NOT EXISTS sms_response_jobs (id INT AUTO_INCREMENT PRIMARY KEY, conversationId INT NOT NULL, customerPhone VARCHAR(30) NOT NULL, providerMsgId VARCHAR(128) NULL, idempotencyKey VARCHAR(191) NOT NULL, body TEXT NOT NULL, status ENUM('pending','processing','responded','suppressed','failed','dead') NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0, maxAttempts INT NOT NULL DEFAULT 5, dueAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, claimedAt TIMESTAMP NULL DEFAULT NULL, claimedBy VARCHAR(64) NULL DEFAULT NULL, orchestrationId INT NULL DEFAULT NULL, lastError VARCHAR(1000) NULL DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uniq_response_idem (idempotencyKey), INDEX idx_response_status_due (status, dueAt), INDEX idx_response_phone (customerPhone))`,
      // 2026-07-21 · business_facts — versioned facts/approved-claims store (NCSOS #1/#2, matches drizzle/0093 + schema.ts)
      `CREATE TABLE IF NOT EXISTS business_facts (id INT AUTO_INCREMENT PRIMARY KEY, factKey VARCHAR(64) NOT NULL, category VARCHAR(32) NOT NULL, value TEXT NOT NULL, source VARCHAR(255) NOT NULL, approvedBy VARCHAR(100) NOT NULL, effectiveDate DATE NOT NULL, verifiedDate DATE NOT NULL, channels VARCHAR(255) NOT NULL DEFAULT 'sms,voice,web', active TINYINT(1) NOT NULL DEFAULT 1, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uniq_fact_key (factKey), INDEX idx_fact_active (active))`,
      // 2026-07-21 · expected_arrivals — durable "customer said they're coming" record (NCSOS business-action-tools, matches drizzle/0094 + schema.ts)
      `CREATE TABLE IF NOT EXISTS expected_arrivals (id INT AUTO_INCREMENT PRIMARY KEY, customerName VARCHAR(255) NULL, customerPhone VARCHAR(30) NOT NULL, vehicle VARCHAR(255) NULL, service VARCHAR(255) NULL, expectedDate DATE NOT NULL, whenText VARCHAR(100) NULL, source ENUM('voice','sms','web','manual') NOT NULL DEFAULT 'manual', sourceRef VARCHAR(128) NULL, status ENUM('expected','arrived','no_show','cancelled') NOT NULL DEFAULT 'expected', arrivedAt TIMESTAMP NULL DEFAULT NULL, reconciledInvoiceId INT NULL DEFAULT NULL, note VARCHAR(500) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_ea_status_date (status, expectedDate), INDEX idx_ea_phone (customerPhone))`,
      // 2026-09-22 · expected_arrivals: one invoice reconciles at most ONE arrival (matches
      // drizzle/0126 + schema.ts). A re-run trips "index already exist" / ER_DUP_KEYNAME,
      // which the loop below already treats as already-applied.
      `CREATE UNIQUE INDEX uq_ea_reconciled_invoice ON expected_arrivals (reconciledInvoiceId)`,
      // 2026-09-10 · camera_runtime health counters — two numbers the edge producer already
      // keeps and nobody could read (matches drizzle/0124 + schema.ts). Both NULLABLE on
      // purpose: a producer predating them sends neither, and NULL must read as "not
      // reported" rather than as a confident zero. APPLY THIS BEFORE deploying the code that
      // writes them -- the heartbeat upsert names every column, so the reverse order breaks
      // ingest for every camera.
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS relocateFailures INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS preexistingCrossed INT NULL`,
      // 2026-09-22 · visit episode identity + stitch counters (matches drizzle/0127 +
      // schema.ts). A tracker id is not a vehicle: `camera-bridge/vision/stitch.py`
      // (#2493) decides when a new track CONTINUES an earlier one and carries the
      // original arrival forward, but the shop table had nowhere to record WHICH tracks
      // were folded together -- so a corrected `arrivedAt` landed unauditable. Measured
      // 2026-09-22: shop-left 152 track deaths against 1-6 invoiced jobs, 13.8%
      // re-acquired; shop-right 81 / 18.5%. NULLABLE for the same reason as the pair
      // above -- a producer predating them sends none, and NULL is "not reported", not
      // an empty trail. SAME ORDERING RULE: apply before deploying the writer.
      `ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS episodeId VARCHAR(64) NULL`,
      `ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS continuesVisitId VARCHAR(64) NULL`,
      `ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS memberTrackIds JSON NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vehicle_visits_episode ON vehicle_visits (episodeId)`,
      // `arrivalsAfterStitch` is the de-duplicated SHADOW of `arrivals`, reported
      // alongside it and never instead of it -- the operator's 2026-09-18 instruction was
      // to keep the counter running and unhidden and let the data prove itself.
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS arrivalsAfterStitch INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS stitchedTotal INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS stitchRefusedAmbiguous INT NULL`,
      // 2026-09-22 · conversation_episodes — one counter interaction with its evidence
      // (matches drizzle/0128 + schema.ts). The office Eufy camera was MEASURED that day to
      // carry a real audio track (aac 16kHz mono), so capture is possible. Source-agnostic:
      // `source` names where audio came from, because the camera mic may lose the
      // intelligibility test and be replaced by a counter mic without touching this shape.
      // Every extracted fact carries the transcript span it came from — a summary nobody can
      // trace back to what was said is a rumour with a timestamp.
      `CREATE TABLE IF NOT EXISTS conversation_episodes (id BIGINT AUTO_INCREMENT PRIMARY KEY, episodeId VARCHAR(64) NOT NULL, source VARCHAR(32) NOT NULL, startedAt TIMESTAMP NULL DEFAULT NULL, endedAt TIMESTAMP NULL DEFAULT NULL, durationSeconds INT NULL DEFAULT NULL, audioRef VARCHAR(255) NULL DEFAULT NULL, meanVolumeDb DECIMAL(6,2) NULL DEFAULT NULL, transcriptStatus VARCHAR(32) NOT NULL DEFAULT 'PENDING', transcriptError VARCHAR(500) NULL DEFAULT NULL, transcript JSON NULL DEFAULT NULL, sttEngine VARCHAR(32) NULL DEFAULT NULL, sttLatencyMs INT NULL DEFAULT NULL, speakerCount INT NULL DEFAULT NULL, facts JSON NULL DEFAULT NULL, summary TEXT NULL DEFAULT NULL, vehicleVisitId VARCHAR(64) NULL DEFAULT NULL, workOrderId VARCHAR(64) NULL DEFAULT NULL, linkConfidence DECIMAL(4,3) NULL DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uniq_conversation_episode (episodeId), INDEX idx_conversation_started (startedAt), INDEX idx_conversation_status (transcriptStatus, startedAt), INDEX idx_conversation_visit (vehicleVisitId))`,

      // 2026-09-29 - Office conversation runtime + provenance (matches drizzle/0135).
      // Current worker state rides camera_runtime.office so the Eufy agent remains the ONE
      // cloud producer; conversation_episodes remains history/evidence.
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerOk BOOLEAN NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerState VARCHAR(32) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWorkerHeartbeatAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationAudioSource VARCHAR(64) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureHost VARCHAR(64) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationSttEngine VARCHAR(128) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationQueueDepth INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationLastTrigger VARCHAR(32) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationEventAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationCaptureAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationSttAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationPostAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationSummaryAt TIMESTAMP NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS lastConversationCoverage DECIMAL(5,4) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationFailuresToday INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationLastError VARCHAR(500) NULL`,
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS cameraSerial VARCHAR(64) NULL`,
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS captureHost VARCHAR(64) NULL`,
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS triggerType VARCHAR(32) NULL`,
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS triggeredAt TIMESTAMP NULL`,
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS sttModel VARCHAR(128) NULL`,
      `CREATE INDEX IF NOT EXISTS idx_conversation_camera_started ON conversation_episodes (cameraSerial, startedAt)`,
      // 2026-10-07 - camera_runtime rolling-window plausibility counters (matches drizzle/0144 +
      // schema.ts). The vehicle lane reports what the detector SAW in the last 10/60 min, the
      // office worker what the last hour of listening looked like. NULL = not reported, 0 = looked
      // and found none. The heartbeat route intersects its column list with INFORMATION_SCHEMA, so
      // a late apply drops only these fields instead of rejecting every camera heartbeat.
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS detectionsLast10m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS portalCrossingsLast60m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationListeningCoverage60m DECIMAL(5,4) NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureSecondsLast60m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCapturesLast60m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationCaptureFailuresLast60m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationWakeTriggersLast60m INT NULL`,
      `ALTER TABLE camera_runtime ADD COLUMN IF NOT EXISTS conversationTranscribeBacklog INT NULL`,
      // 2026-10-08 - operator visit marks (matches drizzle/0145 + schema.ts). One tap on the Lot
      // floor board for what the camera cannot see: customer waiting, service started, service
      // done, not a job. VARCHAR, never ENUM (an out-of-enum write loses the row on TiDB).
      `CREATE TABLE IF NOT EXISTS vehicle_visit_marks (id BIGINT AUTO_INCREMENT PRIMARY KEY, visitId VARCHAR(64) NOT NULL, mark VARCHAR(32) NOT NULL, markedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, markedBy VARCHAR(191) NOT NULL, note VARCHAR(191) NULL, INDEX idx_vehicle_visit_marks_visit (visitId, markedAt))`,
      // 2026-09-23 · candidates recruiting funnel (matches drizzle/0129 + schema.ts). All
      // nullable, all IF NOT EXISTS. createCandidate falls back to the pre-0129 columns on
      // ER_BAD_FIELD_ERROR, so deploy order does not matter; until this runs, intent and
      // move reasons survive only inside `message`.
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS intent VARCHAR(32) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS moveReasons VARCHAR(500) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS phoneE164 VARCHAR(20) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS refCode VARCHAR(64) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gclid VARCHAR(255) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utmTerm VARCHAR(255) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utmContent VARCHAR(255) NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS nextFollowUpAt TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ownerAlertedAt TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_candidate_phone_e164 ON candidates (phoneE164)`,
      `CREATE INDEX IF NOT EXISTS idx_candidate_ref_code ON candidates (refCode)`,
      // 2026-10-02 · drizzle/0130_tire_registrations.sql, byte-equivalent. Never applied before this
      // wave (operator-pending since Q-47); tireRegistration.ts names the missing table until then.
      `CREATE TABLE IF NOT EXISTS tire_registrations (id INT AUTO_INCREMENT PRIMARY KEY, work_order_id VARCHAR(36) NOT NULL, position VARCHAR(8) NOT NULL, tin VARCHAR(20) NULL DEFAULT NULL, tin_status VARCHAR(32) NULL DEFAULT NULL, tin_week INT NULL DEFAULT NULL, tin_year INT NULL DEFAULT NULL, tire_brand VARCHAR(100) NULL DEFAULT NULL, tire_condition VARCHAR(8) NOT NULL DEFAULT 'new', registration_method VARCHAR(32) NOT NULL DEFAULT 'pending', registered_at TIMESTAMP NULL DEFAULT NULL, registered_by VARCHAR(100) NULL DEFAULT NULL, captured_by VARCHAR(100) NULL DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY uq_tire_reg_wo_position (work_order_id, position), KEY idx_tire_reg_tin (tin))`,
      // 2026-10-02 · drizzle/0132_declined_work_captures.sql. Until it exists every declined estimate
      // is INFERRED (an unmatched estimate), never an OBSERVED counter decline (declineCaptures.ts).
      `CREATE TABLE IF NOT EXISTS declined_work_captures (id INT AUTO_INCREMENT PRIMARY KEY, estimate_id INT NOT NULL, declined_item VARCHAR(500) NULL DEFAULT NULL, source VARCHAR(32) NOT NULL DEFAULT 'counter', captured_by VARCHAR(255) NULL DEFAULT NULL, captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_declined_capture_estimate (estimate_id))`,
      // 2026-10-02 · drizzle/0133_contact_consent_events.sql. The consent ledger is OFF in prod
      // (CONSENT_LEDGER_MODE unset); the table must exist BEFORE any enforce_* mode, because sms.ts
      // refuses outbound sends when the ledger it was told to enforce cannot be read.
      `CREATE TABLE IF NOT EXISTS contact_consent_events (id BIGINT NOT NULL AUTO_INCREMENT, subject_type VARCHAR(8) NOT NULL, subject_key VARCHAR(255) NOT NULL, customer_key VARCHAR(64) NULL, scope VARCHAR(32) NOT NULL, action VARCHAR(16) NOT NULL, source VARCHAR(48) NOT NULL, method VARCHAR(32) NOT NULL, disclosure_id VARCHAR(64) NULL, disclosure_version VARCHAR(16) NULL, disclosure_sha256 CHAR(64) NULL, evidence_ref VARCHAR(191) NOT NULL, evidence_excerpt VARCHAR(160) NULL, detector_version VARCHAR(16) NULL, ip_address VARCHAR(45) NULL, user_agent VARCHAR(300) NULL, actor VARCHAR(100) NOT NULL, occurred_at DATETIME(3) NOT NULL, occurred_at_estimated TINYINT NOT NULL DEFAULT 0, recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, review_status VARCHAR(16) NULL, reviewed_by VARCHAR(100) NULL, reviewed_at DATETIME NULL, PRIMARY KEY (id), UNIQUE KEY uq_contact_consent_event (subject_type, subject_key, source, evidence_ref, scope, action), KEY idx_contact_consent_subject (subject_type, subject_key, occurred_at), KEY idx_contact_consent_review (action, review_status))`,
      // 2026-10-02 · drizzle/0136_contact_experiment_assignments.sql. The three MODIFYs APPEND 'heldout'
      // (ordinals unchanged, metadata-only) and re-assert on every run, so each must equal its
      // schema.ts enum — migrationListGuards.test.ts pins that. Keep every contact_holdout_* flag OFF
      // until a read-back shows 'heldout' in all three enums.
      `CREATE TABLE IF NOT EXISTS contact_experiment_assignments (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, experiment_id VARCHAR(120) NOT NULL, lane_key VARCHAR(100) NOT NULL, subject_key VARCHAR(64) NOT NULL, arm_id VARCHAR(16) NOT NULL, assignment_version VARCHAR(32) NOT NULL, source_variant_key VARCHAR(100) NULL, assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uk_contact_exp_subject (experiment_id, subject_key), KEY idx_contact_exp_lane_arm_time (lane_key, arm_id, assigned_at), KEY idx_contact_exp_assigned (assigned_at))`,
      `ALTER TABLE winback_sends MODIFY COLUMN status ENUM('pending','sent','failed','heldout') NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE sms_campaign_sends MODIFY COLUMN status ENUM('pending','sent','failed','heldout') NOT NULL DEFAULT 'pending'`,
      `ALTER TABLE review_requests MODIFY COLUMN status ENUM('pending','sent','clicked','failed','skipped','heldout') NOT NULL DEFAULT 'pending'`,
      // 2026-10-02 · drizzle/0137_bridge_outbox.sql. Written only while bridge_outbox_shadow is ON.
      `CREATE TABLE IF NOT EXISTS bridge_outbox (id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, idempotency_key VARCHAR(190) NOT NULL, event_type VARCHAR(80) NOT NULL, route VARCHAR(64) NOT NULL, payload JSON NOT NULL, occurred_at TIMESTAMP(3) NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0, due_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), claim_token VARCHAR(36) NULL, claimed_at TIMESTAMP(3) NULL, last_http_status INT NULL, last_error VARCHAR(500) NULL, delivered_at TIMESTAMP(3) NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), UNIQUE KEY uniq_bridge_outbox_key (idempotency_key), KEY idx_bridge_outbox_status_due (status, due_at), KEY idx_bridge_outbox_created (created_at))`,
      // 2026-10-02 · drizzle/0138_nhtsa_mfr_warranty.sql. Written only while nhtsa_warranty_ingest is ON.
      `CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_comms (nhtsa_id BIGINT NOT NULL PRIMARY KEY, document_id VARCHAR(128) NOT NULL, mfr_campaign_id VARCHAR(128) NULL, communication_type VARCHAR(64) NOT NULL, match_signal VARCHAR(32) NOT NULL, matched_phrase VARCHAR(64) NULL, mfr_date DATE NULL, added_date DATE NULL, components VARCHAR(512) NULL, summary TEXT NOT NULL, source_chunk VARCHAR(32) NOT NULL, last_seen_at TIMESTAMP(3) NOT NULL, KEY idx_nhtsa_comms_last_seen (last_seen_at))`,
      `CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_products (nhtsa_id BIGINT NOT NULL, make_norm VARCHAR(128) NOT NULL, model_norm VARCHAR(256) NOT NULL, model_year SMALLINT NOT NULL, make_raw VARCHAR(128) NOT NULL, model_raw VARCHAR(256) NOT NULL, PRIMARY KEY (nhtsa_id, make_norm, model_norm, model_year), KEY idx_nhtsa_products_ymm (make_norm, model_year, model_norm))`,
      // 2026-10-02 · drizzle/0139_review_requests_invoice_source.sql: invoice-sourced review requests.
      // invoiceReviewRequests.ts checks information_schema and stays inert until both changes exist.
      // IF NOT EXISTS on the index: a re-run is a no-op, not a swallowed "Duplicate".
      `ALTER TABLE review_requests MODIFY COLUMN bookingId int NULL`,
      `ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS invoiceId int NULL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_invoice ON review_requests (invoiceId)`,
      // 2026-10-02 · drizzle/0140_conversation_episodes_visual.sql: office "watch" description.
      // conversationRoutes + lot.conversations check information_schema and stay inert until applied.
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS visual JSON NULL`,
      // 2026-10-02 · drizzle/0141_conversation_episodes_gist.sql: one-sentence topic per conversation.
      // conversationRoutes + lot.conversations check information_schema and stay inert until applied.
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS gist TEXT NULL`,
      // 2026-10-03 · drizzle/0142_chat_sessions_messages_mediumtext.sql: a long chat transcript
      // overflowed TEXT (64 KB) and STRICT rejected the write. Widening only; re-run is a no-op.
      `ALTER TABLE chat_sessions MODIFY COLUMN messagesJson MEDIUMTEXT NOT NULL`,
      // 2026-10-16 · drizzle/0146_customer_notifications_skipped.sql. followUps.cancel wrote
      // 'skipped' into an ENUM without it (Sentry NICKSTIRE-D). APPENDS the member; re-asserts on
      // every run and must equal schema.ts (migrationListGuards.test.ts pins that).
      `ALTER TABLE customer_notifications MODIFY COLUMN status ENUM('pending','sent','failed','skipped') NOT NULL DEFAULT 'pending'`,
      // 2026-10-18 · drizzle/0147_financing_clicks_kafene.sql. Kafene clicks were rejected by an
      // ENUM without it. APPENDS the member; re-asserts on every run and must equal schema.ts.
      `ALTER TABLE financing_clicks MODIFY COLUMN provider ENUM('acima','snap','koalafi','american-first','kafene') NOT NULL`,
      // 2026-10-18 · drizzle/0148_kafene_leases.sql. Kafene lease rows; idempotent create.
      `CREATE TABLE IF NOT EXISTS kafene_leases (id INT AUTO_INCREMENT PRIMARY KEY, orderNumber VARCHAR(50) NOT NULL, uid VARCHAR(64) NULL, status VARCHAR(24) NOT NULL DEFAULT 'started', merchandiseCents INT NOT NULL, activationDate DATE NULL, activatedAt DATETIME NULL, activatedBy VARCHAR(191) NULL, cancelledAt DATETIME NULL, lastError VARCHAR(255) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY kafene_leases_uid_unique (uid), INDEX idx_kafene_leases_order (orderNumber)) DEFAULT CHARSET=utf8mb4`,
      // 2026-10-21 · drizzle/0149_conversation_episodes_extraction.sql: how an account and its flags
      // were produced (ears-v2). conversationRoutes checks information_schema and stays inert until applied.
      `ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS extraction JSON NULL`,
      // 2026-10-22 · drizzle/0150_service_reminders_unique.sql: one reminder per customer, category and
      // closed job. The planner inserts with IGNORE, so it works before and after this lands.
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_service_reminders_phone_type_date ON service_reminders (phone, serviceType, lastServiceDate)`,
      // 2026-10-25 · drizzle/0151_winback_target_lapsed_regulars.sql. Win-Back targets the lapsed
      // regulars; APPENDS the member; re-asserts on every run and must equal schema.ts.
      `ALTER TABLE winback_campaigns MODIFY COLUMN targetSegment ENUM('lapsed','unknown','recent','dormant','lost','vip','fleet','tire_customer','lapsed_regulars') NOT NULL`,
      // 2026-07-21 · nickgpt_training_examples.edit_categories_json — training-loop edit taxonomy (matches drizzle/0095 + schema.ts)
      `ALTER TABLE nickgpt_training_examples ADD COLUMN IF NOT EXISTS edit_categories_json TEXT NULL`,
      `CREATE TABLE IF NOT EXISTS chat_analytics (id int AUTO_INCREMENT PRIMARY KEY, sessionId int, hourOfDay int NOT NULL, dayOfWeek int NOT NULL, month int NOT NULL, messageCount int NOT NULL DEFAULT 0, converted int NOT NULL DEFAULT 0, leadScore int, duration int, createdAt timestamp NOT NULL DEFAULT (now()))`,

      `CREATE TABLE IF NOT EXISTS review_pipeline (id int AUTO_INCREMENT PRIMARY KEY, authorName varchar(255) NOT NULL, rating int NOT NULL, reviewText text, reviewTime int, relativeTime varchar(100), sentiment varchar(20), topicsJson text, keywordsJson text, urgency varchar(20), suggestedResponse text, status varchar(20) DEFAULT 'pending', createdAt timestamp NOT NULL DEFAULT (now()), reviewed int NOT NULL DEFAULT 0, responseSent int NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS search_performance (id int AUTO_INCREMENT PRIMARY KEY, query varchar(500) NOT NULL, page varchar(500), clicks int DEFAULT 0, impressions int DEFAULT 0, ctr int DEFAULT 0, position int DEFAULT 0, date date, createdAt timestamp NOT NULL DEFAULT (now()))`,
      `CREATE TABLE IF NOT EXISTS pipeline_runs (id int AUTO_INCREMENT PRIMARY KEY, pipelineName varchar(100) NOT NULL, status varchar(20) NOT NULL, startedAt timestamp NOT NULL DEFAULT (now()), completedAt timestamp, durationMs int, resultJson text, error text)`,
      `CREATE TABLE IF NOT EXISTS daily_execution (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, mission TEXT, notes TEXT, status ENUM('on_track','drifting','off_track') NOT NULL DEFAULT 'on_track', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, UNIQUE KEY idx_daily_date (date))`,
      `CREATE TABLE IF NOT EXISTS daily_habits (id INT AUTO_INCREMENT PRIMARY KEY, date DATE NOT NULL, habit_key VARCHAR(50) NOT NULL, completed TINYINT(1) NOT NULL DEFAULT 0, completed_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY idx_habit_date_key (date, habit_key))`,
      `CREATE TABLE IF NOT EXISTS conversation_memory (id INT AUTO_INCREMENT PRIMARY KEY, visitorKey VARCHAR(255) NOT NULL, category VARCHAR(50) NOT NULL, content TEXT NOT NULL, sessionId INT NULL, confidence FLOAT NOT NULL DEFAULT 0.8, reinforcements INT NOT NULL DEFAULT 1, lastAccessed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      // 2026-05-31 · Meta page-token durable store. Holds the minted,
      // never-expiring Page access token server-side so socialPost survives
      // pod restarts without re-minting. Read/written only server-side.
      `CREATE TABLE IF NOT EXISTS app_secret_kv (k VARCHAR(64) PRIMARY KEY, v TEXT NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP)`,
      // 2026-06-18 · reel_jobs — durable status table for the Faceless Reel
      // pipeline. Gen->assemble->publish runs as a background cron job (pulse
      // tier, REEL_GENERATION_ENABLED-gated), never a synchronous request.
      // Drizzle def: drizzle/schema.ts reelJobs.
      `CREATE TABLE IF NOT EXISTS reel_jobs (id INT AUTO_INCREMENT PRIMARY KEY, briefId VARCHAR(64) NOT NULL, payload TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued', clipUrlsJson TEXT, voUrl VARCHAR(1000), musicUrl VARCHAR(1000), mp4Url VARCHAR(1000), igPostId VARCHAR(64), caption TEXT, attempts INT NOT NULL DEFAULT 0, error VARCHAR(1000), source VARCHAR(16) NOT NULL DEFAULT 'admin', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_reel_jobs_status (status), INDEX idx_reel_jobs_created (createdAt))`,
      // 2026-05-23 · drizzle/0052_payment_alert_backlog.sql — paid-but-unfulfillable recovery
      `CREATE TABLE IF NOT EXISTS payment_alert_backlog (id INT AUTO_INCREMENT PRIMARY KEY, tireOrderNumber VARCHAR(64) DEFAULT NULL, invoiceNumber VARCHAR(64) DEFAULT NULL, amountCents INT NOT NULL, summary VARCHAR(500) NOT NULL, failureReason ENUM('email_failed', 'telegram_failed', 'both_failed') NOT NULL, resolvedAt TIMESTAMP NULL DEFAULT NULL, resolvedBy VARCHAR(255) DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_payment_alert_backlog_unresolved (resolvedAt, createdAt DESC), INDEX idx_payment_alert_backlog_tire_order (tireOrderNumber), INDEX idx_payment_alert_backlog_invoice (invoiceNumber))`,
      // 2026-05-23 · drizzle/0053_event_dlq_lifecycle.sql — persistent DLQ
      `CREATE TABLE IF NOT EXISTS event_dlq (id INT AUTO_INCREMENT PRIMARY KEY, eventType VARCHAR(64) NOT NULL, destination VARCHAR(64) NOT NULL, error VARCHAR(500) NOT NULL, payload JSON, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, alertedAt TIMESTAMP NULL DEFAULT NULL, INDEX idx_event_dlq_pattern (eventType, destination, createdAt DESC), INDEX idx_event_dlq_alerted (alertedAt, createdAt DESC))`,
      // 2026-05-23 · drizzle/0053_event_dlq_lifecycle.sql — multi-pod lifecycle tracker
      `CREATE TABLE IF NOT EXISTS lifecycle_tracker_events (phone10 VARCHAR(10) PRIMARY KEY, customerName VARCHAR(255) DEFAULT NULL, events JSON NOT NULL, convertedAt TIMESTAMP NULL DEFAULT NULL, firstSeenAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, lastSeenAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_lifecycle_last_seen (lastSeenAt DESC), INDEX idx_lifecycle_unconverted (convertedAt, lastSeenAt DESC))`,
      // 2026-05-23 · drizzle/0054_tire_markup_100.sql — force tire markup to 100% (cost × 2)
      // Bug: admin UI defaulted to "50" — operator save = silent 50% markup. Backend default is 100.
      // INSERT IGNORE seeds 100 only when the row is missing.
      // 2026-09-23 · its companion `UPDATE shop_settings SET value = '100'` is GONE. This
      // list re-runs EVERY statement on every tap of Admin → System Health → "Apply
      // pending migrations", so that UPDATE would reset a markup the operator edited
      // (gatewayTire.updateMarkup) back to 100 each time. Verified before removal: the
      // prod row has read value 100 / updatedBy system-migration-0054 / updatedAt
      // 2026-06-18 throughout, so no run ever changed it. migrationListGuards.test.ts
      // keeps any UPDATE/DELETE on shop_settings out of this list.
      `INSERT IGNORE INTO shop_settings (\`key\`, value, category, label, updatedBy) VALUES ('tireMarkup', '100', 'pricing', 'Tire Markup %', 'system-migration-0054')`,
      // 2026-05-23 · drizzle/0055_declined_recovery_sequence.sql — 5×3 SMS sequence
      // Adds new touch column triplets (3d/14d/45d) + recoveryProfile cache.
      // ALTER ... ADD COLUMN IF NOT EXISTS is MySQL 8+ — TiDB supports.
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_3d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_14d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_sent INT NOT NULL DEFAULT 0`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_attempted_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS follow_up_45d_sent_at TIMESTAMP NULL DEFAULT NULL`,
      `ALTER TABLE alg_estimates ADD COLUMN IF NOT EXISTS recovery_profile VARCHAR(8) DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_alg_est_recovery_profile ON alg_estimates (recovery_profile)`,
      // 2026-05-23 · drizzle/0056_customer_psycho_profile.sql — psychographic profile
      // Powers profile-aware SMS routing across win-back + drip + declined-recovery.
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile_score INT DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS psycho_profile_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_customer_psycho ON customers (psycho_profile)`,
      // 2026-05-23 · drizzle/0057_vapi_call_eval.sql — Nick AI eval columns
      // Daily cron scores every call 0-100 · powers Telegram quality alerts +
      // compound learning via nickMemory.
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_score TINYINT NULL DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_outcome VARCHAR(32) DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_reasoning TEXT DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS eval_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vapi_eval_at_score ON vapi_call_logs (eval_at, eval_score)`,
      // 2026-05-23 · drizzle/0058_competitor_snapshots.sql — Tier S competitor intel
      // Persistent baselines for the in-memory competitor monitor · survives pod restart.
      `CREATE TABLE IF NOT EXISTS competitor_snapshots (id BIGINT AUTO_INCREMENT PRIMARY KEY, competitor_name VARCHAR(160) NOT NULL, place_id VARCHAR(128) NOT NULL, rating DECIMAL(3,2) NOT NULL DEFAULT 0, review_count INT NOT NULL DEFAULT 0, source VARCHAR(32) NOT NULL DEFAULT 'google_places', captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, raw_payload JSON DEFAULT NULL, INDEX idx_competitor_captured (place_id, captured_at), INDEX idx_captured_at (captured_at))`,
      // wave-143 · follow-up cadence (the flywheel · 7/30/60-day trust calls
      // after a completed job). The UNIQUE KEY (bookingId, touch) IS the
      // at-most-once guarantee — a customer can never be auto-called twice for
      // the same touch, even across overlapping cron runs.
      `CREATE TABLE IF NOT EXISTS voice_followups (id INT AUTO_INCREMENT PRIMARY KEY, bookingId INT NOT NULL, touch ENUM('d7','d30','d60') NOT NULL, phone VARCHAR(30) DEFAULT NULL, customerName VARCHAR(255) DEFAULT NULL, status ENUM('called','failed','skipped') NOT NULL DEFAULT 'called', vapiCallId VARCHAR(64) DEFAULT NULL, errorMessage VARCHAR(500) DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uniq_booking_touch (bookingId, touch), INDEX idx_followup_created (createdAt))`,
      // 2026-05-23 · drizzle/0059_wave_metrics.sql — Tier A closed-loop delivery
      // Baseline + measurement window per shipped wave · daily cron writes lift/no-lift.
      `CREATE TABLE IF NOT EXISTS wave_metrics (id BIGINT AUTO_INCREMENT PRIMARY KEY, wave_id VARCHAR(64) NOT NULL, metric_key VARCHAR(64) NOT NULL, baseline_value DECIMAL(12,4) NOT NULL, measure_at TIMESTAMP NOT NULL, measured_value DECIMAL(12,4) DEFAULT NULL, delta_percent DECIMAL(8,2) DEFAULT NULL, status ENUM('pending','lifted','no_lift','regression','resolver_error') NOT NULL DEFAULT 'pending', notes TEXT DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, measured_at TIMESTAMP NULL DEFAULT NULL, INDEX idx_wave_measure_at (status, measure_at), INDEX idx_wave_id (wave_id))`,
      // 2026-05-23 · drizzle/0060_agentic_audit.sql — Tier S agentic-actions-auditor
      // metadata JSON column captures audit findings · audited_at stamps the audit.
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT NULL`,
      `ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP NULL DEFAULT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vapi_audited_at ON vapi_call_logs (audited_at)`,
      // 2026-06-21 · Phase 5.2 live IG insights — reach/saved/views/shares snapshots
      // on instagram_analytics (views replaces Meta's deprecated plays). Idempotent.
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS reach INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS saved INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS views INT DEFAULT NULL`,
      `ALTER TABLE instagram_analytics ADD COLUMN IF NOT EXISTS shares INT DEFAULT NULL`,
      // 2026-05-24 · drizzle/0061_service_affinity_v2.sql — SA v2 closed loop
      // 4 new tables: predictions/impressions/actions/outcomes. Enables
      // operator-flip activation gate via admin UI without TiDB Cloud login.
      // See apps/nickstire/docs/2026-05-24-service-affinity-v2.md §2.3.
      `CREATE TABLE IF NOT EXISTS service_affinity_predictions (id BIGINT NOT NULL AUTO_INCREMENT, customer_id BIGINT NOT NULL, predicted_service VARCHAR(64) NOT NULL, confidence DECIMAL(5,4) NOT NULL, features_json JSON NOT NULL, model_version VARCHAR(32) NOT NULL, ab_arm ENUM('treatment','control') NOT NULL DEFAULT 'treatment', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (id), INDEX idx_customer_created (customer_id, created_at DESC), INDEX idx_model_created (model_version, created_at), INDEX idx_ab_arm_created (ab_arm, created_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_impressions (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, surface VARCHAR(64) NOT NULL, operator_id VARCHAR(64) NULL, PRIMARY KEY (id), INDEX idx_prediction_shown (prediction_id, shown_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_actions (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, action VARCHAR(32) NOT NULL, acted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, operator_id VARCHAR(64) NULL, PRIMARY KEY (id), INDEX idx_prediction_acted (prediction_id, acted_at), INDEX idx_action_acted (action, acted_at)) ENGINE=InnoDB`,
      `CREATE TABLE IF NOT EXISTS prediction_outcomes (id BIGINT NOT NULL AUTO_INCREMENT, prediction_id BIGINT NOT NULL, invoice_id BIGINT NULL, matched TINYINT(1) NOT NULL, resolved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, window_days INT NOT NULL, PRIMARY KEY (id), INDEX idx_prediction (prediction_id), INDEX idx_resolved (resolved_at)) ENGINE=InnoDB`,
      // 2026-05-25 · drizzle/0050_wave_audit_unique_pred_surface.sql — UNIQUE KEY
      // Wave-fix-2026-05-25 (audit #100). Adds UNIQUE constraint on
      // (prediction_id, surface) so INSERT IGNORE in crossSellOutreach actually
      // dedupes impressions now that cross-sell-outreach moved from daily (24h)
      // to hourly (2h) tier in Wave C. Without this, hourly cross-sell would
      // bloat prediction_impressions by 12× per prediction per day.
      //
      // Step 1 dedupes any existing rows (defensive — table had ~zero rows pre-fix).
      // Step 2 adds the UNIQUE KEY. The existing catch in this loop recognizes
      // "Duplicate" in the error message so re-runs are idempotent.
      `DELETE FROM prediction_impressions WHERE id NOT IN (SELECT * FROM (SELECT MIN(id) FROM prediction_impressions GROUP BY prediction_id, surface) AS keepers)`,
      `ALTER TABLE prediction_impressions ADD UNIQUE KEY uk_prediction_surface (prediction_id, surface)`,
      // 2026-05-27 · drizzle/0062_search_performance_dedupe.sql · audit #79,
      // corrected 2026-07-11 (Wave-1 reconciliation). GSC sync was
      // duplicating rows on every cron run (~30-60× inflation confirmed
      // against live GSC). The original fix here grouped the dedupe DELETE
      // and the UNIQUE KEY by (date, query, page) ONLY — narrower than the
      // device/country/searchType-aware key drizzle/schema.ts has always
      // declared (uq_search_perf_date_query_page_device_country_type,
      // schema.ts ~L2877). Every click of this "Run migrations" button
      // therefore collapsed all device/country/searchType breakdowns for a
      // given (date, query, page) down to one row — a silent, destructive,
      // repeatable data-loss bug, not a one-time migration. Corrected to
      // dedupe and key on the FULL 6-column tuple the schema actually
      // defines: this only removes byte-identical duplicate rows (safe) and
      // preserves every distinct device/country/searchType breakdown.
      //
      //   1. Normalize NULL pages so the unique key covers every row
      //   2. Dedupe · keep only MAX(id) per the full wide tuple (safe — no
      //      distinct device/country/searchType combination is collapsed)
      //   3. Add the WIDE UNIQUE KEY, name matching schema.ts so drizzle-kit
      //      introspection stays in sync. TiDB/MySQL do NOT support IF NOT
      //      EXISTS in the ADD {INDEX|KEY} clause — it's an ER_PARSE_ERROR.
      //
      // Prefix lengths recomputed for the wider column set: query(191) +
      // page(450) chars ×4 (utf8mb4) = 2564 bytes, + device(20)+country(10)+
      // searchType(20) chars ×4 = 200 bytes, + date (~3 bytes) = 2767 bytes,
      // safely under the 3072-byte InnoDB index-key cap (prior narrow key
      // alone was already 3020 bytes with zero room for the extra columns).
      //
      // Idempotency comes from the catch block above: once the index exists
      // TiDB throws ER_DUP_KEYNAME ("Duplicate key name '...'"), whose message
      // the "Duplicate" substring match catches -> skipped. The dedupe in
      // step 2 protects the first creation from an ER_DUP_ENTRY violation.
      // NOTE: if the narrow key `uq_search_perf_date_query_page` is present
      // in prod from a prior run of this endpoint, it must be dropped
      // separately (DROP KEY) before this ADD KEY can coexist cleanly —
      // verify via `SHOW INDEX FROM search_performance` before relying on
      // wide-granularity data for any date range this endpoint has touched.
      `UPDATE search_performance SET page = '' WHERE page IS NULL`,
      `DELETE FROM search_performance WHERE id NOT IN (SELECT * FROM (SELECT MAX(id) FROM search_performance GROUP BY date, query, page, device, country, searchType) AS keepers)`,
      `ALTER TABLE search_performance ADD UNIQUE KEY uq_search_perf_date_query_page_device_country_type (date, query(191), page(450), device, country, searchType)`,
      // 2026-05-30 · drizzle/0063_nonstop_nick_memberships.sql — Nonstop Nick
      // $7.99/mo tire membership. status mirrors the Stripe subscription (set by
      // the /api/webhooks/stripe subscription handler) so the counter verifies a
      // member by phone WITHOUT a live Stripe call. Indexes: phone+status (counter
      // lookup), unique stripeSubscriptionId (idempotent webhook upsert).
      // Inlined here so it applies via the runMigrations admin tRPC (Chrome path).
      `CREATE TABLE IF NOT EXISTS memberships (id INT AUTO_INCREMENT PRIMARY KEY, plan VARCHAR(64) NOT NULL DEFAULT 'nonstop-nick', phone VARCHAR(20) NOT NULL, name VARCHAR(255) NULL, email VARCHAR(320) NULL, vehiclePlate VARCHAR(16) NULL, vehicleDesc VARCHAR(255) NULL, status ENUM('active','past_due','canceled','incomplete') NOT NULL DEFAULT 'incomplete', stripeCustomerId VARCHAR(64) NULL, stripeSubscriptionId VARCHAR(64) NULL, currentPeriodEnd TIMESTAMP NULL, canceledAt TIMESTAMP NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_membership_phone (phone), INDEX idx_membership_status (status), UNIQUE KEY uq_membership_stripe_sub (stripeSubscriptionId))`,
      // 2026-06-01 · drizzle/0065_ig_autopost_log.sql — autonomous IG+FB autoposter log.
      // One row per run (dryrun|posted|failed|aborted). Indexes serve: anti-repetition
      // (recent conceptKeys), once-per-slot-per-day dedupe (guards the 15-min cron from
      // double-posting inside one slot window), and admin review-by-status. Bare
      // identifiers — none are reserved words, so no backtick-escaping needed. The cron's
      // slot-dedupe fail-OPENS when this table is missing, so it MUST exist in prod
      // before IG_AUTOPOST_DRYRUN=false, or each slot double-posts.
      `CREATE TABLE IF NOT EXISTS ig_autopost_log (id INT AUTO_INCREMENT PRIMARY KEY, archetype VARCHAR(20) NOT NULL, conceptKey VARCHAR(64) NOT NULL, slot VARCHAR(16) NOT NULL DEFAULT 'manual', slotDate VARCHAR(10) NOT NULL, evalScoresJson TEXT NULL, captionWeighted INT NULL, overallScore INT NULL, status VARCHAR(16) NOT NULL, caption TEXT NOT NULL, hashtags TEXT NULL, imagePrompt TEXT NULL, imageUrl VARCHAR(1000) NULL, igPostId VARCHAR(64) NULL, fbPostId VARCHAR(64) NULL, error VARCHAR(500) NULL, source VARCHAR(16) NOT NULL DEFAULT 'cron', createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_ig_autopost_created (createdAt), INDEX idx_ig_autopost_slot_day (slot, slotDate), INDEX idx_ig_autopost_status (status))`,
      // 2026-06-18 · drizzle/0071_scheduled_posts.sql — publish-later queue.
      // The scheduled-posts cron fires due owner-scheduled rows through
      // socialPublish; until this table exists, listScheduled/schedulePost
      // error (gracefully). Idempotent CREATE TABLE IF NOT EXISTS — the loop's
      // "already exists" catch makes re-runs no-ops.
      `CREATE TABLE IF NOT EXISTS scheduled_posts (id INT AUTO_INCREMENT PRIMARY KEY, platforms JSON NOT NULL, caption TEXT NOT NULL, imageUrl VARCHAR(1000) NULL, videoUrl VARCHAR(1000) NULL, imageUrls JSON NULL, scheduledAt TIMESTAMP NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'pending', postedAt TIMESTAMP NULL, igPostId VARCHAR(64) NULL, error VARCHAR(500) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_scheduled_due (status, scheduledAt))`,
      // Content Domination Engine tables (2026-06-24)
      `CREATE TABLE IF NOT EXISTS content_manufacturing_campaigns (
        id VARCHAR(64) PRIMARY KEY,
        topic VARCHAR(128) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        target_monthly_volume INT NOT NULL DEFAULT 30,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_campaign_topic (topic)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS social_content_inventory (
        id VARCHAR(64) PRIMARY KEY,
        campaign_id VARCHAR(64) NULL,
        content_type ENUM('reel', 'carousel', 'post', 'story', 'poll') NOT NULL,
        platform ENUM('instagram', 'facebook', 'both') NOT NULL DEFAULT 'both',
        topic VARCHAR(128) NOT NULL,
        series_name VARCHAR(128) NOT NULL,
        episode_number INT NOT NULL DEFAULT 1,
        hook_category VARCHAR(64) NOT NULL,
        hook_text TEXT NOT NULL,
        body_text TEXT NOT NULL,
        visual_style VARCHAR(64) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        score_curiosity INT NOT NULL DEFAULT 0,
        score_emotion INT NOT NULL DEFAULT 0,
        score_shareability INT NOT NULL DEFAULT 0,
        score_comment_potential INT NOT NULL DEFAULT 0,
        score_save_potential INT NOT NULL DEFAULT 0,
        score_local_relevance INT NOT NULL DEFAULT 0,
        score_revenue_relevance INT NOT NULL DEFAULT 0,
        score_authority INT NOT NULL DEFAULT 0,
        score_hook_strength INT NOT NULL DEFAULT 0,
        score_overall INT NOT NULL DEFAULT 0,
        gsc_query_seed VARCHAR(255) NULL,
        weather_trigger_condition VARCHAR(128) NULL,
        interactive_dm_keyword VARCHAR(64) NULL,
        metrics_reach INT DEFAULT 0,
        metrics_engagement INT DEFAULT 0,
        metrics_shares INT DEFAULT 0,
        metrics_saves INT DEFAULT 0,
        metrics_comments INT DEFAULT 0,
        metrics_bookings_attributed INT DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        scheduled_at TIMESTAMP NULL DEFAULT NULL,
        published_at TIMESTAMP NULL DEFAULT NULL,
        asset_paths JSON NULL,
        brief_json TEXT NULL,
        error_message VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sci_status_scheduled (status, scheduled_at),
        INDEX idx_sci_campaign (campaign_id),
        INDEX idx_sci_topic_type (topic, content_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_reach INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_engagement INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_shares INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_saves INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_comments INT DEFAULT 0`,
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS metrics_bookings_attributed INT DEFAULT 0`,
      // 2026-07-07 · BE-DATA-1 · first DB-level FK on nickstire (120 tables had
      // zero). sms_messages.conversationId -> sms_conversations.id. Applied to
      // prod TiDB v8.5.3 first (pre-check: 0 orphans of 8,776 rows; verified
      // constraint present). ON DELETE CASCADE is inert in practice — nothing
      // in server/ ever deletes a conversation. Not natively idempotent (TiDB
      // has no ADD CONSTRAINT IF NOT EXISTS), but the loop's catch tolerates the
      // "Duplicate foreign key constraint name" re-run error. Drizzle def:
      // drizzle/schema.ts smsMessages.conversationId.references(...).
      `ALTER TABLE sms_messages ADD CONSTRAINT fk_sms_msg_conv FOREIGN KEY (conversationId) REFERENCES sms_conversations(id) ON DELETE CASCADE`,
      // 2026-07-07 · BE-DATA-1 wave 2 · invoices.customerId -> customers.id.
      // ON DELETE SET NULL — an invoice is a financial record; never cascade-
      // delete it, just unlink. Nullable (395 of 2,792 rows are legitimately
      // unmatched imports). Applied to prod first (pre-check: 0 orphans).
      // Loop-catch tolerates the "Duplicate ... constraint" re-run error.
      // (work_orders.customer_id -> customers.id was DEFERRED — its lone row is
      //  an orphan pointing at a missing customer; operator cleans that 1 row.)
      `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL`,
      // 2026-07-07 · BE-DATA-1 wave 3 · 9 ownership CASCADE FKs (parents never
      // deleted in server/ -> cascade dormant) + work_orders->customers SET NULL.
      // All applied to prod TiDB first (per-pair pre-check: 0 orphans; the one
      // work_orders orphan pointer was NULLed, row preserved). Types verified
      // (varchar(36) UUID + bigint keys match parents). Loop-catch tolerates the
      // Duplicate-constraint re-run error. Drizzle defs: drizzle/schema.ts .references().
      `ALTER TABLE inspection_items ADD CONSTRAINT fk_inspection_items_inspection FOREIGN KEY (inspectionId) REFERENCES vehicle_inspections(id) ON DELETE CASCADE`,
      `ALTER TABLE customer_metrics ADD CONSTRAINT fk_customer_metrics_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      // fk_vehicles_customer removed 2026-09-23: drizzle/0117 retired the vehicles
      // table, so the statement failed with ER_NO_SUCH_TABLE on every run and every
      // run reported one error (measured on the 2026-09-23 01:54Z run).
      `ALTER TABLE work_order_items ADD CONSTRAINT fk_wo_items_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE work_order_transitions ADD CONSTRAINT fk_wo_transitions_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE qc_checklists ADD CONSTRAINT fk_qc_checklists_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE`,
      `ALTER TABLE prediction_impressions ADD CONSTRAINT fk_pred_impressions_pred FOREIGN KEY (prediction_id) REFERENCES service_affinity_predictions(id) ON DELETE CASCADE`,
      `ALTER TABLE prediction_actions ADD CONSTRAINT fk_pred_actions_pred FOREIGN KEY (prediction_id) REFERENCES service_affinity_predictions(id) ON DELETE CASCADE`,
      `ALTER TABLE sms_orchestration_outcomes ADD CONSTRAINT fk_sms_orch_outcomes_orch FOREIGN KEY (orchestration_id) REFERENCES sms_orchestrations(id) ON DELETE CASCADE`,
      `ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      // 2026-07-07 · BE-DATA-1 wave 4/5 · 19 more FKs (money-adjacent SET NULL +
      // RESTRICT ledgers/technicians + one CASCADE). All applied to prod first,
      // per-pair pre-check 0 orphans (pure additive, no data writes), types
      // verified vs parent PKs. Skipped invoices.workOrderId (int) -> work_orders.id
      // (varchar(36)) — impossible FK, type mismatch. Loop-catch = idempotent.
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_callback FOREIGN KEY (callbackId) REFERENCES callback_requests(id) ON DELETE SET NULL`,
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE leads ADD CONSTRAINT fk_leads_invoice FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE invoices ADD CONSTRAINT fk_invoices_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE estimates_log ADD CONSTRAINT fk_estlog_invoice FOREIGN KEY (invoiceId) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE estimates_log ADD CONSTRAINT fk_estlog_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE alg_estimates ADD CONSTRAINT fk_algest_invoice FOREIGN KEY (matched_invoice_id) REFERENCES invoices(id) ON DELETE SET NULL`,
      `ALTER TABLE alg_estimates ADD CONSTRAINT fk_algest_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE vapi_call_logs ADD CONSTRAINT fk_vapi_lead FOREIGN KEY (leadId) REFERENCES leads(id) ON DELETE SET NULL`,
      `ALTER TABLE vapi_call_logs ADD CONSTRAINT fk_vapi_callback FOREIGN KEY (callbackId) REFERENCES callback_requests(id) ON DELETE SET NULL`,
      `ALTER TABLE payments ADD CONSTRAINT fk_payments_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE tire_orders ADD CONSTRAINT fk_tireorders_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE tire_orders ADD CONSTRAINT fk_tireorders_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE warranties ADD CONSTRAINT fk_warranties_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL`,
      `ALTER TABLE payments ADD CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT`,
      `ALTER TABLE loyalty_transactions ADD CONSTRAINT fk_loyalty_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE RESTRICT`,
      `ALTER TABLE job_assignments ADD CONSTRAINT fk_jobassign_tech FOREIGN KEY (technicianId) REFERENCES technicians(id) ON DELETE RESTRICT`,
      `ALTER TABLE warranties ADD CONSTRAINT fk_warranties_wo FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE RESTRICT`,
      `ALTER TABLE job_assignments ADD CONSTRAINT fk_jobassign_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE CASCADE`,
      // 2026-07-07 · BE-DATA-1 wave 5 · 8 more FKs (nickstire 31 -> 39). Owned-
      // record CASCADE (incl. 2 LIVE cascades where bookings ARE deleted:
      // review_requests + appointment_reminders) + service_history SET NULL.
      // Applied to prod first: 8 pairs 0 orphans; review_requests had 4 orphaned
      // test/sentinel rows (bookingId 0/99999, terminal status) DELETED per
      // operator confirmation, then FK added. Types verified.
      // SKIPPED service_affinity_predictions.customer_id -> customers.id: DB
      // column is BIGINT while customers.id is INT (ER_FK_INCOMPATIBLE_COLUMNS) —
      // impossible FK + a latent schema drift (drizzle declares int). Documented.
      `ALTER TABLE customer_vehicles ADD CONSTRAINT fk_custveh_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_vehicle FOREIGN KEY (vehicleId) REFERENCES customer_vehicles(id) ON DELETE SET NULL`,
      `ALTER TABLE service_history ADD CONSTRAINT fk_svchist_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE SET NULL`,
      `ALTER TABLE review_requests ADD CONSTRAINT fk_reviewreq_booking FOREIGN KEY (bookingId) REFERENCES bookings(id) ON DELETE CASCADE`,
      `ALTER TABLE winback_sends ADD CONSTRAINT fk_winback_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE sms_campaign_sends ADD CONSTRAINT fk_smscampsend_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE`,
      `ALTER TABLE appointment_reminders ADD CONSTRAINT fk_apptremind_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE`,
      // 2026-07-07 · schema-drift audit · conversation_memory.conversionHits was
      // declared in drizzle + written by chat.ts (memory merge + conversion
      // reinforcement UPDATEs) but MISSING from the DB — those UPDATEs threw
      // "Unknown column", silently breaking chat conversion tracking. Add it.
      // Additive + safe (NOT NULL DEFAULT 0). IF NOT EXISTS = idempotent.
      `ALTER TABLE conversation_memory ADD COLUMN IF NOT EXISTS conversionHits INT NOT NULL DEFAULT 0`,
      // 2026-07-07 · BE-DATA-2 · customer phone-uniqueness. VIRTUAL generated
      // last-10 digits + a unique index reject a duplicate customer regardless
      // of stored phone format. Applied to prod first (0 dups; all insert paths
      // already catch ER_DUP_ENTRY). VIRTUAL — TiDB forbids ADD of a STORED
      // generated column via ALTER. IF NOT EXISTS + loop-catch = idempotent.
      // Drizzle def: drizzle/schema.ts customers.phone10 + uniq_customer_phone10.
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone10 VARCHAR(10) GENERATED ALWAYS AS (RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) VIRTUAL`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_phone10 ON customers(phone10)`,
      // 2026-07-10 · IG approvals integrity
      `ALTER TABLE social_content_inventory ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`,
      `CREATE TABLE IF NOT EXISTS social_content_approvals (id VARCHAR(64) PRIMARY KEY, inventory_id VARCHAR(64) NOT NULL, version INT NOT NULL, approved_by INT NOT NULL, brief_hash VARCHAR(64) NOT NULL, media_hash VARCHAR(64) NOT NULL, media_url TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uniq_sca_inventory_version (inventory_id, version), INDEX idx_sca_inventory_version (inventory_id, version))`,
      // 2026-09-09 · drizzle/0120_camera_runtime.sql — producer heartbeats (the
      // infrastructure fact) apart from visits (the business fact), plus the
      // commissioning data class so a test drive never becomes a customer arrival.
      // Byte-for-byte the statements in the migration file; additive and idempotent.
      `CREATE TABLE IF NOT EXISTS camera_runtime (camera VARCHAR(64) NOT NULL, producerInstanceId VARCHAR(64) NOT NULL, producerVersion VARCHAR(64) NULL, gitSha VARCHAR(40) NULL, heartbeatSeq INT NOT NULL DEFAULT 0, observedAtEdge TIMESTAMP NULL DEFAULT NULL, receivedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, mode VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION', commissioningRunId VARCHAR(64) NULL, sourceType VARCHAR(32) NULL, sourceGeneration VARCHAR(64) NULL, sourceConnected TINYINT(1) NULL, lastFrameAt TIMESTAMP NULL DEFAULT NULL, lastHealthyFrameAt TIMESTAMP NULL DEFAULT NULL, captureFps FLOAT NULL, frameOk TINYINT(1) NULL, poseOk TINYINT(1) NULL, poseDelta FLOAT NULL, calibrationVersion VARCHAR(32) NULL, detectorName VARCHAR(128) NULL, modelSha256 VARCHAR(64) NULL, lastInferenceAt TIMESTAMP NULL DEFAULT NULL, inferenceP95Ms FLOAT NULL, openVisits INT NULL, outboxDepth INT NULL, oldestOutboxAgeSeconds INT NULL, deadLetterDepth INT NULL, lastCloudAckAt TIMESTAMP NULL DEFAULT NULL, diskFreeBytes BIGINT NULL, restores INT NULL, state VARCHAR(32) NOT NULL, stateSince TIMESTAMP NULL DEFAULT NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (camera), INDEX idx_camera_runtime_receivedAt (receivedAt))`,
      `CREATE TABLE IF NOT EXISTS camera_health_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, camera VARCHAR(64) NOT NULL, fromState VARCHAR(32) NULL, toState VARCHAR(32) NOT NULL, reason VARCHAR(191) NULL, producerInstanceId VARCHAR(64) NULL, sourceGeneration VARCHAR(64) NULL, at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_camera_health_events_camera_at (camera, at))`,
      `ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS dataClass VARCHAR(16) NOT NULL DEFAULT 'PRODUCTION'`,
      `ALTER TABLE vehicle_visits ADD COLUMN IF NOT EXISTS commissioningRunId VARCHAR(64) NULL`,
      `CREATE INDEX IF NOT EXISTS idx_vehicle_visits_dataClass ON vehicle_visits (dataClass)`,
      // 2026-09-09 · drizzle/0123_commissioning.sql — the human witness for a controlled
      // drive. TIMESTAMP(3): a portal crossing and a button press are hundreds of
      // milliseconds apart, and whole seconds would round the quantity being measured.
      `CREATE TABLE IF NOT EXISTS commissioning_runs (runId VARCHAR(64) NOT NULL, camera VARCHAR(64) NOT NULL, label VARCHAR(191) NULL, startedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), endedAt TIMESTAMP(3) NULL DEFAULT NULL, startedBy VARCHAR(191) NULL, clockOffsetMs INT NULL, clockRttMs INT NULL, clockSamples INT NULL, monoOriginAt TIMESTAMP(3) NULL DEFAULT NULL, verdict VARCHAR(16) NULL, verdictReason VARCHAR(500) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (runId), INDEX idx_commissioning_runs_camera (camera, startedAt))`,
      `CREATE TABLE IF NOT EXISTS commissioning_truth_events (id BIGINT AUTO_INCREMENT PRIMARY KEY, runId VARCHAR(64) NOT NULL, event VARCHAR(24) NOT NULL, phoneWallAt TIMESTAMP(3) NOT NULL, phoneMonoMs BIGINT NULL, serverReceivedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), correctedAt TIMESTAMP(3) NULL DEFAULT NULL, note VARCHAR(191) NULL, createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_truth_events_run (runId, phoneWallAt))`
    ];

    let applied = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const rawSql of migrations) {
      try {
        const { sql: sqlTag } = await import("drizzle-orm");
        await d.execute(sqlTag.raw(rawSql));
        applied++;
      } catch (err: unknown) {
        const e = err as { message?: string; code?: string; cause?: { code?: string; message?: string; errno?: number; sqlMessage?: string } };
        const msg = e?.message || String(err);
        const cause = e?.cause;
        const causeMsg = cause?.sqlMessage || cause?.message || "";
        // Drizzle wraps the real driver error inside `err.cause` \u00b7 we need
        // it to diagnose. Check both layers for already-applied markers.
        const combined = `${msg} | ${causeMsg}`;
        const code = e?.code || cause?.code || "";
        // "Already-applied" wording varies by engine/object:
        //   MySQL: "...already exists" / "Duplicate key name"
        //   TiDB:  "index already exist <name>; a background job is trying to
        //          add the same index" (note "already exist", no trailing 's',
        //          and no "Duplicate"). The "already exist" substring covers
        //          both spellings; the duplicate-object error codes make
        //          re-runs no-ops regardless of the driver's prose.
        const alreadyApplied =
          combined.includes("already exist") ||
          combined.includes("Duplicate") ||
          code === "ER_DUP_KEYNAME" ||
          code === "ER_DUP_ENTRY";
        if (alreadyApplied) {
          skipped++;
        } else {
          skipped++;
          errors.push(`${rawSql.slice(0, 60)}... \u2192 msg=${msg.slice(0, 200)} | code=${e?.code || cause?.code || ""} | cause=${causeMsg.slice(0, 300)}`);
        }
      }
    }

    return { success: true, applied, skipped, total: migrations.length, errors: errors.length > 0 ? errors : undefined };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
