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
 *     recipientCount: number,     // for the preview message (compose-time count)
 *     bodyPreview: string,        // first ~120 chars, Telegram preview only
 *     targetSegment: string,      // human-readable, e.g. "high-LTV slow payers"
 *     segment: "recent"|"lapsed"|"all", // machine-actionable — nickstire's
 *                                 // bridge only understands these 3 segments
 *     messageTemplate: string,    // the FULL message body actually sent
 *     audit: { proposedBy: "operator" | "ai", reason?: string },
 *   }
 *
 * Flow:
 *   1. Receive the event · build a preview message
 *   2. Send Telegram with two inline buttons: Approve / Reject
 *   3. step.waitForEvent("bulk-sms/approval-response") · matches on
 *      data.campaignId · 30 minute timeout
 *   4. On approve → POST to nickstire's /api/bridge/bulk-sms-send
 *   5. On reject or timeout → audit + exit clean
 *
 * Why this is here · the Wave-200 plan called for `step.waitForEvent`
 * as a real consumer (not just a scaffolded option). This shows the
 * pattern + gives the operator a real workflow they can trigger from
 * the chat surface ("send a 7-day winback to the high-LTV slow
 * payers · ask me first").
 *
 * Live-send safety (2026-07-09 wiring) · TWO independent flags must
 * both be true before a real SMS goes out, on top of nickstire's own
 * per-phone caps/cooldown/opt-out inside sendSms():
 *   1. This function only requests dryRun:false when
 *      env.FEATURE_BULK_SMS_LIVE === "1" on statenour. Unset/anything
 *      else → every approved campaign dispatches as a dry run (nickstire
 *      does DB reads + a Telegram preview, sends nothing).
 *   2. nickstire's /api/bridge/bulk-sms-send ALSO defaults dryRun to
 *      true independent of what's requested — see its doc comment in
 *      _core/statenour-bridge-routes.ts.
 * Flip FEATURE_BULK_SMS_LIVE=1 on statenour's Railway env only after
 * reviewing dry-run output (Telegram) for a real campaign.
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
  segment: "recent" | "lapsed" | "all";
  messageTemplate: string;
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

    // Step 3 · dispatch to nickstire's bridge. See the file-header comment
    // for the two-flag live-send safety design. dryRun follows this
    // statenour-side flag; nickstire's endpoint applies its own default-safe
    // gate independently — this is not the only thing standing between
    // "operator approved" and "real SMS left the building."
    const dispatchResult = await step.run("dispatch-bulk-sms", async () => {
      const { postNickstireBridge } = await import("@/lib/nickstire/query");
      const liveEnabled = process.env.FEATURE_BULK_SMS_LIVE === "1";

      const result = await postNickstireBridge<{
        success: boolean;
        dryRun: boolean;
        targetCount: number;
        truncated: boolean;
        campaignDbId?: number;
        preview?: string;
      }>("/api/bridge/bulk-sms-send", {
        campaignId: data.campaignId,
        segment: data.segment,
        messageTemplate: data.messageTemplate,
        dryRun: !liveEnabled,
      });

      log.info("bulk_sms_dispatch_result", {
        campaignId: data.campaignId,
        requestedLive: liveEnabled,
        result,
      });

      if ("error" in result) {
        throw new Error(`nickstire bridge dispatch failed: ${result.error}`);
      }
      return result.data;
    });

    await step.run("notify-sent", async () => {
      const { sendTelegram } = await import("@/lib/services/telegram");
      const d = dispatchResult;
      const truncatedNote = d.truncated ? " (recipient list was capped)" : "";
      const message = d.dryRun
        ? `🧪 Bulk SMS campaign <code>${data.campaignId}</code> · approved · ` +
          `dry run only — <b>${d.targetCount}</b> would receive it${truncatedNote}. ` +
          `No SMS sent. Set FEATURE_BULK_SMS_LIVE=1 on statenour to enable live sends.`
        : `✅ Bulk SMS campaign <code>${data.campaignId}</code> · approved · ` +
          `LIVE send started for <b>${d.targetCount}</b> recipients${truncatedNote} ` +
          `(nickstire campaign #${d.campaignDbId}).`;
      await sendTelegram(message, undefined, "HTML");
    });

    return {
      campaignId: data.campaignId,
      decision: "approve",
      recipientCount: data.recipientCount,
      dispatch: dispatchResult,
    };
  },
);
