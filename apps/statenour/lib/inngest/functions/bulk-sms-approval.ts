/**
 * bulk-sms-approval · Wave-200 Phase 7+ follow-up (2026-05-17)
 *
 * Example of the human-in-loop pattern · `step.waitForEvent` pauses
 * the function until the operator confirms (or rejects) via a
 * Telegram inline button. Until then, no SMS goes out.
 *
 * Trigger event · `bulk-sms/proposed`
 *   data: {
 *     campaignId: string,         // operator-readable label
 *     recipientCount: number,     // for the preview message
 *     bodyPreview: string,        // first ~120 chars of the message
 *     targetSegment: string,      // e.g. "high-LTV slow payers"
 *     audit: { proposedBy: "operator" | "ai", reason?: string },
 *   }
 *
 * Flow:
 *   1. Receive the event · build a preview message
 *   2. Send Telegram with two inline buttons: Approve / Reject
 *   3. step.waitForEvent("bulk-sms/approval-response") · matches on
 *      data.campaignId · 30 minute timeout
 *   4. On approve → fire the actual bulk send via emitBulkSend()
 *   5. On reject or timeout → audit + exit clean
 *
 * Why this is here · the Wave-200 plan called for `step.waitForEvent`
 * as a real consumer (not just a scaffolded option). This shows the
 * pattern + gives the operator a real workflow they can trigger from
 * the chat surface ("send a 7-day winback to the high-LTV slow
 * payers · ask me first").
 *
 * Status · this function ships as a TEMPLATE · the actual bulk-SMS
 * sender is referenced via the existing nickstire bridge endpoint
 * (not invoked yet · operator wires it up when the workflow goes
 * live · zero risk of accidental mass SMS today).
 *
 * See: docs/operator/inngest-setup.md · ADR-0005
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/bulk-sms-approval");
const inngest = getInngest();

const APPROVAL_TIMEOUT = "30m";

interface BulkSmsProposedData {
  campaignId: string;
  recipientCount: number;
  bodyPreview: string;
  targetSegment: string;
  audit: { proposedBy: "operator" | "ai"; reason?: string };
}

interface BulkSmsApprovalResponseData {
  campaignId: string;
  decision: "approve" | "reject";
}

async function buildPreview(data: BulkSmsProposedData): Promise<string> {
  return (
    `📋 <b>Bulk SMS approval request</b>\n` +
    `Campaign · <code>${data.campaignId}</code>\n` +
    `Segment · ${data.targetSegment}\n` +
    `Recipients · <b>${data.recipientCount}</b>\n` +
    `Preview · ${data.bodyPreview.slice(0, 120)}\n\n` +
    `Reply in Telegram bot with <code>/approve ${data.campaignId}</code> ` +
    `or <code>/reject ${data.campaignId}</code> within ${APPROVAL_TIMEOUT}.`
  );
}

export const bulkSmsApproval = inngest.createFunction(
  {
    id: "bulk-sms-approval",
    name: "Bulk SMS · operator approval gate",
    retries: 0, // approval flows shouldn't auto-retry on operator silence
    onFailure: onInngestFailure,
    triggers: [{ event: "bulk-sms/proposed" }],
  },
  async ({ event, step }) => {
    const data = event.data as BulkSmsProposedData;

    // Step 1 · ship the preview to Telegram
    await step.run("send-approval-request", async () => {
      const { sendTelegram } = await import("@/lib/services/telegram");
      const message = await buildPreview(data);
      await sendTelegram(message, undefined, "HTML");
    });

    // Step 2 · wait for the operator's response · matched on campaignId
    const response = (await step.waitForEvent("operator-approval", {
      event: "bulk-sms/approval-response",
      match: "data.campaignId",
      timeout: APPROVAL_TIMEOUT,
    })) as { data: BulkSmsApprovalResponseData } | null;

    if (!response) {
      // Timeout · audit + bail
      await step.run("notify-timeout", async () => {
        const { sendTelegram } = await import("@/lib/services/telegram");
        await sendTelegram(
          `⏱️ Bulk SMS campaign <code>${data.campaignId}</code> · ` +
            `approval timed out after ${APPROVAL_TIMEOUT} · no SMS sent`,
          undefined,
          "HTML",
        );
      });
      log.info("bulk_sms_approval_timeout", { campaignId: data.campaignId });
      return { campaignId: data.campaignId, decision: "timeout" };
    }

    const decision = response.data.decision;
    if (decision !== "approve") {
      await step.run("notify-reject", async () => {
        const { sendTelegram } = await import("@/lib/services/telegram");
        await sendTelegram(
          `🚫 Bulk SMS campaign <code>${data.campaignId}</code> · ` +
            `operator rejected · no SMS sent`,
          undefined,
          "HTML",
        );
      });
      return { campaignId: data.campaignId, decision: "reject" };
    }

    // Step 3 · actually send (TEMPLATE · wires up to the existing
    // nickstire bulk-SMS endpoint when the workflow goes live · zero
    // risk of accidental mass SMS today).
    await step.run("dispatch-bulk-sms", async () => {
      log.info("bulk_sms_dispatch_template", {
        campaignId: data.campaignId,
        recipientCount: data.recipientCount,
        note: "TEMPLATE · no SMS actually sent · wire to nickstire bridge when ready",
      });
      // Future · POST to nickstire's bulk-SMS endpoint via the bridge:
      //   const { queryNickBatch } = await import("@/lib/nickstire/query");
      //   await queryNickBatch([{ query: "bulk_sms_send", filters: data }]);
    });

    await step.run("notify-sent", async () => {
      const { sendTelegram } = await import("@/lib/services/telegram");
      await sendTelegram(
        `✅ Bulk SMS campaign <code>${data.campaignId}</code> · approved · ` +
          `<b>${data.recipientCount}</b> recipients (template · no real SMS yet)`,
        undefined,
        "HTML",
      );
    });

    return {
      campaignId: data.campaignId,
      decision: "approve",
      recipientCount: data.recipientCount,
    };
  },
);
