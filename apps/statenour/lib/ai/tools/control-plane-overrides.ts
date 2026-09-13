import { tool } from "ai";
import { z } from "zod";
import { sendTelegramObserved } from "@/lib/services/telegram-observed";
import { formatTelegramNotification } from "@/lib/services/telegram";
import { idempotencyKey, withToolIdempotency } from "./tool-idempotency";

/**
 * Chat-only hardening overrides for tools whose legacy domain implementation
 * predates the turn control plane.
 *
 * Keep the canonical tool NAME and schema stable. `prepareTools` overlays this
 * object onto `nourTools` before pruning, so the catalog, trigger phrases and
 * user-facing behavior stay intact while the execution contract becomes more
 * truthful. Once the domain implementation adopts the same semantics this file
 * can disappear.
 */
export const controlPlaneToolOverrides = {
  sendTelegram: tool({
    description:
      "Send a Telegram message to Nour. Use for proactive alerts, reminders, or important notifications that need to reach his phone.",
    inputSchema: z.object({
      message: z.string().describe("Message content"),
      title: z.string().optional().describe("Optional title/header for the message"),
      urgency: z.enum(["low", "medium", "high"]).default("medium"),
    }),
    execute: async ({ message, title, urgency }) => {
      const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
      const fullMessage = title
        ? formatTelegramNotification(title, `${prefix} ${message}`)
        : `${prefix} ${message}`;

      type Result = {
        sent: boolean;
        state:
          | "provider_accepted"
          | "known_failure"
          | "unknown_completion"
          | "duplicate_suppressed"
          | "idempotency_unavailable";
        urgency: typeof urgency;
        messageLength: number;
        deduped?: boolean;
        priorState?: "claimed" | "unknown";
        reason?: string;
        messageId?: number;
        /** Existing tool telemetry treats a returned `error` field as a soft failure. */
        error?: string;
      };

      return withToolIdempotency<Result>(
        idempotencyKey("sendTelegram", fullMessage),
        5 * 60_000,
        async () => {
          const outcome = await sendTelegramObserved(fullMessage);
          if (outcome.state === "provider_accepted") {
            return {
              sent: true,
              state: "provider_accepted",
              urgency,
              messageLength: fullMessage.length,
              messageId: outcome.messageId,
            };
          }
          return {
            sent: false,
            state: outcome.state,
            urgency,
            messageLength: fullMessage.length,
            reason: outcome.reason,
            error:
              outcome.state === "unknown_completion"
                ? `Telegram completion is unknown (${outcome.reason}); do not claim sent or retry blindly.`
                : `Telegram send failed (${outcome.reason}).`,
          };
        },
        (ctx) => {
          const reason =
            ctx?.state === "unknown"
              ? "A prior identical send has unknown completion; not retried."
              : "An identical send is already claimed inside the dedupe window; not re-executed.";
          return {
            // A live marker proves only that an identical attempt is already in
            // flight/retained. It is NOT a provider success receipt. The legacy
            // implementation returned sent:true here, which could fabricate a
            // successful send from the existence of a dedupe marker alone.
            sent: false,
            state: "duplicate_suppressed",
            urgency,
            messageLength: fullMessage.length,
            deduped: true,
            priorState: ctx?.state ?? "claimed",
            reason,
            error: reason,
          };
        },
        undefined,
        {
          classifyResult: (result) => {
            if (result.state === "provider_accepted") return "success";
            if (result.state === "known_failure") return "known_failure";
            return "unknown";
          },
          // Unknown transport outcomes stay fenced long enough that an eager
          // model/client retry cannot double-send while the provider settles.
          unknownWindowMs: 30 * 60_000,
          // An externally-visible send is worse duplicated than delayed. If
          // the atomic claim store itself is unavailable, fail closed for this
          // tool rather than performing an untracked mutation.
          onClaimUnavailable: () => {
            const reason = "Idempotency store unavailable; send blocked to prevent an untracked duplicate.";
            return {
              sent: false,
              state: "idempotency_unavailable",
              urgency,
              messageLength: fullMessage.length,
              reason,
              error: reason,
            };
          },
        },
      );
    },
  }),
};
