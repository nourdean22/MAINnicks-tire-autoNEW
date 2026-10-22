/**
 * Maintenance reminders from closed jobs (upgrade scout 2026-10-22, design approved by the manager).
 *
 * A closed job is a ShopDriver counter invoice (`invoices.source = 'shopdriver'`). App-made online
 * tire orders start as `manual` invoices with paymentStatus "pending" and are NOT closed jobs; a
 * counter invoice's paymentStatus means nothing (payment is taken on a separate register).
 *
 * Planning: each customer's LATEST closed job decides their reminders. Any later closed job, whatever
 * it was for, closes the earlier ones: they came back, so the shop had its chance.
 *
 * Two gates before a text goes out: the `service_reminders_from_invoices` flag (default OFF; OFF is a
 * shadow run that counts and writes nothing), and each category's text carrying Nour's approval by
 * name in SERVICE_REMINDER_PLAN below.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { invoices, serviceReminders } from "../../drizzle/schema";
import { categorizeService } from "./engines/shared";
import { createLogger } from "../lib/logger";

const log = createLogger("service-reminders");

interface ReminderPlanEntry {
  months: number;
  /** null until Nour approves this exact text by name; an unapproved category never sends. */
  approvedBy: string | null;
  text: (shopPhone: string) => string;
}

/** Intervals and texts in one place. Nour can change any of them before arming. Keys are categorizeService keys. */
export const SERVICE_REMINDER_PLAN = {
  tires: {
    months: 6,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about 6 months since your tire work with us. A rotation now helps all four wear evenly, so none of them gets to be the favorite. Walk in any day, first come, first served. ${p}`,
  },
  brakes: {
    months: 12,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about a year since your brake work with us, a good time to check the pads and rotors. Brakes are the one part of a car that should stay boring. Walk in any day, first come, first served. ${p}`,
  },
  oil: {
    months: 4,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about 4 months since your oil change with us, so the next one may be coming due. Fresh oil costs less than a new engine and causes less drama. Walk in any day, no appointment needed. ${p}`,
  },
  cooling: {
    months: 12,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about a year since we worked on your cooling system. A quick look at the coolant and hoses catches a leak early. Steam is great for coffee, not so much for engines. Walk in any day, first come, first served. ${p}`,
  },
  electrical: {
    months: 12,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about a year since your battery or electrical work with us. A battery and charging test takes a few minutes, and batteries rarely give notice before they retire. Walk in any day, first come, first served. ${p}`,
  },
  suspension: {
    months: 12,
    approvedBy: null,
    text: (p: string) =>
      `Nick's Tire & Auto here. It's been about a year since your suspension work with us. It's worth having the steering and alignment checked, so the car goes where you point it. Walk in any day, first come, first served. ${p}`,
  },
} satisfies Record<string, ReminderPlanEntry>;

export type ReminderCategory = keyof typeof SERVICE_REMINDER_PLAN;

function isReminderCategory(key: string): key is ReminderCategory {
  return Object.prototype.hasOwnProperty.call(SERVICE_REMINDER_PLAN, key);
}

/** The text to send for a category, or null when the category is unknown or not approved by name. */
export function approvedReminderText(serviceType: string): string | null {
  if (!isReminderCategory(serviceType)) return null;
  const entry: ReminderPlanEntry = SERVICE_REMINDER_PLAN[serviceType];
  return entry.approvedBy ? entry.text(BUSINESS.phone.display) : null;
}

export function approvedCategories(): ReminderCategory[] {
  return (Object.keys(SERVICE_REMINDER_PLAN) as ReminderCategory[]).filter((k) => approvedReminderText(k) !== null);
}

export interface ClosedJob {
  customerPhone: string | null;
  customerName: string | null;
  serviceDescription: string | null;
  vehicleInfo: string | null;
  invoiceDate: Date;
}

export interface PlannedReminder {
  phone: string;
  serviceType: ReminderCategory;
  customerName: string;
  vehicleInfo: string | null;
  lastServiceDate: Date;
  nextDueDate: Date;
}

export function phone10(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "").slice(-10);
  return digits.length === 10 ? digits : null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/**
 * A reminder more than this far past due is never sent: its "about 6 months" text would be false,
 * and the generic retention texts already cover that customer.
 */
const LATE_GRACE_MS = 30 * 86_400_000;

/** Shop-wide cap on reminder texts per shop day, like declined recovery's carrier-safe batches. */
const DAILY_SEND_CAP = 40;

/** Pure: one reminder per customer x category, from that customer's latest closed-job day only. */
export function planServiceReminders(jobs: readonly ClosedJob[], now: Date = new Date()): PlannedReminder[] {
  const latestDay = new Map<string, string>();
  for (const j of jobs) {
    const p = phone10(j.customerPhone);
    if (!p) continue;
    const k = dayKey(j.invoiceDate);
    if (!latestDay.has(p) || k > latestDay.get(p)!) latestDay.set(p, k);
  }

  const out = new Map<string, PlannedReminder>();
  for (const j of jobs) {
    const p = phone10(j.customerPhone);
    if (!p || dayKey(j.invoiceDate) !== latestDay.get(p) || !j.serviceDescription) continue;
    for (const cat of categorizeService(j.serviceDescription)) {
      if (!isReminderCategory(cat) || out.has(`${p}|${cat}`)) continue;
      const nextDueDate = addMonths(j.invoiceDate, SERVICE_REMINDER_PLAN[cat].months);
      if (nextDueDate.getTime() < now.getTime() - LATE_GRACE_MS) continue;
      out.set(`${p}|${cat}`, {
        phone: p,
        serviceType: cat,
        customerName: (j.customerName ?? "").trim() || "Customer",
        vehicleInfo: j.vehicleInfo,
        lastServiceDate: j.invoiceDate,
        nextDueDate,
      });
    }
  }
  return [...out.values()];
}

/** Counts by category, for the shadow receipt. */
export function countByType(planned: readonly PlannedReminder[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of planned) out[r.serviceType] = (out[r.serviceType] ?? 0) + 1;
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const PLAN_WINDOW_MONTHS = 13;

/** Reads the last 13 months of closed jobs. Throws on a failed read: an unread table is not "nothing due". */
async function readClosedJobs(db: Db): Promise<ClosedJob[]> {
  return db
    .select({
      customerPhone: invoices.customerPhone,
      customerName: invoices.customerName,
      serviceDescription: invoices.serviceDescription,
      vehicleInfo: invoices.vehicleInfo,
      invoiceDate: invoices.invoiceDate,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.source, "shopdriver"),
        sql`${invoices.invoiceDate} >= NOW() - INTERVAL ${PLAN_WINDOW_MONTHS} MONTH`,
        sql`${invoices.customerPhone} IS NOT NULL AND ${invoices.customerPhone} <> ''`,
      ),
    );
}

export interface SyncResult {
  mode: "shadow" | "armed";
  planned: number;
  byType: Record<string, number>;
  inserted: number;
  closed: number;
}

/**
 * Plan from closed jobs. Shadow (not armed): count only, write nothing. Armed: close every scheduled
 * reminder whose customer has a later closed job, then insert planned reminders not already stored.
 * One writer: runs inside the locked `reminder-queue` cron job.
 */
export async function syncServiceReminders(db: Db, armed: boolean): Promise<SyncResult> {
  const jobs = await readClosedJobs(db);
  const planned = planServiceReminders(jobs);
  const result: SyncResult = { mode: armed ? "armed" : "shadow", planned: planned.length, byType: countByType(planned), inserted: 0, closed: 0 };
  if (!armed) return result;

  const latestDay = new Map<string, string>();
  for (const j of jobs) {
    const p = phone10(j.customerPhone);
    if (p && (!latestDay.has(p) || dayKey(j.invoiceDate) > latestDay.get(p)!)) latestDay.set(p, dayKey(j.invoiceDate));
  }

  const stored: Array<{ id: number; phone: string; serviceType: string; lastServiceDate: Date; status: string }> = await db
    .select({
      id: serviceReminders.id,
      phone: serviceReminders.phone,
      serviceType: serviceReminders.serviceType,
      lastServiceDate: serviceReminders.lastServiceDate,
      status: serviceReminders.status,
    })
    .from(serviceReminders);

  for (const r of stored) {
    const later = latestDay.get(r.phone);
    if (r.status !== "scheduled" || !later || later <= dayKey(r.lastServiceDate)) continue;
    const res = await db
      .update(serviceReminders)
      .set({ status: "completed" })
      .where(and(eq(serviceReminders.id, r.id), eq(serviceReminders.status, "scheduled")));
    if (((res as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 1) result.closed++;
  }

  const have = new Set(stored.map((r) => `${r.phone}|${r.serviceType}|${dayKey(r.lastServiceDate)}`));
  const fresh = planned.filter((r) => !have.has(`${r.phone}|${r.serviceType}|${dayKey(r.lastServiceDate)}`));
  if (fresh.length > 0) {
    await db.insert(serviceReminders).values(
      fresh.map((r) => ({
        phone: r.phone,
        customerName: r.customerName,
        vehicleInfo: r.vehicleInfo,
        serviceType: r.serviceType,
        lastServiceDate: r.lastServiceDate,
        nextDueDate: r.nextDueDate,
        status: "scheduled" as const,
      })),
    );
    result.inserted = fresh.length;
  }
  return result;
}

/**
 * Phones not to remind this run: a retention or drip text in the last 7 days, or an inferred
 * decline (estimate with no matched invoice) in the last 30 days, which declined recovery is already
 * texting about. Throws on a failed read so the caller sends nothing rather than guessing.
 */
export async function phonesToDefer(db: Db, phones: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (phones.length === 0) return out;
  const list = sql.join(phones.map((p) => sql`${p}`), sql`, `);
  const [texted] = await db.execute(sql`
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) AS p
    FROM sms_messages m JOIN sms_conversations c ON c.id = m.conversationId
    WHERE m.direction = 'outbound'
      AND m.createdAt >= NOW() - INTERVAL 7 DAY
      AND (m.variantKey LIKE 'retention\\_%' OR m.variantKey = 'drip')
      AND RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', ''), 10) IN (${list})
  `);
  const [declined] = await db.execute(sql`
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) AS p
    FROM alg_estimates
    WHERE matched_invoice_id IS NULL
      AND estimate_date >= NOW() - INTERVAL 30 DAY
      AND RIGHT(REGEXP_REPLACE(customer_phone, '[^0-9]', ''), 10) IN (${list})
  `);
  for (const row of [...(texted as Array<{ p: string }>), ...(declined as Array<{ p: string }>)]) out.add(row.p);
  return out;
}

/**
 * For retention D90/D180: phones that got a service reminder in the last 14 days, or have an
 * approved-category reminder due in the next 14 days. The reminder replaces the generic text that
 * fortnight. Empty unless the lane is armed, so an unarmed lane never silences retention.
 */
export async function phonesWithReminderThisFortnight(db: Db, armed: boolean, phones: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (!armed || phones.length === 0) return out;
  const approved = approvedCategories();
  const rows: Array<{ phone: string }> = await db
    .select({ phone: serviceReminders.phone })
    .from(serviceReminders)
    .where(
      and(
        inArray(serviceReminders.phone, [...phones]),
        approved.length > 0
          ? sql`((${serviceReminders.status} = 'sent' AND ${serviceReminders.sentAt} >= NOW() - INTERVAL 14 DAY) OR (${serviceReminders.status} = 'scheduled' AND ${serviceReminders.nextDueDate} <= NOW() + INTERVAL 14 DAY AND ${inArray(serviceReminders.serviceType, approved)}))`
          : sql`(${serviceReminders.status} = 'sent' AND ${serviceReminders.sentAt} >= NOW() - INTERVAL 14 DAY)`,
      ),
    );
  for (const r of rows) out.add(r.phone);
  return out;
}

export interface SendResult {
  due: number;
  sent: number;
  queued: number;
  uncertain: number;
  heldOut: number;
  failed: number;
  awaitingApproval: number;
  deferred: number;
  tooLate: number;
  capped: number;
}

/**
 * Sends due reminders (armed lane only; the caller checks the flag). Each row is CLAIMED before the
 * send by a compare-and-swap on its status, so the cron and the admin button can never both send it.
 */
export async function sendDueServiceReminders(db: Db): Promise<SendResult> {
  const { sendSms } = await import("../sms");
  const { logOutboundSms } = await import("./smsInstrumentation");
  const { smsOutcome } = await import("../lib/smsOutcome");
  const { getDueReminders } = await import("../db");

  const { minutesSinceShopMidnight } = await import("../lib/timezoneAssert");

  const due: Array<{ id: number; phone: string; serviceType: string; nextDueDate?: Date }> = await getDueReminders();

  const r: SendResult = { due: due.length, sent: 0, queued: 0, uncertain: 0, heldOut: 0, failed: 0, awaitingApproval: 0, deferred: 0, tooLate: 0, capped: 0 };
  const sendable = due.filter((d) => {
    if (approvedReminderText(d.serviceType)) return true;
    r.awaitingApproval++;
    return false;
  });
  const defer = await phonesToDefer(db, [...new Set(sendable.map((d) => d.phone))]);
  const [usedRows] = await db.execute(sql`
    SELECT COUNT(*) AS n FROM service_reminders
    WHERE status = 'sent' AND sentAt >= NOW() - INTERVAL ${minutesSinceShopMidnight(new Date())} MINUTE
  `);
  let room = DAILY_SEND_CAP - Number((usedRows as Array<{ n?: unknown }>)[0]?.n ?? 0);

  for (const d of sendable) {
    if (d.nextDueDate && d.nextDueDate.getTime() < Date.now() - LATE_GRACE_MS) {
      r.tooLate++;
      await db
        .update(serviceReminders)
        .set({ status: "cancelled", errorMessage: "more than 30 days past due; not sent" })
        .where(and(eq(serviceReminders.id, d.id), eq(serviceReminders.status, "scheduled")));
      continue;
    }
    if (defer.has(d.phone)) {
      r.deferred++;
      continue;
    }
    if (room <= 0) {
      r.capped++;
      continue;
    }
    try {
      const claim = await db
        .update(serviceReminders)
        .set({ status: "sent", sentAt: new Date() })
        .where(and(eq(serviceReminders.id, d.id), eq(serviceReminders.status, "scheduled")));
      if (((claim as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) !== 1) continue; // another run claimed it
      room--;

      const text = approvedReminderText(d.serviceType)!;
      const variantKey = `service_reminder_${d.serviceType}`;
      const result = await sendSms(d.phone, text, { via: "shop", skipPersist: true, variantKey });
      if (!result.queued && !result.heldOut) await logOutboundSms(d.phone, text, result, variantKey);

      const outcome = smsOutcome(result);
      if (outcome === "failed") {
        r.failed++;
        // A definite failure was not delivered: give the row back so the next run retries it.
        await db
          .update(serviceReminders)
          .set({ status: "scheduled", sentAt: null, errorMessage: String(result.error ?? "send failed").slice(0, 500) })
          .where(and(eq(serviceReminders.id, d.id), eq(serviceReminders.status, "sent")));
      } else if (outcome === "heldout") {
        r.heldOut++;
        await db
          .update(serviceReminders)
          .set({ status: "cancelled", sentAt: null, errorMessage: "no-text holdout (contactExperiment)" })
          .where(and(eq(serviceReminders.id, d.id), eq(serviceReminders.status, "sent")));
      } else {
        r[outcome]++;
        if (result.sid) await db.update(serviceReminders).set({ twilioSid: result.sid }).where(eq(serviceReminders.id, d.id));
      }
    } catch (err) {
      r.failed++;
      log.warn("service reminder row failed", { id: d.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  log.info("service reminders sent", { ...r });
  return r;
}
