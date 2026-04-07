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
  // Check feature flag
  const { isEnabled } = await import("../../services/featureFlags");
  if (!(await isEnabled("sms_cross_sell_outreach"))) {
    return { recordsProcessed: 0, details: "Feature disabled" };
  }

  // Check Twilio is configured
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    return { recordsProcessed: 0, details: "Twilio not configured" };
  }

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

      // 2. Check 30-day cooldown — look for recent outbound cross-sell SMS to this phone
      const cooldownDate = new Date();
      cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);

      // Check via sms_messages for recent outbound to this customer
      const [conv] = await db.select({ id: smsConversations.id })
        .from(smsConversations)
        .where(like(smsConversations.phone, `%${normalized}`))
        .limit(1);

      if (conv) {
        const recentOutbound = await db.select({ id: smsMessages.id })
          .from(smsMessages)
          .where(and(
            eq(smsMessages.conversationId, conv.id),
            eq(smsMessages.direction, "outbound"),
            gte(smsMessages.createdAt, cooldownDate),
            sql`${smsMessages.body} LIKE '%might be time for%'`
          ))
          .limit(1);

        if (recentOutbound.length > 0) {
          skipped++;
          continue;
        }
      }

      // 3. Build and send the SMS
      const firstName = (rec.name || "there").split(" ")[0];
      const serviceLabel = SERVICE_LABELS[rec.service] || rec.service;
      const message = `Hi ${firstName}! Based on your last visit, it might be time for ${serviceLabel}. Come by Nick's Tire & Auto — drop-offs welcome! Reply STOP to opt out.`;

      const result = await sendSms(rec.phone, message);
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
        }, { priority: "low", source: "cron:cross-sell-outreach" }).catch(() => {});
      } else {
        log.warn(`Cross-sell SMS failed for ${firstName}: ${result.error || "unknown"}`);
      }

      // Rate limit between sends
      await new Promise(r => setTimeout(r, 1500));
    }

    const details = `${sent} SMS sent, ${skipped} skipped (${actionable.length} actionable recommendations)`;
    if (sent > 0) log.info(`Cross-sell outreach: ${details}`);
    return { recordsProcessed: sent, details };
  } catch (err: any) {
    log.error("Cross-sell outreach failed:", { error: err.message });
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}
