/**
 * Page the counter when a real customer text sits unanswered (audit 2026-11-07: 29 of 41
 * inbound texts unanswered in 24 h, average first reply 66 h).
 *
 * A non-spam inbound with no outbound reply for 15 minutes, while the shop is open
 * (BUSINESS.hours.structured in America/New_York, computed explicitly), sends ONE internal
 * text to the on-duty manager through textOnDutyManager, the COMING IN sender.
 *
 * Once per wait: the claim is an INSERT IGNORE on cron_alerts_fired keyed on the
 * conversation and its oldest open job (claim-before-act: of N ticks or replicas exactly one
 * inserts). A failed send gives the claim back. Staff-only: this never texts a customer.
 * Runs on the 45 s response-job sweep (startResponseJobProcessor), not a new scheduler entry.
 */
import { sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { businessState } from "@shared/shopState";
import { createLogger } from "../lib/logger";
import { claimAlertOnce, EVER_FIRED_FOR, releaseAlertClaim } from "./alertClaim";
import { isSpamInbound } from "./smsIntentRouter";
import { waitingConversations, type HumanPendingRow } from "./smsResponseJobs";

const log = createLogger("sms-wait-page");

const PAGE_AFTER_MINUTES = 15;
/** An older wait is a backlog, not a page: bounds the burst on the first deploy. */
const LOOKBACK_HOURS = 24;
const MAX_LISTED = 3;

/** Plain ASCII for an SMS: smart quotes and dashes folded, anything else non-printable dropped. */
function ascii(s: string, max: number): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function phoneLabel(phone: string): string {
  const d = phone.replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "no number";
}

function composePage(waits: Array<{ phone: string; customerName: string | null; preview: string; waitingMinutes: number }>): string {
  const lines = [waits.length === 1 ? `TEXT WAITING ${waits[0].waitingMinutes}m, no reply yet` : `${waits.length} TEXTS WAITING, no reply yet`];
  for (const w of waits.slice(0, MAX_LISTED)) {
    lines.push(`${ascii(w.customerName ?? "", 40) || "No name"} - ${phoneLabel(w.phone)}${waits.length > 1 ? ` (${w.waitingMinutes}m)` : ""}`);
    lines.push(`"${ascii(w.preview, 80)}"`);
  }
  if (waits.length > MAX_LISTED) lines.push(`+${waits.length - MAX_LISTED} more`);
  lines.push("Reply: nickstire.org/admin");
  return lines.join("\n");
}

export async function pageWaitingTexts(now: Date = new Date()): Promise<{ paged: number; skipped?: string }> {
  if (businessState(now, BUSINESS.timezone, BUSINESS.hours.structured as Record<string, string>).state !== "open") {
    return { paged: 0, skipped: "shop closed" };
  }
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) return { paged: 0, skipped: "database unavailable" };

  // Open = nobody answered: waiting on a human, still queued, or the AI's send failed.
  // Any outbound in the thread after the text counts as a reply (a send from the admin or the shop line).
  // Ages from the DB's own NOW(), as readHumanPendingRows does.
  const [rows] = await db.execute(sql`
    SELECT SUBSTRING_INDEX(GROUP_CONCAT(j.id ORDER BY j.createdAt ASC, j.id ASC), ',', 1) AS firstJobId,
           j.conversationId,
           MAX(j.customerPhone) AS phone,
           MAX(c.customerName) AS customerName,
           SUBSTRING_INDEX(GROUP_CONCAT(j.body ORDER BY j.createdAt DESC, j.id DESC SEPARATOR '~|~'), '~|~', 1) AS body,
           GROUP_CONCAT(j.body ORDER BY j.createdAt ASC, j.id ASC SEPARATOR '~|~') AS allBodies,
           COUNT(*) AS texts,
           TIMESTAMPDIFF(MINUTE, MIN(j.createdAt), NOW()) AS waitingMinutes
    FROM sms_response_jobs j
    LEFT JOIN sms_conversations c ON c.id = j.conversationId
    WHERE j.status IN ('human_pending', 'pending', 'processing', 'failed', 'dead')
      AND j.createdAt >= NOW() - INTERVAL ${LOOKBACK_HOURS} HOUR
      AND NOT EXISTS (
        SELECT 1 FROM sms_messages m
        WHERE m.conversationId = j.conversationId AND m.direction = 'outbound' AND m.createdAt >= j.createdAt
      )
    GROUP BY j.conversationId
  `);

  const firstJob = new Map<number, string>();
  const candidates: HumanPendingRow[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    const waitingMinutes = Number(r.waitingMinutes ?? 0);
    const bodies = r.allBodies == null ? [String(r.body ?? "")] : String(r.allBodies).split("~|~");
    if (waitingMinutes < PAGE_AFTER_MINUTES || bodies.every(isSpamInbound)) continue;
    const conversationId = Number(r.conversationId);
    firstJob.set(conversationId, String(r.firstJobId));
    candidates.push({
      jobId: Number(r.firstJobId),
      conversationId,
      phone: String(r.phone ?? ""),
      customerName: r.customerName == null ? null : String(r.customerName),
      body: String(r.body ?? ""),
      bodies,
      waitingMinutes,
      overdue: false,
      texts: r.texts == null ? 1 : Number(r.texts),
    });
  }
  // Same reduction as Today's queue: no internal lines, no lender-only threads.
  const waiting = waitingConversations(candidates);

  const claimed: Array<{ key: string; wait: (typeof waiting)[number] }> = [];
  for (const w of waiting) {
    const key = `sms-wait-page:${w.conversationId}:${firstJob.get(w.conversationId)}`;
    if (await claimAlertOnce(key, now, EVER_FIRED_FOR)) claimed.push({ key, wait: w });
  }
  if (claimed.length === 0) return { paged: 0 };

  const { textOnDutyManager } = await import("./eventBus");
  let status = "failed";
  try {
    status = (await textOnDutyManager(composePage(claimed.map((c) => c.wait)))).status;
  } finally {
    // Only a definite failure is handed back: queued/uncertain may still arrive, and a
    // skip (no on-duty number) would otherwise retry every 45 s.
    if (status === "failed") for (const c of claimed) await releaseAlertClaim(c.key, now, EVER_FIRED_FOR);
  }
  if (status === "failed") {
    log.warn("counter page not sent; will retry next tick", { waiting: claimed.length, errorId: "SMS_WAIT_PAGE_FAILED" });
    return { paged: 0, skipped: "send failed" };
  }
  log.info("counter paged about waiting texts", { paged: claimed.length, status });
  return { paged: claimed.length };
}
