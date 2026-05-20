/**
 * Vapi Webhook Router
 *
 * Vapi posts to /api/webhooks/vapi when:
 *   - Tool calls fire during a call (function-call event)
 *   - Call status changes (start/end/transfer)
 *   - Transcript updates (optional)
 *
 * The tool calls forward to our voiceAgent tRPC router. We expose this
 * as a thin shim because Vapi's tool-call protocol is JSON-only and
 * our internal tRPC speaks structured input/output.
 *
 * SECURITY: Vapi sends VAPI_WEBHOOK_SECRET verbatim in the `x-vapi-secret`
 * header (the assistant's `server.secret`). We compare it constant-time in
 * production; in dev (no secret configured) we skip + log a warning.
 */

import { Router, type Request, type Response } from "express";
import express from "express";
import { timingSafeEqual } from "node:crypto";
import { createLogger } from "../../lib/logger";

const log = createLogger("webhooks:vapi");
const router = Router();

// Vapi posts JSON. We need raw body for signature validation, so stash
// it on the request before json parsing.
router.use(
  express.json({
    limit: "1mb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// ─── Signature validation ──────────────────────────────

function verifyVapiSignature(req: Request): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  // No secret configured → allow in dev, reject in prod.
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      log.warn("VAPI_WEBHOOK_SECRET not configured — rejecting request in prod");
      return false;
    }
    return true;
  }
  // Vapi sends the assistant's `server.secret` VERBATIM in `x-vapi-secret`
  // — it is NOT an HMAC of the body. The prior code did HMAC-SHA256 over an
  // `x-vapi-signature` header Vapi never sends, so every tool call 401'd.
  // Compare the plain secret constant-time. `x-vapi-signature` is accepted
  // as a fallback for Vapi's custom-credential auth mode.
  const headerVal = req.headers["x-vapi-secret"] ?? req.headers["x-vapi-signature"];
  const presented = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  if (!presented || typeof presented !== "string") return false;
  try {
    const a = Buffer.from(presented);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── Tool call dispatcher ──────────────────────────────

interface VapiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

async function dispatchToolCall(call: VapiToolCall): Promise<{
  toolCallId: string;
  result: string;
}> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments || "{}");
  } catch (err) {
    return {
      toolCallId: call.id,
      result: JSON.stringify({ error: "Invalid arguments JSON", details: err instanceof Error ? err.message : String(err) }),
    };
  }

  log.info("Vapi tool call", { name: call.function.name, args });

  try {
    // Each tool delegates to the corresponding voiceAgent procedure.
    // We import the router lazily to avoid circular import + cold-start cost.
    const { voiceAgentRouter } = await import("../../routers/voiceAgent");
    // wave-148 — pass isVoiceAgentInternal=true so the protected write
    // mutations (bookSlot/escalate/sendConfirmationSms) accept this
    // dispatch. The VAPI webhook signature was already verified at the
    // route handler entry; this flag certifies "trust from the webhook
    // layer to the internal procedure call".
    const caller = voiceAgentRouter.createCaller({
      user: null,
      isVoiceAgentInternal: true,
    } as never);
    let output: unknown;

    switch (call.function.name) {
      // ─── shop info / status ──────────────────────────────
      case "shopInfo":
        output = await caller.shopInfo();
        break;
      case "capacityCheck":
        output = await caller.capacityCheck(args as { day?: string });
        break;
      // wave-179: real-time wait estimate from current booking queue.
      // Caller asks "how busy are you" → accurate "open / busy / loaded"
      // answer instead of generic FCFS line.
      case "getCurrentWaitTime":
        output = await caller.getCurrentWaitTime();
        break;

      // ─── pricing / quoting ───────────────────────────────
      case "quoteRange":
        output = await caller.quoteRange(args as { service: string; vehicleYear?: number; vehicleMake?: string });
        break;
      // wave-179: vehicle Y/M/M → tire-size lookup. AI hears "F-150"
      // → calls this → returns "265/70R17" so it can pitch correctly.
      // Already existed in router but wasn't wired to webhook dispatcher.
      case "tireSizeFromVehicle":
        output = await caller.tireSizeFromVehicle(args as { year: number; make: string; model: string });
        break;

      // ─── customer recognition ────────────────────────────
      // wave-179: caller phone → existing customer record. AI personalizes
      // greeting ("Hi Robert! Welcome back!") + skips redundant info-gather.
      // Highest-impact retention move on the voice channel.
      case "lookupCustomer":
        output = await caller.lookupCustomer(args as { phone: string });
        break;
      // wave-179: caller phone → any open ALG estimate awaiting decision.
      // Targets the $321K declined-work pipeline from the phone channel:
      // "I see we quoted you $487 back in March — still relevant?"
      case "getDeclinedEstimate":
        output = await caller.getDeclinedEstimate(args as { phone: string });
        break;

      // ─── booking actions ─────────────────────────────────
      case "bookSlot":
        output = await caller.bookSlot(args as { name: string; phone: string; service: string; vehicle?: string; preferredDay?: string; callId?: string });
        break;
      // wave-179: warm-lead capture for tire inquiries that don't yet
      // commit. Already existed but wasn't wired. Now Vapi can call
      // tireInquiry → lead lands in admin with source="callback" + a
      // [VOICE-AGENT TIRE INQUIRY] marker.
      case "tireInquiry":
        output = await caller.tireInquiry(args as { name: string; phone: string; tireSize?: string; vehicle?: string; newOrUsed?: "new" | "used" | "either"; installationNeeded?: boolean; callId?: string });
        break;
      // wave-179: after-hours callback capture. Writes to callbackRequests
      // (same table the website's CallbackModal uses) so front desk sees
      // every overnight call as a first-thing-morning callback queue.
      case "scheduleCallback":
        output = await caller.scheduleCallback(args as { name: string; phone: string; reason?: string; preferredTime?: string; callId?: string });
        break;
      // wave-181: physical rack-check capture. Caller refused to drive
      // over without stock confirmation → AI promises a 15-min callback,
      // tool flags lead with urgency=5 + fires Telegram to front desk.
      case "checkTireStock":
        output = await caller.checkTireStock(args as { name: string; phone: string; tireSize: string; vehicle?: string; callId?: string });
        break;

      // ─── escalations + confirmations ─────────────────────
      case "escalate":
        output = await caller.escalate(args as { name: string; phone: string; reason: string; urgency?: "low" | "medium" | "high"; callId?: string });
        break;
      case "sendConfirmationSms":
        output = await caller.sendConfirmationSms(args as { phone: string; summary: string; mapLink?: string });
        break;

      default:
        // wave-181.15 · silent-failure audit Finding #8: was returning
        // { error: "Unknown tool: <name>" } as if it were a valid tool
        // RESULT, which VAPI reads literally and sometimes recites to
        // the caller. Now: log it loudly + return a graceful message
        // the AI can decline with.
        log.error("Unknown tool requested by VAPI", {
          errorId: "VAPI_UNKNOWN_TOOL",
          toolName: call.function.name,
          toolCallId: call.id,
        });
        output = {
          error: "Tool not implemented",
          graceful: "I don't have access to that right now — please rephrase or I can transfer you to the shop.",
        };
    }

    return { toolCallId: call.id, result: JSON.stringify(output) };
  } catch (err) {
    log.error("Tool call dispatch failed", {
      tool: call.function.name,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      toolCallId: call.id,
      result: JSON.stringify({
        error: "Tool execution failed",
        details: err instanceof Error ? err.message : String(err),
      }),
    };
  }
}

// ─── Main webhook endpoint ─────────────────────────────

router.post("/vapi", async (req: Request, res: Response) => {
  if (!verifyVapiSignature(req)) {
    log.warn("Invalid Vapi signature");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  const body = req.body as {
    message: {
      type: string;
      call?: { id?: string; startedAt?: string; endedAt?: string; endedReason?: string };
      toolCalls?: VapiToolCall[];
      transcript?: string;
    };
  };

  const event = body?.message;
  if (!event?.type) {
    res.status(400).json({ error: "Missing message.type" });
    return;
  }

  try {
    switch (event.type) {
      case "function-call":
      case "tool-calls": {
        // wave-181.4 · capture LLM→tool→ack round-trip latency so the
        // /api/admin/voice-latency observability tile can surface it.
        // Anchored at handler entry; the actual write happens AFTER
        // results assemble so a telemetry bug can't break the response.
        const webhookReceivedAt = Date.now();
        // Multiple tool calls arrive in one webhook. Run in parallel.
        // wave-116 — was Promise.all; a single rejection caused the
        // webhook to 500, prompting VAPI to retry the WHOLE batch and
        // potentially double-execute already-succeeded tools (e.g.
        // scheduleDropoff fired twice). allSettled isolates per-call
        // outcomes so the webhook always 200s with a per-tool result.
        const calls = event.toolCalls || [];
        const settled = await Promise.allSettled(calls.map(dispatchToolCall));
        const results = settled.map((s, i) => {
          if (s.status === "fulfilled") return s.value;
          const err = s.reason instanceof Error ? s.reason.message : String(s.reason);
          log.error("Tool call rejected", {
            toolCallId: calls[i]?.id,
            functionName: calls[i]?.function?.name,
            error: err,
          });
          return {
            toolCallId: calls[i]?.id,
            error: err,
          };
        });
        res.json({ results });

        // Fire-and-forget latency capture · service swallows all errors
        // so a missing migration or transient DB issue never breaks the
        // webhook response above.
        const callId = event.call?.id;
        const assistantId = (event.call as { assistantId?: string } | undefined)?.assistantId;
        if (callId) {
          import("../../services/voice-latency").then(({ captureVoiceLatency }) =>
            captureVoiceLatency({
              callId,
              assistantId: assistantId ?? "unknown",
              stage: "llm_first_token",
              latencyMs: Date.now() - webhookReceivedAt,
              metadata: { source: "vapi-webhook", toolCalls: calls.length },
            })
          ).catch(() => { /* intentionally swallowed */ });

          // wave-181.63 (Phase 4 · 2026-05-18 PM) · state-tracker hook.
          // Classify each tool call into a state transition (read tool =
          // intent_captured · write tool = tool_called · confirmation
          // tool = confirmed). Append-only · multiple events per call
          // are correct (the trail tells you the agent re-engaged after
          // a tool call). Fire-and-forget · NEVER blocks webhook.
          import("../../services/voice-call-state").then(({ classifyToolToState, recordCallState }) => {
            for (const c of calls) {
              const state = classifyToolToState(c.function?.name ?? "");
              if (state) {
                void recordCallState({
                  callId,
                  assistantId,
                  state,
                  metadata: { tool: c.function?.name, toolCallId: c.id },
                });
              }
            }
          }).catch(() => { /* intentionally swallowed */ });
        }
        return;
      }

      case "status-update":
      case "call-start": {
        log.info("Vapi call started", { callId: event.call?.id });
        // wave-181.63 (Phase 4 · 2026-05-18 PM) · state-tracker hook.
        // Record `greeted` on call start. Fire-and-forget · the existing
        // ack path stays untouched.
        const callId = event.call?.id;
        const assistantId = (event.call as { assistantId?: string } | undefined)?.assistantId;
        if (callId) {
          import("../../services/voice-call-state").then(({ recordCallState }) =>
            recordCallState({
              callId,
              assistantId,
              state: "greeted",
              metadata: { eventType: event.type },
            })
          ).catch(() => { /* intentionally swallowed */ });
        }
        // Acknowledge — no work needed for V1
        res.json({ ack: true });
        return;
      }

      case "end-of-call-report":
      case "call-end": {
        log.info("Vapi call ended", {
          callId: event.call?.id,
          reason: event.call?.endedReason,
        });
        // wave-125 — persist a vapi_call_logs row so calls that didn't
        // explicitly trigger a callback/booking still appear in the
        // unified intake feed. Operator can review "today's voice
        // calls that mentioned brakes" even when the customer hung up
        // without booking. Best-effort: never blocks the webhook.
        try {
          const callId = event.call?.id;
          if (callId) {
            const { getDb } = await import("../../db");
            const { vapiCallLogs } = await import("../../../drizzle/schema");
            const d = await getDb();
            if (d) {
              const summary = (event as { summary?: string; analysis?: { summary?: string } })?.summary
                ?? (event as { summary?: string; analysis?: { summary?: string } })?.analysis?.summary
                ?? null;
              const transcript = (event as { transcript?: string })?.transcript ?? "";
              // Light heuristic for service mention — extract any mention
              // of common services from transcript or summary.
              const text = (typeof transcript === "string" ? transcript : "")
                + " " + (summary ?? "");
              const services = ["brake", "tire", "oil change", "alignment", "battery", "engine", "transmission", "ac", "exhaust", "diagnostic", "emission"];
              const serviceMention = services.find((s) => text.toLowerCase().includes(s)) ?? null;
              const customer = (event.call as { customer?: { number?: string; name?: string } })?.customer;
              await d.insert(vapiCallLogs).values({
                vapiCallId: String(callId),
                phoneNumber: customer?.number ?? null,
                customerName: customer?.name ?? null,
                durationSeconds: Math.round(((event.call as { startedAt?: string; endedAt?: string })?.endedAt && (event.call as { startedAt?: string })?.startedAt)
                  ? (new Date((event.call as { endedAt?: string }).endedAt!).getTime() - new Date((event.call as { startedAt?: string }).startedAt!).getTime()) / 1000
                  : 0),
                endedReason: event.call?.endedReason ?? null,
                aiSummary: summary,
                serviceMention,
                convertedToLead: 0, // updated later if a lead is created from this call
                transcriptUrl: (event.call as { transcript?: string; transcriptUrl?: string })?.transcriptUrl ?? null,
                recordingUrl: (event.call as { recordingUrl?: string })?.recordingUrl ?? null,
              }).catch((err: unknown) => {
                // Tolerate dup-key on retry — webhooks can fire twice
                const msg = err instanceof Error ? err.message : String(err);
                if (!/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
                  log.warn("vapi_call_logs insert failed", { error: msg });
                }
              });
            }
          }
        } catch (persistErr) {
          log.warn("[vapi webhook] call-end persist failed (non-blocking)", {
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }
        // wave-181.63 (Phase 4 · 2026-05-18 PM) · state-tracker hook.
        // Record `ended` on call-end with reason metadata so the active-
        // calls view can drop this call out of the in-flight list.
        const endCallId = event.call?.id;
        const endAssistantId = (event.call as { assistantId?: string } | undefined)?.assistantId;
        if (endCallId) {
          import("../../services/voice-call-state").then(({ recordCallState }) =>
            recordCallState({
              callId: endCallId,
              assistantId: endAssistantId,
              state: "ended",
              metadata: { reason: event.call?.endedReason, eventType: event.type },
            })
          ).catch(() => { /* intentionally swallowed */ });
        }

        // wave-181.87 · dispatch outbound call.ended to confirmation_calls
        // OR alg_estimates voice_recovery_call_id by callId lookup. Same
        // pattern as the dropped AgentPhone webhook (wave-181.85) · this
        // handler now serves BOTH inbound flows (above) AND outbound
        // confirmation + recovery flows via the wave-181.87 VAPI
        // placeOutboundCall path.
        if (endCallId) {
          try {
            const { getDb } = await import("../../db");
            const { confirmationCalls, algEstimates } = await import("../../../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const transcriptText = ((event as { transcript?: string }).transcript ?? "")
                + " " + ((event as { summary?: string; analysis?: { summary?: string } }).summary
                  ?? (event as { analysis?: { summary?: string } }).analysis?.summary
                  ?? "");
              const lower = transcriptText.toLowerCase();
              const snippet = transcriptText.slice(0, 500);

              // Classification · same regex pattern as the dropped
              // agentphone classifyTranscript helper.
              let confirmStatus: "confirmed" | "rescheduled" | "no_answer" = "no_answer";
              let rescheduleRequest: string | null = null;
              if (transcriptText.trim().length > 0) {
                if (/\b(reschedule|move it|change the time|different day|can we do|push it|next week|earlier|later in the day|cancel)\b/i.test(lower)) {
                  confirmStatus = "rescheduled";
                  const sentences = lower.split(/[.!?]/);
                  const rs = sentences.find((s) => /\b(reschedule|move|change|different day|push|earlier|later)\b/i.test(s));
                  rescheduleRequest = (rs || "").trim().slice(0, 200) || null;
                } else if (/\b(yes|yeah|yep|confirm|still on|see you|i.?ll be there|sounds good|works for me|all set)\b/i.test(lower)) {
                  confirmStatus = "confirmed";
                } else {
                  // Default · ambiguous transcript with content → confirmed
                  confirmStatus = "confirmed";
                }
              } else {
                confirmStatus = "no_answer";
              }

              // Try 1 · confirmation_calls
              const [confRow] = await db
                .select()
                .from(confirmationCalls)
                .where(eq(confirmationCalls.agentphoneCallId, endCallId))
                .limit(1);

              if (confRow) {
                await db
                  .update(confirmationCalls)
                  .set({
                    status: confirmStatus,
                    transcriptSnippet: snippet,
                    rescheduleRequest,
                    completedAt: new Date(),
                  })
                  .where(eq(confirmationCalls.id, confRow.id));
                log.info(`[vapi outbound] confirmation_calls #${confRow.id} → ${confirmStatus}`, {
                  callId: String(endCallId).slice(0, 16),
                });
              } else {
                // Try 2 · alg_estimates voice_recovery
                const [estRow] = await db
                  .select({ id: algEstimates.id })
                  .from(algEstimates)
                  .where(eq(algEstimates.voiceRecoveryCallId, endCallId))
                  .limit(1);
                if (estRow) {
                  // Map confirmation classification → recovery enum
                  const recoveryOutcome: "interested" | "not_interested" | "no_answer" =
                    confirmStatus === "no_answer" ? "no_answer" :
                    // For recovery · check for explicit not-interested signals
                    /\b(not interested|no thanks|already|fixed it|sold the car|don't need|not now)\b/i.test(lower) ? "not_interested" :
                    "interested";
                  await db
                    .update(algEstimates)
                    .set({ voiceRecoveryOutcome: recoveryOutcome })
                    .where(eq(algEstimates.id, estRow.id));
                  log.info(`[vapi outbound] alg_estimates #${estRow.id} voice_recovery → ${recoveryOutcome}`, {
                    callId: String(endCallId).slice(0, 16),
                  });
                }
                // No match in either table · inbound call · already handled above
              }
            }
          } catch (dispatchErr) {
            log.warn("[vapi outbound] dispatch failed (non-blocking)", {
              error: dispatchErr instanceof Error ? dispatchErr.message : String(dispatchErr),
            });
          }
        }

        res.json({ ack: true });
        return;
      }

      case "transcript":
        // Real-time transcript updates — log in dev, ignore in prod
        if (process.env.NODE_ENV !== "production") {
          log.info("Vapi transcript chunk", { len: event.transcript?.length });
        }
        res.json({ ack: true });
        return;

      // wave-181.63 · Phase 6 · cross-call memory hydration.
      // VAPI fires `assistant-request` BEFORE the call connects. The
      // response shape is `{ assistantOverrides?: {...} }` which VAPI
      // merges with the assistant's configured fields for THIS call
      // only (no PATCH to the global assistant). We look up the caller
      // by phone and, when known, override `firstMessage` so the agent
      // greets them by name + vehicle. Unknown callers get the
      // default first message.
      case "assistant-request": {
        const customer = (event.call as { customer?: { number?: string } } | undefined)?.customer;
        const phone = customer?.number?.trim();
        if (!phone) {
          // No phone in the request · can't personalize · fall through
          // to default assistant.
          res.json({});
          return;
        }
        try {
          const { buildPersonalizedFirstMessage } = await import(
            "../../services/vapi-personalization"
          );
          const result = await buildPersonalizedFirstMessage(phone);
          log.info("assistant-request personalization", {
            phoneSuffix: phone.replace(/\D/g, "").slice(-4),
            matched: result.matched,
            reason: result.reason,
          });
          if (result.firstMessage) {
            res.json({
              assistantOverrides: { firstMessage: result.firstMessage },
            });
            return;
          }
        } catch (err) {
          log.warn("assistant-request personalization threw", {
            err: err instanceof Error ? err.message : String(err),
          });
        }
        // Default · use assistant's configured first message.
        res.json({});
        return;
      }

      default:
        log.info("Vapi unknown event type", { type: event.type });
        res.json({ ack: true });
        return;
    }
  } catch (err) {
    log.error("Vapi webhook handler threw", {
      err: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

export { router as vapiWebhookRouter };
