/**
 * Abandoned Form Recovery — Captures partial form data and triggers recovery outreach
 *
 * Frontend sends partial data on blur events when form is 50%+ filled.
 * A cron job checks for partials with no matching completed submission
 * and sends a recovery SMS.
 */
import { createLogger } from "../lib/logger";
import { eq, and, gte, lte, isNull } from "drizzle-orm";

const log = createLogger("abandoned-forms");

interface PartialFormData {
  sessionId: string;
  formType: "booking" | "lead" | "callback" | "quote";
  name?: string;
  phone?: string;
  email?: string;
  service?: string;
  pageUrl?: string;
}

// In-memory store (production would use DB table)
const partials = new Map<string, PartialFormData & { createdAt: Date; recoveryAttempted: boolean }>();
const MAX_PARTIALS = 2000;

// Auto-cleanup every 20 minutes to prevent unbounded growth
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, p] of partials) {
    if (p.createdAt.getTime() < cutoff) partials.delete(id);
  }
  // Hard cap
  if (partials.size > MAX_PARTIALS) {
    const sorted = Array.from(partials.entries())
      .sort((a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime());
    const toRemove = partials.size - MAX_PARTIALS;
    for (let i = 0; i < toRemove; i++) partials.delete(sorted[i][0]);
  }
}, 20 * 60 * 1000);

/** Save partial form data (called from frontend on blur events) */
export function savePartialForm(data: PartialFormData): void {
  // Enforce cap at insertion time — don't accept new entries if at limit
  if (partials.size >= MAX_PARTIALS && !partials.has(data.sessionId)) return;
  partials.set(data.sessionId, {
    ...data,
    createdAt: new Date(),
    recoveryAttempted: false,
  });
  log.info("Partial form captured", { sessionId: data.sessionId, formType: data.formType, hasPhone: !!data.phone });
}

/** Mark a session as completed (form was submitted successfully) */
export function markFormCompleted(sessionId: string): void {
  partials.delete(sessionId);
}

/**
 * Process abandoned forms — called by cron every 30 min
 * Finds partials older than 30 min with no completion, sends recovery SMS
 */
export async function processAbandonedForms(): Promise<{ recordsProcessed: number }> {
  const now = Date.now();
  const thirtyMinAgo = now - 30 * 60 * 1000;
  const twoHoursAgo = now - 2 * 60 * 60 * 1000;
  let processed = 0;

  for (const [sessionId, partial] of partials) {
    const age = now - partial.createdAt.getTime();

    // Skip if too recent (< 30 min) or too old (> 2 hours)
    if (age < 30 * 60 * 1000 || age > 2 * 60 * 60 * 1000) continue;

    // Skip if already attempted recovery
    if (partial.recoveryAttempted) continue;

    // Must have phone to send SMS
    if (!partial.phone) continue;

    partial.recoveryAttempted = true;

    try {
      const { isEnabled } = await import("./featureFlags");
      if (!(await isEnabled("smart_sms_auto_reply"))) continue;

      // Check opt-out before sending recovery SMS
      const { getDb } = await import("../db");
      const d = await getDb();
      if (d) {
        const { customers } = await import("../../drizzle/schema");
        const { like } = await import("drizzle-orm");
        const normalized = partial.phone!.replace(/\D/g, "").slice(-10);
        const [cust] = await d.select({ smsOptOut: customers.smsOptOut })
          .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);
        if (cust?.smsOptOut) continue;
      }

      const { sendSms } = await import("../sms");
      const firstName = partial.name?.split(" ")[0] || "there";
      const message = `Hi ${firstName}, looks like you didn't finish booking at Nick's Tire & Auto. Need help? Call (216) 862-0005 or reply here!`;

      const result = await sendSms(partial.phone, message);
      if (result.success) {
        processed++;
        log.info("Abandoned form recovery sent", { sessionId, phone: partial.phone.slice(-4) });
      }
    } catch (err) {
      log.error("Recovery SMS failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Cleanup old entries (> 24 hours)
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  for (const [sessionId, partial] of partials) {
    if (partial.createdAt.getTime() < oneDayAgo) {
      partials.delete(sessionId);
    }
  }

  return { recordsProcessed: processed };
}

/** Get stats for admin */
export function getAbandonedFormStats(): { pending: number; total: number; withPhone: number } {
  let withPhone = 0;
  for (const p of partials.values()) {
    if (p.phone && !p.recoveryAttempted) withPhone++;
  }
  return {
    total: partials.size,
    pending: Array.from(partials.values()).filter(p => !p.recoveryAttempted).length,
    withPhone,
  };
}
