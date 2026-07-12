/**
 * Per-lead notification delivery ledger writer.
 *
 * lead.ts dispatches email / SMS / Telegram fire-and-forget; before this, only
 * FAILURES were persisted (integration_failures), so "was the CEO email for
 * this lead even attempted?" was unanswerable after a restart. This appends one
 * durable row per dispatch attempt+outcome. Best-effort and non-blocking — a
 * ledger write must never break lead capture.
 *
 * SEMANTICS: "sent" means our dispatch call resolved without throwing, NOT a
 * carrier delivery receipt. True delivery confirmation needs provider webhooks
 * (Resend / Twilio) — a deliberate later enhancement. "failed" means the
 * retried dispatch threw.
 */
import { getDb } from "./db";
import { leadDeliveryEvents } from "../drizzle/schema";
import { createLogger } from "./lib/logger";

const log = createLogger("lead-delivery");

export type DeliveryChannel = "email" | "sms" | "telegram" | "capi" | "push";
export type DeliveryStatus = "attempted" | "sent" | "queued" | "delivered" | "failed" | "skipped";

export interface LeadDeliveryInput {
  leadId: number | null;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  provider?: string | null;
  providerRef?: string | null;
  detail?: string | null;
}

export async function recordLeadDelivery(input: LeadDeliveryInput): Promise<void> {
  try {
    const d = await getDb();
    if (!d) {
      log.warn(`[leadDelivery] DB unavailable; dropping ${input.channel}/${input.status} for lead#${input.leadId}`);
      return;
    }
    await d.insert(leadDeliveryEvents).values({
      leadId: input.leadId ?? null,
      channel: input.channel,
      status: input.status,
      provider: input.provider ?? null,
      providerRef: input.providerRef ?? null,
      detail: input.detail ? input.detail.substring(0, 1000) : null,
      createdAt: new Date(),
    });
  } catch (err) {
    // Never let audit logging break the caller.
    log.warn("[leadDelivery] failed to record delivery event", {
      channel: input.channel,
      status: input.status,
      leadId: input.leadId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
