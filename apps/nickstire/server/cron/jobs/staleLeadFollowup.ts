/**
 * Cron: Stale Lead Follow-Up
 * Auto-contacts leads not responded to within 2 hours.
 * Speed-to-lead is the #1 conversion factor for service businesses.
 */
import { createLogger } from "../../lib/logger";
import { and, eq, gte, lte, ne, isNull } from "drizzle-orm";

import { BUSINESS } from "@shared/business";
const log = createLogger("cron:stale-leads");

export async function processStaleLeadFollowUp(): Promise<{ recordsProcessed: number }> {
  try {
    // Only during business hours (ET)
    const etHour = parseInt(new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
    if (etHour < 8 || etHour > 18) return { recordsProcessed: 0 };

    const { isEnabled } = await import("../../services/featureFlags");
    if (!(await isEnabled("smart_sms_auto_reply"))) return { recordsProcessed: 0 };

    const { getDb } = await import("../../db");
    const { leads } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0 };

    // Find uncontacted ('new') leads in the speed-to-lead window.
    // Lower bound 2h: don't spam a brand-new lead (give the human a chance
    // to reply first). Upper bound 24h (was 6h): a lead created overnight is
    // already >6h old by the 08:00 ET run and used to fall out of the window
    // forever — never contacted. 24h spans the longest off-hours gap
    // (~18:00 close -> 08:00 open) so the FIRST business-hours run still
    // catches it, while excluding day-old abandoned leads. The at-most-once
    // 'new' -> 'contacted' claim below means widening this can't double-text.
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // AG-43 · exclude job applicants. The careers form writes a lead
    // with source='careers'; without this filter an applicant who sat
    // 'new' for 2h got a customer-style "following up on your service"
    // SMS. Applicants are HR pipeline, never sales outreach.
    const staleLeads = await db.select().from(leads)
      .where(
        and(
          eq(leads.status, "new"),
          ne(leads.source, "careers"),
          gte(leads.createdAt, twentyFourHoursAgo),
          lte(leads.createdAt, twoHoursAgo),
        )
      )
      .limit(20);

    if (staleLeads.length === 0) return { recordsProcessed: 0 };

    const { sendSms } = await import("../../sms");
    const { customers } = await import("../../../drizzle/schema");
    const { normalizePhone } = await import("../../lib/phone");

    const optedOutRows = await db.select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    const optOuts = new Set(
      optedOutRows
        .map((r: { phone: string | null }) => normalizePhone(r.phone))
        .filter((p: string | null): p is string => p !== null)
    );
    let processed = 0;

    for (const lead of staleLeads) {
      if (!lead.phone) continue;

      const normalizedLead = normalizePhone(lead.phone);
      if (normalizedLead && optOuts.has(normalizedLead)) continue;

      // At-most-once claim — flip status 'new' -> 'contacted' BEFORE the
      // send. If the run crashes after the text goes out, the lead is
      // already out of the 'new' pool, so the next 2-hourly run won't
      // re-text it. The conditional WHERE makes overlapping runs safe.
      const claimRes = await db.update(leads)
        // Stamp the contacted flag + timestamps alongside the status flip so
        // the row doesn't sit `status="contacted", contacted=0, contactedAt=null`
        // (breaks time-to-contact analytics + the admin "No follow-up recorded"
        // badge). This IS the contact event — an automated speed-to-lead
        // follow-up text — so contactedAt = now. contactedBy stays null, the
        // honest signal that no human has reached out yet.
        .set({ status: "contacted", contacted: 1, contactedAt: new Date(), lastFollowUpAt: new Date() })
        .where(and(eq(leads.id, lead.id), eq(leads.status, "new")));
      if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run
      }

      const { orchestrateSms } = await import("../../services/smsOrchestrator");
      const result = await orchestrateSms({
        type: "stale_lead_followup",
        phone: lead.phone,
        leadId: lead.id,
      });
      if (result.status === "sent" || result.status === "queued") processed++;
    }

    if (processed > 0) {
      log.info(`Stale lead follow-up: contacted ${processed} leads`);
    }
    return { recordsProcessed: processed };
  } catch (err) {
    log.error("Stale lead follow-up failed", { error: err instanceof Error ? err.message : String(err) });
    return { recordsProcessed: 0 };
  }
}
