/**
 * Push an alert when a customer's reply obligation blows its SLA.
 *
 * WHY THIS EXISTS
 * #1074 made a drafted / needs-review reply a DURABLE obligation with a 30-minute
 * SLA anchored on `dueAt`. But `dueAt` had exactly one consumer — an admin tRPC
 * query — so the SLA was computed, stored, and never acted on. The operator works
 * from an iPhone PWA and does not sit on an admin tab, which means the obligation
 * could be perfectly durable and still never reach a human.
 *
 * The measured consequence: a 180-day read of production found 74% of customer
 * turns unanswered within 2 hours. A queue nobody is told about is not an answer.
 *
 * WHAT THIS IS NOT
 * This never contacts a customer. It messages the OPERATOR about silence that has
 * already happened. Nothing here can send, activate, or schedule customer SMS —
 * deliberately, because the alert exists to surface a missed reply, and a tool that
 * could also "just answer it" would be the one place that bypasses every send gate.
 */
import { createLogger } from "../lib/logger";
import { BoundedTtlMap } from "../lib/boundedTtlMap";
import { listOverdueHumanPending, type WaitingCustomer } from "./smsResponseJobs";

const log = createLogger("human-pending-alerts");

/**
 * Don't re-alert the same obligation more often than this. A customer who is still
 * waiting an hour later genuinely warrants a second nudge; one every 15 minutes
 * trains the operator to ignore the channel, which costs more than it buys.
 */
const RE_ALERT_MS = 60 * 60_000;

/** How many waiting customers to name before collapsing the rest into a count. */
const MAX_LISTED = 5;

/**
 * Alert bookkeeping is in-memory ON PURPOSE — it needs no migration, and losing it
 * on restart is the safe direction: a still-overdue customer gets re-surfaced after
 * a deploy, which is correct (they are still waiting), rather than suppressed
 * forever by a stale flag. TTL is 2x the re-alert window so entries cannot pile up.
 */
const lastAlertedAt = new BoundedTtlMap<number>({ ttlMs: 2 * RE_ALERT_MS, maxEntries: 500 });

export interface OverdueAlertResult {
  /** Total obligations currently past SLA. */
  overdue: number;
  /** How many were included in this alert (0 = all were recently alerted). */
  alerted: number;
  /** False when Telegram was unconfigured or the send failed. */
  delivered: boolean;
  skippedReason?: string;
}

/** Last 4 digits only — the deep link, not the phone number, is how the operator acts. */
function tail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `...${digits.slice(-4)}` : "...????";
}

/** Keep the digest scannable on a phone screen. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}...` : flat;
}

/**
 * Compose the operator message. Pure, so the wording is testable without a network
 * call — the shape of this text is the actual product here.
 */
export function composeOverdueAlert(waiting: WaitingCustomer[], totalOverdue: number): string {
  const noun = totalOverdue === 1 ? "CUSTOMER IS" : "CUSTOMERS ARE";
  const lines: string[] = [`⏰ ${totalOverdue} ${noun} WAITING FOR A REPLY`, ""];
  for (const w of waiting.slice(0, MAX_LISTED)) {
    lines.push(`• ${tail(w.phone)} · waiting ${w.waitingMinutes}m (${w.overdueMinutes}m past SLA)`);
    lines.push(`  "${preview(w.body)}"`);
  }
  const hidden = totalOverdue - Math.min(waiting.length, MAX_LISTED);
  if (hidden > 0) lines.push(`...and ${hidden} more`);
  lines.push("", "Reply from: https://nickstire.org/admin");
  return lines.join("\n");
}

/**
 * Find obligations past SLA and alert the operator about the ones not recently
 * alerted. Idempotent per-obligation within RE_ALERT_MS.
 *
 * Throws nothing on "nothing to do", but DOES propagate a database failure — the
 * cron layer reports that as a failed job, whereas swallowing it would make an
 * unreadable queue look like an empty one (the exact ROS-059 failure shape).
 */
export async function alertOverdueObligations(): Promise<OverdueAlertResult> {
  const overdueRows = await listOverdueHumanPending(25);
  if (overdueRows.length === 0) {
    return { overdue: 0, alerted: 0, delivered: false, skippedReason: "none overdue" };
  }

  const now = Date.now();
  const fresh = overdueRows.filter((w) => {
    const last = lastAlertedAt.get(String(w.jobId));
    return last === undefined || now - last >= RE_ALERT_MS;
  });

  if (fresh.length === 0) {
    return {
      overdue: overdueRows.length,
      alerted: 0,
      delivered: false,
      skippedReason: "all recently alerted",
    };
  }

  const text = composeOverdueAlert(fresh, overdueRows.length);
  const { sendTelegram } = await import("./telegram");
  const delivered = await sendTelegram(text);

  if (delivered) {
    // Only mark on confirmed delivery. Marking optimistically would let a Telegram
    // outage silence the alert for an hour with nobody having seen it.
    for (const w of fresh) lastAlertedAt.set(String(w.jobId), now);
    log.info("Alerted operator to overdue reply obligations", {
      overdue: overdueRows.length,
      alerted: fresh.length,
    });
  } else {
    log.error("Could NOT deliver the overdue-reply alert — customers are waiting and nobody was told", {
      overdue: overdueRows.length,
      errorId: "OVERDUE_ALERT_UNDELIVERED",
    });
  }

  return { overdue: overdueRows.length, alerted: fresh.length, delivered };
}

/** Test seam — resets the re-alert throttle. */
export function __resetAlertThrottle(): void {
  lastAlertedAt.clear();
}
