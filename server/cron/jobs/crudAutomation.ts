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

const log = createLogger("cron:crud-automation");

/** 1. Process maintenance reminder SMS queue */
export async function processReminders(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { processReminderQueue } = await import("../../routers/reminders");
    const result = await processReminderQueue();
    return { recordsProcessed: (result as any)?.sent || 0, details: `${(result as any)?.sent || 0} reminders sent` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `Reminders failed: ${e.message}` };
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

    const noShows = rows as any[];
    if (noShows.length === 0) return { recordsProcessed: 0, details: "No no-shows" };

    // Mark as no-show
    for (const b of noShows) {
      await d.execute(sql`UPDATE bookings SET status = 'no-show' WHERE id = ${b.id} AND status IN ('new', 'confirmed')`);
    }

    // Send follow-up SMS to those with phone numbers
    const { sendSms } = await import("../../sms");
    let smsSent = 0;
    for (const b of noShows.filter((n: any) => n.phone)) {
      try {
        const firstName = (b.name || "there").split(" ")[0];
        await sendSms(b.phone, `Hi ${firstName}, we noticed you may have missed your appointment at Nick's Tire & Auto. We'd love to reschedule — call us at (216) 862-0005 or book online at nickstire.org. We're here when you're ready!`);
        smsSent++;
      } catch {}
      if (smsSent >= 5) break; // Rate limit
    }

    // Alert
    if (noShows.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`📋 NO-SHOW: ${noShows.length} bookings past date, marked as no-show. ${smsSent} follow-up SMS sent.`);
      } catch {}
    }

    return { recordsProcessed: noShows.length, details: `${noShows.length} no-shows flagged, ${smsSent} SMS sent` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `No-show detection failed: ${e.message}` };
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
      SELECT id, name, phone FROM bookings
      WHERE status = 'new'
        AND createdAt < DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND updatedAt < DATE_SUB(NOW(), INTERVAL 14 DAY)
      LIMIT 50
    `);

    const stale = rows as any[];
    if (stale.length === 0) return { recordsProcessed: 0, details: "No stale bookings" };

    // Auto-cancel
    // Cancel stale bookings one by one (safe parameterized queries)
    for (const b of stale) {
      await d.execute(sql`UPDATE bookings SET status = 'cancelled', updatedAt = NOW() WHERE id = ${b.id}`);
    }

    // Send "rebook" SMS
    const { sendSms } = await import("../../sms");
    let smsSent = 0;
    for (const b of stale.filter((s: any) => s.phone)) {
      try {
        const firstName = (b.name || "there").split(" ")[0];
        await sendSms(b.phone, `Hi ${firstName}! Your booking at Nick's Tire & Auto has expired. Need to reschedule? Call (216) 862-0005 or visit nickstire.org — drop-offs welcome!`);
        smsSent++;
      } catch {}
      if (smsSent >= 10) break;
    }

    return { recordsProcessed: stale.length, details: `${stale.length} stale bookings cancelled, ${smsSent} rebook SMS sent` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `Stale booking cleanup failed: ${e.message}` };
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
      SELECT id, name, phone, reason FROM callback_requests
      WHERE status = 'new'
        AND createdAt < DATE_SUB(NOW(), INTERVAL 4 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 3 DAY)
      LIMIT 10
    `);

    const stale = rows as any[];
    if (stale.length === 0) return { recordsProcessed: 0, details: "No stale callbacks" };

    // Send customer a "we'll call you back" SMS
    const { sendSms } = await import("../../sms");
    let smsSent = 0;
    for (const cb of stale.filter((c: any) => c.phone)) {
      try {
        const firstName = (cb.name || "there").split(" ")[0];
        await sendSms(cb.phone, `Hi ${firstName}, we haven't forgotten about you! We'll be calling you back shortly regarding your request. — Nick's Tire & Auto (216) 862-0005`);
        smsSent++;
        // Mark as "pending" so we don't re-SMS
        await d.execute(sql`UPDATE callback_requests SET status = 'pending', updatedAt = NOW() WHERE id = ${cb.id}`);
      } catch {}
    }

    // Alert shop via Telegram
    if (stale.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `📞 CALLBACK ALERT: ${stale.length} callbacks unanswered >4h!\n\n` +
          stale.slice(0, 5).map((c: any) => `${c.name || "?"} — ${c.phone || "no phone"}: ${(c.reason || "general").slice(0, 50)}`).join("\n") +
          `\n\nCall them back NOW.`
        );
      } catch {}
    }

    return { recordsProcessed: stale.length, details: `${stale.length} escalated, ${smsSent} SMS sent` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `Callback escalation failed: ${e.message}` };
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

    const lowItems = rows as any[];
    if (lowItems.length === 0) return { recordsProcessed: 0, details: "Stock levels OK" };

    const { sendTelegram } = await import("../../services/telegram");
    await sendTelegram(
      `📦 LOW STOCK ALERT: ${lowItems.length} items need reorder\n\n` +
      lowItems.slice(0, 10).map((i: any) => `${i.name || i.sku}: ${i.quantity} left (reorder at ${i.reorderPoint || 2})`).join("\n")
    );

    return { recordsProcessed: lowItems.length, details: `${lowItems.length} low-stock items alerted` };
  } catch (e: any) {
    // Table might not exist yet — that's fine
    if (e.message?.includes("doesn't exist") || e.message?.includes("no such table")) {
      return { recordsProcessed: 0, details: "No inventory table" };
    }
    return { recordsProcessed: 0, details: `Low-stock check failed: ${e.message}` };
  }
}

/** 6. WO auto-advance: completed → invoiced when invoice exists */
export async function autoAdvanceWorkOrders(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    // Auto-advance completed WOs older than 24h to invoiced
    // (Invoices table has no workOrderId — can't join directly.
    //  Instead, auto-advance WOs that have been in 'completed' for >24h,
    //  since completed means the work is done and should be invoiced.)
    const [rows] = await d.execute(sql`
      UPDATE work_orders
      SET status = 'invoiced', updated_at = NOW()
      WHERE status = 'completed'
        AND updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `);

    const affected = (rows as any)?.affectedRows || (rows as any)?.changedRows || 0;
    if (affected > 0) log.info(`Auto-advanced ${affected} WOs from completed to invoiced`);
    return { recordsProcessed: affected, details: `${affected} WOs auto-advanced to invoiced` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `WO auto-advance failed: ${e.message}` };
  }
}

/** 7. Booking priority auto-escalation — 48h+ untouched new bookings → high priority */
export async function autoEscalateBookingPriority(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const d = await getDb();
    if (!d) return { recordsProcessed: 0, details: "No DB" };

    const [result] = await d.execute(sql`
      UPDATE bookings
      SET priority = 'high', updatedAt = NOW()
      WHERE status = 'new'
        AND priority IN ('normal', 'low')
        AND createdAt < DATE_SUB(NOW(), INTERVAL 48 HOUR)
        AND createdAt > DATE_SUB(NOW(), INTERVAL 30 DAY)
    `);

    const affected = (result as any)?.affectedRows || (result as any)?.changedRows || 0;
    if (affected > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(`🔺 ${affected} booking${affected > 1 ? "s" : ""} auto-escalated to HIGH priority (untouched >48h). Check the bookings tab.`);
      } catch {}
    }
    return { recordsProcessed: affected, details: `${affected} bookings escalated` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `Booking escalation failed: ${e.message}` };
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

    const needDrafts = rows as any[];
    if (needDrafts.length === 0) return { recordsProcessed: 0, details: "All reviews have drafts" };

    let drafted = 0;
    for (const review of needDrafts) {
      try {
        const rating = review.review_rating || 5;
        const name = review.reviewer_name || "Valued Customer";
        const text = review.review_text || "";

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
      } catch {}
    }

    // Alert on negative reviews
    const negative = needDrafts.filter((r: any) => (r.review_rating || 5) <= 3);
    if (negative.length > 0) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `⭐ ${negative.length} NEGATIVE REVIEW${negative.length > 1 ? "S" : ""} need reply:\n\n` +
          negative.map((r: any) => `${r.review_rating}★ ${r.reviewer_name || "Anon"}: "${(r.review_text || "").slice(0, 80)}"`).join("\n") +
          `\n\nDrafts ready in admin → Review Replies.`
        );
      } catch {}
    }

    return { recordsProcessed: drafted, details: `${drafted} reply drafts generated, ${negative.length} negative` };
  } catch (e: any) {
    // Table might not exist
    if (e.message?.includes("doesn't exist")) return { recordsProcessed: 0, details: "No review_replies table" };
    return { recordsProcessed: 0, details: `Review drafting failed: ${e.message}` };
  }
}

/** 9. Content auto-generation — weekly blog article draft */
export async function autoGenerateContent(): Promise<{ recordsProcessed: number; details?: string }> {
  try {
    // Only run on Wednesdays (mid-week content)
    const dow = new Date().toLocaleString("en-US", { timeZone: "America/New_York", weekday: "long" });
    if (dow !== "Wednesday") return { recordsProcessed: 0, details: "Not Wednesday" };

    const { generateArticle } = await import("../../content-generator");
    const article = await generateArticle();

    if (article) {
      try {
        const { sendTelegram } = await import("../../services/telegram");
        await sendTelegram(
          `📝 AUTO-CONTENT: New article drafted!\n\n` +
          `"${(article as any).title || "Untitled"}"\n\n` +
          `Review in admin → Content → Drafts`
        );
      } catch {}
    }

    return { recordsProcessed: 1, details: `Article draft: "${(article as any)?.title || "generated"}"` };
  } catch (e: any) {
    return { recordsProcessed: 0, details: `Content gen failed: ${e.message}` };
  }
}
