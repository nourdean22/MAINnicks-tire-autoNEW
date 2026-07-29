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
          // Autopilot Wave 1 (2026-07-29): the claim is now the
          // lastFollowUpAt stamp (see below), so exclude already-claimed
          // rows here — a lead whose attempt failed/was blocked stays
          // status='new' (truth) but is never re-texted by this cron.
          isNull(leads.lastFollowUpAt),
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
    // Autopilot Wave 1 (2026-07-29) · channel dedupe. Never auto-text a lead
    // who (a) has a PENDING CALLBACK (they asked for a call — a text answers
    // the wrong question and double-contacts when the call happens), or
    // (b) sent an INBOUND SMS in the last 48h (an active conversation owns
    // the thread; the response-jobs spine is already handling them). Skipped
    // leads keep status='new' with lastFollowUpAt untouched — if the parallel
    // channel resolves them the lead gets updated there; if not, the 24h
    // stale_lead collector surfaces them for a human decision.
    const leadPhones = staleLeads
      .map((l: { phone: string | null }) => normalizePhone(l.phone))
      .filter((p: string | null): p is string => p !== null)
      .map((p: string) => p.slice(-10));
    const skipPhones = new Set<string>();
    if (leadPhones.length > 0) {
      try {
        const { sql } = await import("drizzle-orm");
        const phoneList = sql.join(leadPhones.map((p: string) => sql`${p}`), sql`, `);
        // Pending callbacks: small set (status='new'), so normalize in JS —
        // no REGEXP_REPLACE dependency (TiDB-version-safe).
        const [cbRows] = await db.execute(sql`
          SELECT phone FROM callback_requests WHERE status = 'new' LIMIT 200
        `);
        for (const r of Array.isArray(cbRows) ? cbRows : []) {
          const p = normalizePhone(String((r as { phone?: unknown }).phone ?? ""));
          if (p && leadPhones.includes(p.slice(-10))) skipPhones.add(p.slice(-10));
        }
        const [inboundRows] = await db.execute(sql`
          SELECT DISTINCT c.phone AS p
          FROM sms_messages m
          JOIN sms_conversations c ON c.id = m.conversationId
          WHERE m.direction = 'inbound'
            AND m.createdAt >= DATE_SUB(NOW(), INTERVAL 48 HOUR)
            AND c.phone IN (${phoneList})
        `);
        for (const r of Array.isArray(inboundRows) ? inboundRows : []) {
          const p = (r as { p?: unknown }).p;
          if (p) skipPhones.add(String(p));
        }
      } catch (err) {
        // Dedupe guards are read-only best-effort: an unreadable guard must
        // not block speed-to-lead entirely. Log and proceed unguarded.
        log.warn("stale-lead dedupe guard query failed — proceeding without", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    let processed = 0;

    for (const lead of staleLeads) {
      if (!lead.phone) continue;

      const normalizedLead = normalizePhone(lead.phone);
      if (normalizedLead && optOuts.has(normalizedLead)) continue;
      if (normalizedLead && skipPhones.has(normalizedLead.slice(-10))) {
        log.info("stale-lead skip — active parallel channel", { leadId: lead.id });
        continue;
      }

      // At-most-once claim — stamp lastFollowUpAt (NULL → now) BEFORE the
      // send so an overlapping run or a crash-after-send can never re-text.
      //
      // TRUTH FIX (Autopilot Wave 1): this claim used to flip
      // status='contacted', contacted=1, contactedAt=NOW() BEFORE the send —
      // so a BLOCKED or FAILED orchestration (flag off, opt-out, gateway
      // down) left the lead permanently recorded as contacted: invisible to
      // every recovery rail, poisoning time-to-contact metrics. The lead is
      // marked contacted ONLY on a confirmed dispatch below.
      const claimRes = await db.update(leads)
        .set({ lastFollowUpAt: new Date() })
        .where(and(eq(leads.id, lead.id), eq(leads.status, "new"), isNull(leads.lastFollowUpAt)));
      if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run
      }

      const { orchestrateSms } = await import("../../services/smsOrchestrator");
      const result = await orchestrateSms({
        type: "stale_lead_followup",
        phone: lead.phone,
        leadId: lead.id,
      });
      if (result.status === "sent" || result.status === "queued") {
        // CONFIRMED dispatch (sent to gateway, or durably queued for the
        // window — the queue delivers). NOW the contact is real: this IS the
        // contact event, so contactedAt = now; contactedBy stays null — the
        // honest signal that no human has reached out yet.
        await db.update(leads)
          .set({ status: "contacted", contacted: 1, contactedAt: new Date() })
          .where(and(eq(leads.id, lead.id), eq(leads.status, "new")));
        processed++;
      } else {
        // Blocked / drafted / failed / skipped: the lead was NOT contacted
        // and stays status='new' (truth). lastFollowUpAt keeps this cron off
        // it; the 24h stale_lead collector surfaces it to the Decision Inbox.
        log.info("stale-lead follow-up did not dispatch — lead stays uncontacted", {
          leadId: lead.id,
          status: result.status,
        });
      }
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
