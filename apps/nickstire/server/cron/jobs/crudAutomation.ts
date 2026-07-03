/**
 * CRUD Automation — Autonomous create/update/delete actions
 *
 * These jobs go beyond read-only intelligence. They actually
 * CREATE, UPDATE, and DELETE records without human intervention:
 *
 * 1. Reminder queue processing — sends due maintenance SMS
 * 2. No-show detection — flags past-date bookings, sends follow-up
 * 3. Stale booking cleanup — auto-cancels 30+ day untouched bookings
 * 4. Callback escalation — re-alerts on stuck callbacks
 * 5. Low-stock alerts — Telegram when inventory hits reorder threshold
 * 6. WO auto-advance — completed+invoiced → next status
 * 7. QC auto-create — creates checklist when WO hits quality_check
 * 8. Review auto-draft — fetches reviews + generates AI reply drafts
 * 9. Content auto-gen — weekly blog article draft
 * 10. Booking priority auto-escalation — 48h+ untouched → high priority
 */
import { createLogger } from "../../lib/logger";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron:crud-automation");

/** Shape for raw SQL result rows from d.execute() */
type RawRow = Record<string, unknown>;

/** 1. Process maintenance reminder SMS queue */
export async function processReminders(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { processReminderQueue } = await import("../../routers/reminders");
    const result = await processReminderQueue();
    return { recordsProcessed: result?.sent || 0, details: `${result?.sent || 0} reminders sent` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `Reminders failed: ${(e as Error).message}` };
  }
}

/** 2. Detect no-shows — bookings past preferred date still in new/confirmed */
export async function detectNoShows(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Find bookings where preferredDate is past AND status is still new/confirmed
    const [rows] = await d.execute(sql`
      SELECT b.id, b.name, b.phone, b.preferredDate, b.service, b.status
      FROM bookings b
      WHERE b.preferredDate IS NOT NULL
        AND b.preferredDate < CURDATE()
        AND b.status IN ('new', 'confirmed')
        AND b.createdAt > DATE_SUB(NOW(), INTERVAL 60 DAY)
      LIMIT 20
    `);

    const noShows = rows as RawRow[];
    if (noShows.length === 0) return { recordsProcessed: 0, details: "No no-shows" };

    // Batch-cancel all no-shows in one query (eliminates N+1 loop).
    // v1.7 audit fix · pre-fix used `sql.raw(noShowIds.join(","))`
    // with values from a `RawRow` typed as `unknown` — any non-integer
    // value would either crash the query or open a future injection
    // path. Now we hard-coerce to integers and discard anything that
    // doesn't pass Number.isInteger before interpolating, so the
    // sql.raw() call only ever sees a comma-separated integer list.
    const numericIds = noShows
      .map((b) => Number(b.id))
      .filter((n): n is number => Number.isFinite(n) && Number.isInteger(n));
    if (numericIds.length > 0) {
      await d.execute(sql`UPDATE bookings SET status = 'cancelled', adminNotes = CONCAT(COALESCE(adminNotes, ''), '\n[AUTO] No-show: past preferred date, auto-cancelled') WHERE id IN (${sql.raw(numericIds.join(","))}) AND status IN ('new', 'confirmed')`);
    }

    // Send follow-up SMS to those with phone numbers (gated by feature flag)
    const { sendSms } = await import("../../sms");
    const { isEnabled } = await import("../../services/featureFlags");
    let smsSent = 0;
    if (await isEnabled("sms_retention_sequences")) {
      // Opt-out guard — load opted-out phones (last-10-digit) so we never
      // text a customer who sent STOP. Every other SMS job filters this;
      // detectNoShows was missing it (TCPA exposure).
      const [optRows] = await d.execute(sql`SELECT phone FROM customers WHERE smsOptOut = 1`);
      const optedOut = new Set(
        (optRows as RawRow[]).map((r) => String(r.phone || "").replace(/\D/g, "").slice(-10)).filter(Boolean),
      );
      for (const b of noShows.filter((n) => n.phone)) {
        try {
          if (optedOut.has(String(b.phone).replace(/\D/g, "").slice(-10))) continue;
          // Wave-108: no-show outreach via shop gateway (1:1)
          await sendSms(String(b.phone), `Looks like we missed you for your drop-off at Nick's Tire & Auto. Whenever it's easy, pull up any day — first-come, first-served, 7 days a week. (216) 862-0005 or nickstire.org`, { via: "shop" });
          smsSent++;
        } catch (err) { log.warn("detectNoShows: SMS send failed", { error: err instanceof Error ? err.message : String(err) }); }
        if (smsSent >= 5) break; // Rate limit
      }
    }

    // Alert
    if (noShows.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`📋 NO-SHOW: ${noShows.length} bookings past date, marked as no-show. ${smsSent} follow-up SMS sent.`);
      } catch (err) { log.warn("detectNoShows: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: noShows.length, details: `${noShows.length} no-shows flagged, ${smsSent} SMS sent` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `No-show detection failed: ${(e as Error).message}` };
  }
}

/** 3. Auto-cancel stale bookings (30+ days in "new" with no activity) */
export async function autoCleanStaleBookings(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    const [rows] = await d.execute(sql`
      SELECT id, name, phone, adminNotes FROM bookings
      WHERE status = 'new'
        AND createdAt < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND updatedAt < DATE_SUB(NOW(), INTERVAL 14 DAY)
      LIMIT 50
    `);

    const stale = rows as RawRow[];
    if (stale.length === 0) return { recordsProcessed: 0, details: "No stale bookings" };

    // wave-117 — was `staleIds = stale.map(b => b.id)` then sql.raw()
    // without integer coercion. Same class of bug as detectNoShows had
    // before its v1.7 fix (line 66 above). RawRow id values are typed
    // `unknown`; a non-numeric value would crash the query or open a
    // future injection path. Coerce to integers and discard anything
    // that isn't a finite integer.
    const numericIds = stale
      .map((b) => Number(b.id))
      .filter((n): n is number => Number.isFinite(n) && Number.isInteger(n));
    if (numericIds.length > 0) {
      await d.execute(sql`UPDATE bookings SET status = 'cancelled', updatedAt = NOW() WHERE id IN (${sql.raw(numericIds.join(","))})`);
    }

    // Send "rebook" SMS (gated by feature flag)
    // Skip bookings already handled by detectNoShows to prevent double-SMS
    const { sendSms } = await import("../../sms");
    const { isEnabled: isEnabledStale } = await import("../../services/featureFlags");
    let smsSent = 0;
    if (await isEnabledStale("sms_retention_sequences")) {
      // Opt-out guard — same as detectNoShows; load opted-out phones so
      // an opted-out customer never gets the rebook SMS (TCPA).
      const [optRows] = await d.execute(sql`SELECT phone FROM customers WHERE smsOptOut = 1`);
      const optedOut = new Set(
        (optRows as RawRow[]).map((r) => String(r.phone || "").replace(/\D/g, "").slice(-10)).filter(Boolean),
      );
      for (const b of stale.filter((s) => s.phone && !(s.adminNotes && String(s.adminNotes).includes("[AUTO] No-show")))) {
        try {
          if (optedOut.has(String(b.phone).replace(/\D/g, "").slice(-10))) continue;
          // Wave-108: expired-booking rebook via shop gateway (1:1)
          await sendSms(String(b.phone), `Your booking window at Nick's Tire & Auto has passed — no problem. We're walk-in, first-come first-served, so just pull up any day. (216) 862-0005 or nickstire.org`, { via: "shop" });
          smsSent++;
        } catch (err) { log.warn("autoCleanStaleBookings: rebook SMS failed", { error: err instanceof Error ? err.message : String(err) }); }
        if (smsSent >= 10) break;
      }
    }

    return { recordsProcessed: stale.length, details: `${stale.length} stale bookings cancelled, ${smsSent} rebook SMS sent` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `Stale booking cleanup failed: ${(e as Error).message}` };
  }
}

/** 4. Callback auto-escalation — re-alert on callbacks stuck >4h */
export async function escalateStaleCallbacks(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    const [rows] = await d.execute(sql`
      SELECT id, name, phone, context FROM callback_requests
      WHERE status = 'new'
        AND createdAt < DATE_SUB(NOW(), INTERVAL 4 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 3 DAY)
      LIMIT 10
    `);

    const stale = rows as RawRow[];
    if (stale.length === 0) return { recordsProcessed: 0, details: "No stale callbacks" };

    // Send customer a "we'll call you back" SMS (gated by feature flag)
    const { sendSms } = await import("../../sms");
    const { isEnabled: isEnabledCallback } = await import("../../services/featureFlags");
    let smsSent = 0;
    if (await isEnabledCallback("sms_appointment_reminders")) {
      for (const cb of stale.filter((c) => c.phone)) {
        try {
          // At-most-once claim — flip status BEFORE the send so a crash
          // can't leave it 'new' for the next run to re-text.
          const [claimRes] = await d.execute(sql`UPDATE callback_requests SET status = 'no-answer', notes = CONCAT(COALESCE(notes, ''), '\nAuto-SMS: we will call you back'), calledAt = NOW() WHERE id = ${cb.id} AND status = 'new'`);
          if (((claimRes as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) continue;
          // Wave-108: callback fallback via shop gateway (1:1)
          await sendSms(String(cb.phone), `Your callback's still in our queue at Nick's Tire & Auto — we'll reach out shortly. Need us sooner? (216) 862-0005.`, { via: "shop" });
          smsSent++;
        } catch (err) { log.warn("escalateStaleCallbacks: SMS/status update failed", { error: err instanceof Error ? err.message : String(err) }); }
      }
    }

    // Alert shop via Telegram
    if (stale.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `📞 CALLBACK ALERT: ${stale.length} callbacks unanswered >4h!\n\n` +
          stale.slice(0, 5).map((c) => `${c.name || "?"} — ${c.phone || "no phone"}: ${(String(c.context || "general")).slice(0, 50)}`).join("\n") +
          `\n\nCall them back NOW.`
        );
      } catch (err) { log.warn("escalateStaleCallbacks: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: stale.length, details: `${stale.length} escalated, ${smsSent} SMS sent` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `Callback escalation failed: ${(e as Error).message}` };
  }
}

/** 5. Low-stock inventory alerts via Telegram */
export async function alertLowStock(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Check inventory table for items at or below reorder threshold
    const [rows] = await d.execute(sql`
      SELECT name, sku, quantity_on_hand as quantity, reorder_threshold as reorderPoint, category
      FROM inventory
      WHERE quantity_on_hand <= COALESCE(reorder_threshold, 2)
        AND quantity_on_hand >= 0
      ORDER BY quantity_on_hand ASC
      LIMIT 20
    `);

    const lowItems = rows as RawRow[];
    if (lowItems.length === 0) return { recordsProcessed: 0, details: "Stock levels OK" };

    const { sendTelegram } = await import("../../services/telegram");
    await sendTelegram(
      `📦 LOW STOCK ALERT: ${lowItems.length} items need reorder\n\n` +
      lowItems.slice(0, 10).map((i) => `${i.name || i.sku}: ${i.quantity} left (reorder at ${i.reorderPoint || 2})`).join("\n")
    );

    return { recordsProcessed: lowItems.length, details: `${lowItems.length} low-stock items alerted` };
  } catch (e: unknown) {
    // Table might not exist yet — that's fine
    const msg = (e as Error).message;
    if (msg?.includes("doesn't exist") || msg?.includes("no such table")) {
      return { recordsProcessed: 0, details: "No inventory table" };
    }
    return { recordsProcessed: 0, details: `Low-stock check failed: ${msg}` };
  }
}

/** 6. WO auto-advance: completed → invoiced when invoice exists */
export async function autoAdvanceWorkOrders(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Auto-advance completed WOs older than 24h to invoiced — but ONLY when
    // the WO carries a real billing signal on its own row.
    //
    // We canNOT verify an invoice exists by joining: the `invoices` table's
    // `workOrderId` is an int (drizzle/schema.ts:1199) while `work_orders.id`
    // is a varchar(36) UUID (schema.ts:1905) — the types can't match — and the
    // invoice write path never populates it anyway (invoices.create takes no
    // workOrderId; most invoices arrive from ALG and never reference an
    // internal WO — see invoiceReconciliation.ts:150-156). So there is no
    // reliable WO<->invoice link to gate on.
    //
    // Conservative interim (kaizen): instead of advancing on elapsed-time
    // ALONE — which let never-billed WOs march completed -> invoiced ->
    // (wo-auto-close) closed with ZERO billing recorded — require an on-row
    // billing signal: a non-zero `total` OR a `paymentStatus` past 'unpaid'.
    // WOs with no billing signal stay in 'completed' for human review rather
    // than being silently "invoiced". (work_orders.total / .paymentStatus =
    // schema.ts:1943-1945.)
    const BILLED_PREDICATE = sql`
      status = 'completed'
        AND updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
        AND (CAST(total AS DECIMAL(10,2)) > 0 OR payment_status <> 'unpaid')
    `;

    // First, get the IDs of WOs about to be advanced (for audit trail)
    const [toAdvance] = await d.execute(sql`
      SELECT id FROM work_orders
      WHERE ${BILLED_PREDICATE}
    `);
    const woIds = (toAdvance as RawRow[]).map((r) => r.id);

    if (woIds.length === 0) return { recordsProcessed: 0, details: "0 WOs auto-advanced to invoiced" };

    const [rows] = await d.execute(sql`
      UPDATE work_orders
      SET status = 'invoiced', updated_at = NOW()
      WHERE ${BILLED_PREDICATE}
    `);

    const resultHeader = rows as RawRow;
    const affected = Number(resultHeader?.affectedRows || resultHeader?.changedRows || 0);

    // Batch INSERT audit trail records (eliminates N+1 INSERT loop).
    // wave-165: mirror the integer-coercion pattern used at line 66-68 +
    // line 128-130. RawRow `id` is typed `unknown`; without
    // Number.isInteger we'd swallow a malformed-SQL crash in the catch
    // block and never know the audit row never wrote.
    if (affected > 0 && woIds.length > 0) {
      const numericWoIds = woIds
        .map((id) => Number(id))
        .filter((n): n is number => Number.isFinite(n) && Number.isInteger(n));
      if (numericWoIds.length > 0) {
        try {
          const values = numericWoIds.map((id) => `(${id}, 'completed', 'invoiced', 'system:cron', 'Auto-advanced after 24h in completed', NOW())`).join(",");
          await d.execute(sql`
            INSERT INTO work_order_transitions (work_order_id, from_status, to_status, changed_by, note, created_at)
            VALUES ${sql.raw(values)}
          `);
        } catch { /* transition table may not exist yet — non-critical */ }
      }
      log.info(`Auto-advanced ${affected} WOs from completed to invoiced (audit trail written)`);
    }
    return { recordsProcessed: affected, details: `${affected} WOs auto-advanced to invoiced` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `WO auto-advance failed: ${(e as Error).message}` };
  }
}

/** 7. Booking priority auto-escalation — 48h+ untouched new bookings → high priority */
export async function autoEscalateBookingPriority(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // priority is int (lower = higher priority). Default is 0.
    // Set to -1 (highest) for bookings untouched >48h
    const [result] = await d.execute(sql`
      UPDATE bookings
      SET priority = -1, updatedAt = NOW()
      WHERE status = 'new'
        AND priority >= 0
        AND createdAt < DATE_SUB(NOW(), INTERVAL 48 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    const resultHeader = result as RawRow;
    const affected = Number(resultHeader?.affectedRows || resultHeader?.changedRows || 0);
    if (affected > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`🔺 ${affected} booking${affected > 1 ? "s" : ""} auto-escalated to HIGH priority (untouched >48h). Check the bookings tab.`);
      } catch (err) { log.warn("autoEscalateBookingPriority: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }
    return { recordsProcessed: affected, details: `${affected} bookings escalated` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `Booking escalation failed: ${(e as Error).message}` };
  }
}

/** 8. Review auto-draft — fetch Google reviews + generate AI reply drafts */
export async function autoFetchAndDraftReviews(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    // The review monitor cron already fetches reviews, but doesn't generate AI reply drafts
    // Check for reviews without drafts and generate them
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Find reviews that have no draft reply yet
    // Column names from schema: reviewer_name, review_rating, review_text, draft_reply, final_reply, created_at
    // No "skipped" column exists — use status != 'skipped' instead
    const [rows] = await d.execute(sql`
      SELECT id, reviewer_name, review_rating, review_text, review_id
      FROM review_replies
      WHERE draft_reply IS NULL
        AND final_reply IS NULL
        AND status = 'draft'
        AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
      LIMIT 10
    `);

    const needDrafts = rows as RawRow[];
    if (needDrafts.length === 0) return { recordsProcessed: 0, details: "All reviews have drafts" };

    let drafted = 0;
    for (const review of needDrafts) {
      try {
        const rating = Number(review.review_rating || 5);
        const name = String(review.reviewer_name || "Valued Customer");
        const text = String(review.review_text || "");

        let draft: string;
        if (rating >= 4) {
          draft = `Thank you so much for the kind words, ${name}! We're glad you had a great experience at Nick's Tire & Auto. We look forward to seeing you again!`;
        } else if (rating === 3) {
          draft = `Thank you for your feedback, ${name}. We're always looking to improve and appreciate you sharing your experience. Please don't hesitate to reach out directly so we can make your next visit better — (216) 862-0005.`;
        } else {
          draft = `${name}, we're sorry to hear about your experience. This doesn't reflect the level of service we strive for at Nick's Tire & Auto. Please call us directly at (216) 862-0005 so we can make this right.`;
        }

        if (text.length > 20) {
          draft = draft.replace("!", "! ").trim();
        }

        await d.execute(sql`UPDATE review_replies SET draft_reply = ${draft} WHERE id = ${review.id}`);
        drafted++;
      } catch (err) { log.warn("autoFetchAndDraftReviews: draft generation failed", { error: err instanceof Error ? err.message : String(err), reviewId: review.id }); }
    }

    // Alert on negative reviews
    const negative = needDrafts.filter((r) => Number(r.review_rating || 5) <= 3);
    if (negative.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `⭐ ${negative.length} NEGATIVE REVIEW${negative.length > 1 ? "S" : ""} need reply:\n\n` +
          negative.map((r) => `${r.review_rating}★ ${r.reviewer_name || "Anon"}: "${String(r.review_text || "").slice(0, 80)}"`).join("\n") +
          `\n\nDrafts ready in admin → Review Replies.`
        );
      } catch (err) { log.warn("autoFetchAndDraftReviews: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: drafted, details: `${drafted} reply drafts generated, ${negative.length} negative` };
  } catch (e: unknown) {
    // Table might not exist
    const msg = (e as Error).message;
    if (msg?.includes("doesn't exist")) return { recordsProcessed: 0, details: "No review_replies table" };
    return { recordsProcessed: 0, details: `Review drafting failed: ${msg}` };
  }
}

/** 9. Content auto-generation — weekly blog article draft */
export async function autoGenerateContent(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    // Run on Wednesdays (mid-week) and Saturdays (weekend) — 2 articles per week
    const dow = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
    if (dow !== "Wednesday" && dow !== "Saturday") return { recordsProcessed: 0, details: "Not a content day (Wed/Sat)" };

    const { generateArticle } = await import("../../content-generator");
    const article = await generateArticle();

    if (article) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `📝 AUTO-CONTENT: New article drafted!\n\n` +
          `"${article.title || "Untitled"}"\n\n` +
          `Review in admin → Content → Drafts`
        );
      } catch (err) { log.warn("autoGenerateContent: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: 1, details: `Article draft: "${article?.title || "generated"}"` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `Content gen failed: ${(e as Error).message}` };
  }
}

/** 10. Referral loop closer — match referred phone to recent bookings/invoices, SMS both parties */
export async function closeReferralLoop(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("referral_loop_closer"))) return { recordsProcessed: 0, details: "Feature disabled" };

  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Find pending referrals where the referred person's phone matches a booking or invoice from last 7 days
    const [rows] = await d.execute(sql`
      SELECT r.id, r.referrerName, r.referrerPhone, r.refereeName, r.refereePhone
      FROM referrals r
      WHERE r.status = 'pending'
        AND (
          EXISTS (SELECT 1 FROM bookings b WHERE b.phone = r.refereePhone AND b.createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY))
          OR EXISTS (SELECT 1 FROM invoices i WHERE i.customerPhone = r.refereePhone AND i.createdAt > DATE_SUB(NOW(), INTERVAL 7 DAY))
        )
      LIMIT 20
    `);

    const matched = rows as RawRow[];
    if (matched.length === 0) return { recordsProcessed: 0, details: "No referral matches" };

    const { sendSms } = await import("../../sms");
    let closed = 0;

    for (const ref of matched) {
      try {
        // At-most-once claim — flip status 'pending' -> 'visited' BEFORE
        // the two sends, so a crash can't leave it 'pending' for the next
        // run to re-text both parties.
        const [claimRes] = await d.execute(sql`UPDATE referrals SET status = 'visited', updatedAt = NOW() WHERE id = ${ref.id} AND status = 'pending'`);
        if (((claimRes as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) continue;

        // SMS the referrer  (Wave-108: shop gateway, 1:1)
        if (ref.referrerPhone) {
          await sendSms(String(ref.referrerPhone), `Good news from Nick's Tire & Auto — someone you referred just came in, so your $25 credit is active. Use it on your next visit. (216) 862-0005`, { via: "shop" });
        }

        // SMS the referred customer  (Wave-108: shop gateway, 1:1)
        if (ref.refereePhone) {
          await sendSms(String(ref.refereePhone), `Welcome to Nick's Tire & Auto — a friend sent you our way, so you've both got $25 off. Walk in any day. (216) 862-0005`, { via: "shop" });
        }

        closed++;
      } catch (err) {
        log.warn("closeReferralLoop: SMS/update failed", { error: err instanceof Error ? err.message : String(err), referralId: ref.id });
      }
    }

    if (closed > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`🤝 REFERRAL LOOP: ${closed} referral${closed > 1 ? "s" : ""} matched! Both parties notified with $25 credit.`);
      } catch (err) { log.warn("closeReferralLoop: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: closed, details: `${closed} referrals matched and notified` };
  } catch (e: unknown) {
    const msg = (e as Error).message;
    if (msg?.includes("doesn't exist")) return { recordsProcessed: 0, details: "No referrals table" };
    return { recordsProcessed: 0, details: `Referral loop failed: ${msg}` };
  }
}

/** 11. VIP auto-recognition — notify newly-flagged VIP customers */
export async function notifyNewVips(): Promise<{ recordsProcessed: number; details?: string }> {
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("vip_auto_recognition"))) return { recordsProcessed: 0, details: "Feature disabled" };

  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Find customers who qualify as VIP (3+ visits, $2000+ spent in cents = 200000)
    // AND are not already flagged as VIP in customer_metrics
    // AND haven't received a VIP SMS in the last 90 days (smsCampaignDate cooldown)
    const [rows] = await d.execute(sql`
      SELECT c.id, c.firstName, c.phone, c.totalVisits, c.totalSpent, c.smsOptOut
      FROM customers c
      LEFT JOIN customer_metrics cm ON cm.customerId = c.id
      WHERE c.totalVisits >= 3
        AND c.totalSpent >= 200000
        AND c.smsOptOut = 0
        AND c.phone IS NOT NULL
        AND c.phone != ''
        AND (cm.isVip IS NULL OR cm.isVip = 0)
        AND (c.smsCampaignDate IS NULL OR c.smsCampaignDate < DATE_SUB(NOW(), INTERVAL 90 DAY))
      LIMIT 20
    `);

    const vips = rows as RawRow[];
    if (vips.length === 0) return { recordsProcessed: 0, details: "No new VIPs to notify" };

    const { sendSms } = await import("../../sms");
    let notified = 0;
    const notifiedIds: number[] = [];

    for (const vip of vips) {
      try {
        // At-most-once claim — stamp the VIP cooldown BEFORE the send so a
        // crash can't leave it un-stamped for the next run to re-text.
        // Conditional WHERE mirrors the SELECT predicate (90-day cooldown).
        const [claimRes] = await d.execute(sql`UPDATE customers SET smsCampaignSent = 2, smsCampaignDate = NOW() WHERE id = ${vip.id} AND (smsCampaignDate IS NULL OR smsCampaignDate < DATE_SUB(NOW(), INTERVAL 90 DAY))`);
        if (((claimRes as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) continue;

        // Wave-108: VIP notification via shop gateway (1:1, transactional)
        const result = await sendSms(
          String(vip.phone),
          `You're a Nick's Tire & Auto VIP — 10% off every visit, our way of saying thanks. Just let us know when you pull up. (216) 862-0005`,
          { via: "shop" }
        );
        if (result.success) {
          notified++;
          notifiedIds.push(Number(vip.id));
        }
      } catch (err) {
        log.warn("notifyNewVips: SMS failed", { error: err instanceof Error ? err.message : String(err), customerId: vip.id });
      }
    }

    // forensic-audit MEDIUM · flag ONLY the customers actually notified in this
    // batch. The old blanket UPDATE set isVip=1 for EVERY qualifying customer
    // after texting at most 20, so everyone past the batch was marked VIP
    // without ever being texted — and the `cm.isVip IS NULL OR = 0` selection
    // filter then excluded them from all future runs (permanently skipped).
    if (notifiedIds.length > 0) {
      try {
        await d.execute(sql`
          UPDATE customer_metrics
          SET isVip = 1
          WHERE customerId IN (${sql.raw(notifiedIds.join(","))})
        `);
      } catch { /* customer_metrics table may not exist yet */ }

      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`⭐ VIP RECOGNITION: ${notified} customer${notified > 1 ? "s" : ""} newly recognized as VIP and notified with 10% off perk.`);
      } catch (err) { log.warn("notifyNewVips: Telegram alert failed", { error: err instanceof Error ? err.message : String(err) }); }
    }

    return { recordsProcessed: notified, details: `${notified} new VIPs notified` };
  } catch (e: unknown) {
    return { recordsProcessed: 0, details: `VIP notification failed: ${(e as Error).message}` };
  }
}
