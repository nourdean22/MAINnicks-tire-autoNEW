/**
 * Cron: Cross-Sell Outreach — Proactive SMS service recommendations
 *
 * Uses the intelligence engine's cross-sell recommendations to send
 * proactive SMS to customers who are due for related services.
 * Example: customer got brakes 3 months ago → likely needs tire rotation.
 *
 * Safety: checks opt-out, 30-day cooldown per customer, max 10 SMS/run.
 * Feature flag: sms_cross_sell_outreach (starts DISABLED)
 */
import { createLogger } from "../../lib/logger";
import { eq, and, sql, gte } from "drizzle-orm";

const log = createLogger("cron:cross-sell-outreach");

/** Max SMS per cron run to avoid spamming */
const MAX_SMS_PER_RUN = 10;

/** Cooldown: don't send cross-sell SMS to same customer within 30 days */
const COOLDOWN_DAYS = 30;

/** Human-readable service names for SMS */
const SERVICE_LABELS: Record<string, string> = {
  brakes: "a brake check",
  tires: "tire service",
  oil: "an oil change",
  suspension: "suspension service",
  engine: "an engine check",
  electrical: "electrical service",
  exhaust: "exhaust service",
  cooling: "cooling system service",
  transmission: "transmission service",
  diagnostic: "a vehicle inspection",
};

export async function processCrossSellOutreach(): Promise<{ recordsProcessed: number; details?: string }> {
  // Gate behind feature flag
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_cross_sell_outreach"))) return { recordsProcessed: 0, details: "Feature disabled" };

  // wave-181.60-followup (audit-181.58 finding · 2026-05-18 PM) · the
  // legacy Twilio env guard was blocking the entire cross-sell job in
  // prod because Twilio is dead per operator and the env vars are
  // intentionally unset on Railway. Every actual send below uses
  // `{ via: "shop" }` so it flows through F25e directly · no Twilio
  // credentials needed. Guard removed.

  try {
    const { generateCrossSellRecommendations } = await import("../../services/intelligenceEngines");
    const { recommendations } = await generateCrossSellRecommendations();

    // Filter to actionable urgency levels only
    const actionable = recommendations.filter(r => r.urgency === "overdue" || r.urgency === "upcoming");
    if (actionable.length === 0) {
      return { recordsProcessed: 0, details: "No actionable cross-sell recommendations" };
    }

    const { getDb } = await import("../../db");
    const { customers, smsMessages, smsConversations } = await import("../../../drizzle/schema");
    const { sendSms } = await import("../../sms");
    const { dispatch } = await import("../../services/eventBus");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    let sent = 0;
    let skipped = 0;

    for (const rec of actionable) {
      if (sent >= MAX_SMS_PER_RUN) break;
      if (!rec.phone) { skipped++; continue; }

      // 1. Check SMS opt-out
      const normalized = rec.phone.replace(/\D/g, "").slice(-10);
      const { like } = await import("drizzle-orm");
      const [cust] = await db.select({ smsOptOut: customers.smsOptOut })
        .from(customers).where(like(customers.phone, `%${normalized}`)).limit(1);

      if (cust?.smsOptOut) {
        skipped++;
        continue;
      }

      // 2. Check 30-day cooldown — has this phone had a cross-sell SMS in
      //    the last 30 days, under ANY of its conversation rows?
      //
      // BUG FIX (this wave) · the spam incident. The prior version resolved
      // "the" conversation with `LIKE '%suffix' LIMIT 1` — no ORDER BY, so
      // the row returned was arbitrary — then checked messages under that
      // single id. But a phone routinely has MULTIPLE smsConversations rows:
      // historically created in different formats ("+1…" vs bare 10-digit)
      // by different code paths (see logOutboundSms's own comment). The
      // LIMIT 1 frequently landed on a conversation row holding none of the
      // cross-sell messages → the cooldown saw nothing → every eligible
      // customer got re-texted on EVERY run. Fix: one JOIN that matches the
      // message's conversation by phone suffix, so a prior send is found
      // under ANY row for the number — no fragile single-conversation pick.
      const cooldownDate = new Date();
      cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);

      const recentOutbound = await db.select({ id: smsMessages.id })
        .from(smsMessages)
        .innerJoin(smsConversations, eq(smsMessages.conversationId, smsConversations.id))
        .where(and(
          like(smsConversations.phone, `%${normalized}`),
          eq(smsMessages.direction, "outbound"),
          gte(smsMessages.createdAt, cooldownDate),
          eq(smsMessages.variantKey, "cross_sell"),
        ))
        .limit(1);

      if (recentOutbound.length > 0) {
        skipped++;
        continue;
      }

      // 3. Build and send the SMS
      // wave-181.46 brand-voice tightening:
      //   - "Based on your last visit, it might be time" (passive, hedgy) →
      //     direct + concrete + customer language
      //   - Customer language: "your last visit" → "your last check-up",
      //     "drop-offs welcome" → "drop it off anytime"
      const firstName = (rec.name || "there").split(" ")[0];
      const serviceLabel = SERVICE_LABELS[rec.service] || rec.service;
      const message = `Hey ${firstName} — based on your last check-up, you're due for ${serviceLabel}. Free check, you don't pay until you say yes. Drop it off anytime. Reply STOP to opt out.`;

      // wave-181.46 · route through F25e gateway (Twilio dead per operator)
      const result = await sendSms(rec.phone, message, { via: "shop" });
      // wave-181.51 — persist to sms_messages so the /admin SMS Performance
      // tile sees these sends (pre-181.51 immediate sends bypassed the table
      // because sendSms() only persists the delayed-queue path).
      const { logOutboundSms } = await import("../../services/smsInstrumentation");
      await logOutboundSms(rec.phone, message, result.sid, "cross_sell");
      if (result.success) {
        sent++;
        log.info(`Cross-sell SMS sent to ${firstName} (${rec.service}): ${rec.reason}`);

        // Log to event bus
        dispatch("campaign_sent", {
          type: "cross-sell-outreach",
          customerId: rec.customerId,
          phone: rec.phone,
          service: rec.service,
          reason: rec.reason,
          urgency: rec.urgency,
        }, { priority: "low", source: "cron:cross-sell-outreach" }).catch((e) => { log.warn("[jobs/crossSellOutreach] fire-and-forget failed:", e); });
      } else {
        log.warn(`Cross-sell SMS failed for ${firstName}: ${result.error || "unknown"}`);
      }

      // Rate limit between sends
      await new Promise(r => setTimeout(r, 1500));
    }

    const details = `${sent} SMS sent, ${skipped} skipped (${actionable.length} actionable recommendations)`;
    if (sent > 0) log.info(`Cross-sell outreach: ${details}`);
    return { recordsProcessed: sent, details };
  } catch (err: unknown) {
    log.error("Cross-sell outreach failed:", { error: (err as Error).message });
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}
