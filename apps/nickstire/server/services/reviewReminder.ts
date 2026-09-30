/**
 * Q-39 · one review reminder around day 13, as a DRAFT-ONLY experiment.
 *
 * Evidence: Jung et al., Journal of Marketing 87(4), 2023 — two field
 * experiments (300k+ consumers, a travel marketplace, not a repair shop): one
 * reminder about day 13 lifted reviews; a next-day reminder did not. That is a
 * hypothesis for this shop, not a fact about it, so the lane is built to be
 * measured, not assumed:
 *
 *   - Nothing here sends. A treatment-arm customer gets a `drafted` row in
 *     sms_orchestrations with requiresHumanApproval=true, which is exactly what
 *     the Human Review Queue lists (routers/smsOrchestrator.ts
 *     getHumanReviewQueue). The operator's "send" there is the only way out,
 *     and it goes through sendSms's full chokepoint (opt-out, caps, quiet hours).
 *   - Arming needs TWO switches, both OFF by default: `contact_holdouts_enabled`
 *     (the Q-21 master) and `review_reminder_drafts` (this lane). The lane is an
 *     experiment or it is nothing: with no durable arm assignment there is no
 *     draft, because an unrecorded reminder is contact nobody can measure.
 *   - The control arm (15%, contactExperiment.ts) gets no draft; its
 *     contact_experiment_assignments row is the record that it was withheld.
 *   - The reminder reuses the ORIGINAL request's tracking link, so a click lands
 *     on the same review_requests row (clickedAt). The readout is clicked-after-
 *     assignment by arm, intent-to-treat: a treatment draft the operator never
 *     sends still counts as treatment.
 *
 * "Day 13" is counted from the request row's createdAt (scheduled at booking
 * completion), not from the send: the send delay is an operator setting (the
 * bootstrap default is 1 day, the flag text says 3), so sentAt drifts with it.
 * Ages are computed IN SQL (TIMESTAMPDIFF against NOW()): driver-parsed TiDB
 * datetimes come back shifted on Eastern, and so would a JS Date bound as a
 * parameter (apps/nickstire/AGENTS.md "Time").
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { SITE_URL } from "@shared/business";
import { STORE_NAME } from "@shared/const";
import { reviewRequests, smsOrchestrations } from "../../drizzle/schema";
import { getDbTyped, getReviewSettings } from "../db";
import { createLogger } from "../lib/logger";
import { withOptOut, loadSuppressionIndex } from "../sms";
import { resolveContactExperiment } from "./contactExperiment";
import { isEnabled } from "./featureFlags";

const log = createLogger("review-reminder");

/** Reminder is due this many days after the request row was created. */
const REVIEW_REMINDER_AGE_DAYS = 13;
/** Past AGE + WINDOW days the request is stale: no reminder, and no backlog blast on first arming. */
const REVIEW_REMINDER_WINDOW_DAYS = 7;
/** Never within this many days of the original text ("never next-day"). */
const REVIEW_REMINDER_MIN_GAP_DAYS = 7;
/** Drafts written per run. The operator reviews each one by hand. */
const REVIEW_REMINDER_MAX_DRAFTS_PER_RUN = 20;

const REVIEW_REMINDER_VARIANT_KEY = "review_reminder";

interface ReminderCandidate {
  id: number;
  bookingId: number;
  customerName: string;
  phone: string;
  status: string;
  sentAt: Date | null;
  clickedAt: Date | null;
  createdAt: Date;
  trackingToken: string;
  /** Hours since the request row was created, from SQL. */
  ageHours: number | null;
  /** Hours since the original text went out, from SQL; null when never sent. */
  sentAgeHours: number | null;
}

interface PhoneRequestRow {
  id: number;
  phone: string;
  createdAt: Date;
}

function reviewReminderIdempotencyKey(reviewRequestId: number): string {
  return `review_reminder:${reviewRequestId}`;
}

/**
 * Pure selection. Keeps a request only when it was actually sent, never
 * clicked, is inside the day-13 window, its text is at least MIN_GAP days old,
 * and no NEWER request exists for the same phone (a repeat visit restarts the
 * flow; the old visit gets no reminder). At most one per phone, oldest first.
 */
function selectDueReminders(
  candidates: ReminderCandidate[],
  requestsForPhones: PhoneRequestRow[],
  alreadyDrafted: Set<string>,
): ReminderCandidate[] {
  const dueAtHours = REVIEW_REMINDER_AGE_DAYS * 24;
  const staleAtHours = (REVIEW_REMINDER_AGE_DAYS + REVIEW_REMINDER_WINDOW_DAYS) * 24;
  const minGapHours = REVIEW_REMINDER_MIN_GAP_DAYS * 24;

  const newestByPhone = new Map<string, number>();
  for (const r of requestsForPhones) {
    const t = r.createdAt.getTime();
    if (t > (newestByPhone.get(r.phone) ?? -Infinity)) newestByPhone.set(r.phone, t);
  }

  const seenPhones = new Set<string>();
  const due: ReminderCandidate[] = [];
  const ordered = [...candidates].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  for (const c of ordered) {
    const created = c.createdAt.getTime();
    if (c.status !== "sent" || c.clickedAt) continue;
    if (!c.sentAt || c.sentAgeHours === null || c.sentAgeHours < minGapHours) continue;
    if (c.ageHours === null || c.ageHours < dueAtHours || c.ageHours >= staleAtHours) continue;
    if ((newestByPhone.get(c.phone) ?? created) > created) continue;
    if (alreadyDrafted.has(reviewReminderIdempotencyKey(c.id))) continue;
    if (seenPhones.has(c.phone)) continue;
    seenPhones.add(c.phone);
    due.push(c);
    if (due.length >= REVIEW_REMINDER_MAX_DRAFTS_PER_RUN) break;
  }
  return due;
}

/** Deterministic copy: one short ask, the same link, no pressure, no invented facts. */
function buildReviewReminderMessage(customerName: string, trackingUrl: string): string {
  const first = customerName.trim().split(/\s+/)[0] ?? "";
  const greeting = first && !/^customer$/i.test(first) ? `Hi ${first}, ` : "Hi, ";
  return withOptOut(
    `${greeting}one last note from ${STORE_NAME}: if you have a minute, a quick Google review of your visit helps other Cleveland drivers find us. ${trackingUrl}\n\nNo reply needed — thank you!`,
  );
}

interface ReviewReminderRunResult {
  drafted: number;
  heldOut: number;
  skipped: number;
  reason?: string;
}

export async function draftReviewReminders(): Promise<ReviewReminderRunResult> {
  if (!(await isEnabled("review_reminder_drafts"))) {
    return { drafted: 0, heldOut: 0, skipped: 0, reason: "flag review_reminder_drafts off" };
  }
  if (!(await isEnabled("contact_holdouts_enabled"))) {
    return { drafted: 0, heldOut: 0, skipped: 0, reason: "flag contact_holdouts_enabled off (the reminder lane runs only as a measured experiment)" };
  }
  const settings = await getReviewSettings();
  if (!settings.enabled) {
    return { drafted: 0, heldOut: 0, skipped: 0, reason: "review requests are disabled in settings" };
  }

  const db = await getDbTyped();
  if (!db) throw new Error("Database unavailable — review reminder candidates are unknown, not empty.");

  const candidates: ReminderCandidate[] = await db
    .select({
      id: reviewRequests.id,
      bookingId: reviewRequests.bookingId,
      customerName: reviewRequests.customerName,
      phone: reviewRequests.phone,
      status: reviewRequests.status,
      sentAt: reviewRequests.sentAt,
      clickedAt: reviewRequests.clickedAt,
      createdAt: reviewRequests.createdAt,
      trackingToken: reviewRequests.trackingToken,
      ageHours: sql<number | null>`TIMESTAMPDIFF(HOUR, ${reviewRequests.createdAt}, NOW())`,
      sentAgeHours: sql<number | null>`TIMESTAMPDIFF(HOUR, ${reviewRequests.sentAt}, NOW())`,
    })
    .from(reviewRequests)
    .where(and(
      eq(reviewRequests.status, "sent"),
      isNull(reviewRequests.clickedAt),
      sql`${reviewRequests.createdAt} <= NOW() - INTERVAL ${sql.raw(String(REVIEW_REMINDER_AGE_DAYS))} DAY`,
      sql`${reviewRequests.createdAt} > NOW() - INTERVAL ${sql.raw(String(REVIEW_REMINDER_AGE_DAYS + REVIEW_REMINDER_WINDOW_DAYS))} DAY`,
    ))
    .orderBy(reviewRequests.createdAt)
    .limit(200);
  if (candidates.length === 0) return { drafted: 0, heldOut: 0, skipped: 0 };

  const phones = [...new Set(candidates.map((c) => c.phone))];
  const requestsForPhones: PhoneRequestRow[] = await db
    .select({ id: reviewRequests.id, phone: reviewRequests.phone, createdAt: reviewRequests.createdAt })
    .from(reviewRequests)
    .where(inArray(reviewRequests.phone, phones));

  const keys = candidates.map((c) => reviewReminderIdempotencyKey(c.id));
  const existing = await db
    .select({ key: smsOrchestrations.idempotencyKey })
    .from(smsOrchestrations)
    .where(inArray(smsOrchestrations.idempotencyKey, keys));
  const alreadyDrafted = new Set(existing.map((r) => r.key).filter((k): k is string => !!k));

  const due = selectDueReminders(candidates, requestsForPhones, alreadyDrafted);
  if (due.length === 0) return { drafted: 0, heldOut: 0, skipped: candidates.length };

  // An unreadable suppression list is "unknown", never "nobody opted out".
  const suppression = await loadSuppressionIndex();
  if (!suppression.ok) {
    throw new Error(`Opt-out list unavailable (${suppression.reason}) — review reminders not drafted.`);
  }

  let drafted = 0;
  let heldOut = 0;
  let skipped = candidates.length - due.length;
  for (const req of due) {
    if (suppression.phones.has(req.phone) || suppression.carrierBlocked.has(req.phone)) {
      skipped++;
      continue;
    }
    const e164 = `+1${req.phone}`;
    const decision = await resolveContactExperiment(e164, REVIEW_REMINDER_VARIANT_KEY);
    if (!decision.measurable || !decision.armId) {
      skipped++;
      log.info("[ReviewReminder] no durable arm; no draft", { requestId: req.id, reason: decision.reason });
      continue;
    }
    if (decision.armId === "control") {
      heldOut++;
      continue;
    }

    const trackingUrl = `${SITE_URL}/api/review-click/${req.trackingToken}`;
    await db.insert(smsOrchestrations).values({
      eventType: REVIEW_REMINDER_VARIANT_KEY,
      customerPhone: e164,
      messageBody: buildReviewReminderMessage(req.customerName, trackingUrl),
      variantKey: REVIEW_REMINDER_VARIANT_KEY,
      shouldAutoSend: false,
      requiresHumanApproval: true,
      reason: "q39_review_reminder_experiment",
      providerUsed: "shop",
      status: "drafted",
      statusReason: "draft_only_experiment",
      noSendReason: "draft_only_mode",
      humanReviewReason: "review_reminder_draft_only",
      riskTier: "medium",
      sourceTable: "review_requests",
      sourceId: String(req.id),
      relatedBookingId: req.bookingId,
      selectedTemplateKey: REVIEW_REMINDER_VARIANT_KEY,
      experimentId: decision.experimentId,
      isControl: false,
      idempotencyKey: reviewReminderIdempotencyKey(req.id),
    });
    drafted++;
  }

  return { drafted, heldOut, skipped };
}
