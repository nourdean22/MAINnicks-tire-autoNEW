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

// ─── Duration extraction (defensive · handles all VAPI shapes) ─────
//
// wave-Y-2026-05-26 · audit #79 baseline surfaced that 100% of today's
// vapi_call_logs rows have durationSeconds=0. The webhook's prior calc
// only read `event.call.startedAt`/`endedAt` and produced 0 when VAPI
// nests duration elsewhere. VAPI's actual end-of-call-report payload
// varies by event-type and SDK version · this helper tries every known
// path before giving up. Logs the keys it saw on a 0-fallback so the
// next miss is diagnosable.
function extractCallDurationSec(event: unknown): number {
  const e = event as Record<string, unknown>;
  if (!e) return 0;

  // 1 · explicit duration fields at message-level (some VAPI events)
  if (typeof e.durationSeconds === "number" && e.durationSeconds > 0) {
    return Math.round(e.durationSeconds);
  }
  if (typeof e.duration === "number" && e.duration > 0) {
    // VAPI sometimes emits ms, sometimes seconds. ≥10000 ⇒ ms (3hr cap).
    return Math.round(e.duration >= 10000 ? e.duration / 1000 : e.duration);
  }

  // 2 · explicit duration fields under call
  const c = e.call as Record<string, unknown> | undefined;
  if (c) {
    if (typeof c.durationSeconds === "number" && c.durationSeconds > 0) {
      return Math.round(c.durationSeconds);
    }
    if (typeof c.duration === "number" && c.duration > 0) {
      return Math.round(c.duration >= 10000 ? c.duration / 1000 : c.duration);
    }
    // 2b · compute from call.startedAt / call.endedAt
    if (typeof c.startedAt === "string" && typeof c.endedAt === "string") {
      const delta = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
      if (Number.isFinite(delta) && delta > 0) return Math.round(delta / 1000);
    }
  }

  // 3 · top-level startedAt / endedAt on message (some call-end events)
  if (typeof e.startedAt === "string" && typeof e.endedAt === "string") {
    const delta = new Date(e.endedAt as string).getTime() - new Date(e.startedAt as string).getTime();
    if (Number.isFinite(delta) && delta > 0) return Math.round(delta / 1000);
  }

  return 0;
}

// ─── Ended-reason extraction (defensive · handles VAPI payload shapes) ─────
//
// wave-137-2026-05-29 · the end-of-call-report webhook carries the CLEAN
// ended reason at MESSAGE level (`message.endedReason` — a REQUIRED field on
// VAPI's ServerMessageEndOfCallReport · values like customer-ended-call /
// assistant-forwarded-call / customer-did-not-answer). The nested
// `message.call.endedReason` is a call snapshot that VAPI's docs say lives on
// GET /call/:id — on the webhook it is usually unpopulated (→ null) or,
// mid-call, a transient SIP-layer status (call.in-progress.sip-completed-call).
// Reading only call.endedReason stored null on 274/283 rows + raw SIP codes on
// 9, zero clean labels → the Voice local-fallback breakdown was useless. Same
// wrong-layer class as the wave-fix-2026-05-25 artifact.transcript bug. Prefer
// message-level; accept a call-level value only when it's a clean label (not a
// `call.*` SIP transient).
export function extractEndedReason(event: unknown): string | null {
  const e = event as { endedReason?: unknown; call?: { endedReason?: unknown } } | undefined;
  if (!e) return null;
  const top = typeof e.endedReason === "string" ? e.endedReason.trim() : "";
  if (top) return top;
  const nested = typeof e.call?.endedReason === "string" ? e.call.endedReason.trim() : "";
  // Accept a call-level value when it's a clean label (not a `call.*` SIP
  // transient) OR a TERMINAL warm-transfer / transfer-failed reason. The latter
  // are real ended reasons (the hand-off failed), not transient SIP statuses —
  // they feed the warm-transfer connect-rate's ground-truth "failed" count
  // (lib/warmTransferConnect.ts). Generic call.* SIP transients still drop, so
  // the wave-137 bug this guard fixed stays fixed.
  if (nested && (!nested.startsWith("call.") || /warm-transfer|transfer-failed/.test(nested))) return nested;
  return null;
}

/**
 * wave-144 · True only for VAPI's `assistant-forwarded-call` ended reason —
 * the AI handed the caller off to a human. This is the trigger for the
 * forwarded-call callback safety-net row. Kept deliberately NARROW (matches
 * only "forward") so the common end reasons — customer-ended-call,
 * assistant-ended-call, silence-timed-out, etc. — never drop a row and flood
 * the front-desk queue. Pure + pinned by vapi.forwarded-callback.test.ts.
 */
export function isForwardedEndedReason(endedReason: string | null | undefined): boolean {
  return /forward/i.test(endedReason ?? "");
}

// ─── Tool call dispatcher ──────────────────────────────

interface VapiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string | Record<string, unknown> };
}

async function dispatchToolCall(call: VapiToolCall, phoneCallId?: string): Promise<{
  toolCallId: string;
  result: string;
}> {
  let args: Record<string, unknown> = {};
  try {
    // VAPI sends function.arguments as a JSON STRING on most events but as an
    // already-parsed OBJECT on others. JSON.parse(object) coerces to the string
    // "[object Object]" and throws "is not valid JSON" — which silently killed
    // every custom tool (tireInquiry/bookSlot/lookupCustomer/etc.) and forced
    // the call to forward. Accept both shapes.
    const rawArgs = call.function.arguments;
    if (typeof rawArgs === "string") {
      args = (JSON.parse(rawArgs || "{}") ?? {}) as Record<string, unknown>;
    } else if (rawArgs && typeof rawArgs === "object") {
      args = rawArgs as Record<string, unknown>;
    }
  } catch (err) {
    return {
      toolCallId: call.id,
      result: JSON.stringify({ error: "Invalid arguments JSON", details: err instanceof Error ? err.message : String(err) }),
    };
  }

  // Inject the real VAPI phone-call id so write-tools (bookSlot/tireInquiry/
  // escalate/etc.) can stamp convertedToLead/leadId on vapi_call_logs — the
  // LLM never supplies callId, so without this the conversion attribution is
  // silently dead. Only set when the tool didn't already provide one.
  if (phoneCallId && args.callId == null) args.callId = phoneCallId;

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
      // wave-Y-2026-05-26 · widened to cover VAPI end-of-call-report shapes.
      // Some events nest duration under `call`; some put `durationSeconds`
      // at message-level; some only emit timestamps. The extractor below
      // handles all paths defensively (see extractCallDurationSec).
      call?: {
        id?: string;
        startedAt?: string;
        endedAt?: string;
        duration?: number;
        durationSeconds?: number;
        endedReason?: string;
      };
      startedAt?: string;
      endedAt?: string;
      duration?: number;
      durationSeconds?: number;
      // wave-137 · message-level ended reason · VAPI's
      // ServerMessageEndOfCallReport carries the CLEAN reason here; the nested
      // call.endedReason above is null/SIP-transient on the webhook.
      endedReason?: string;
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
        const settled = await Promise.allSettled(calls.map((c) => dispatchToolCall(c, event.call?.id)));
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
            result: JSON.stringify({ error: "Tool execution failed", details: err }),
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
        // wave-137 · read the CLEAN reason from message-level (see
        // extractEndedReason). call.endedReason is null/SIP-transient on the
        // webhook. Computed once, reused for the row insert + state metadata.
        const cleanEndedReason = extractEndedReason(event);
        log.info("Vapi call ended", {
          callId: event.call?.id,
          reason: cleanEndedReason,
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
            const { vapiCallLogs, callbackRequests } = await import("../../../drizzle/schema");
            const d = await getDb();
            if (d) {
              const summary = (event as { summary?: string; analysis?: { summary?: string } })?.summary
                ?? (event as { summary?: string; analysis?: { summary?: string } })?.analysis?.summary
                ?? null;
              // wave-fix-2026-05-25 (audit #106) · VAPI's end-of-call
              // webhook nests the FULL transcript under event.artifact.
              // transcript · the top-level event.transcript field is
              // populated only for live mid-call chunks. Reading
              // event.transcript only meant service-mention detection
              // ran on empty text for the events that matter most.
              // Same silent-loss class as the earlier 5-day VAPI bug.
              const transcript = (event as { artifact?: { transcript?: string }; transcript?: string }).artifact?.transcript ?? (event as { transcript?: string })?.transcript ?? "";
              // Light heuristic for service mention — extract any mention
              // of common services from transcript or summary.
              const text = (typeof transcript === "string" ? transcript : "")
                + " " + (summary ?? "");
              const services = ["brake", "tire", "oil change", "alignment", "battery", "engine", "transmission", "ac", "exhaust", "diagnostic", "emission"];
              const serviceMention = services.find((s) => text.toLowerCase().includes(s)) ?? null;
              const customer = (event.call as { customer?: { number?: string; name?: string } })?.customer;
              // wave-Y-2026-05-26 · multi-path duration extractor (see top
              // of file). Audit #79 baseline: all 30 today's rows had
              // duration=0 because the prior inline calc only checked one
              // path. Now: try message-level → call-level → timestamp
              // delta · log the event keys on a 0-fallback so we can
              // diagnose the next miss without re-investigating from scratch.
              const durationSec = extractCallDurationSec(event);
              if (durationSec === 0) {
                log.warn("[vapi webhook] duration=0 fallback · payload shape diagnosis", {
                  callId,
                  eventType: event.type,
                  messageKeys: Object.keys(event as object),
                  callKeys: event.call ? Object.keys(event.call as object) : [],
                });
              }
              // firstLog stays true ONLY when this row is newly inserted.
              // The vapi_call_logs UNIQUE(vapiCallId) makes a webhook retry
              // throw dup → firstLog=false → one-time side-effects below
              // (forwarded-call callback) run exactly once per call.
              // 2026-06-20 · derive convertedToLead from the tool-state trail
              // (complete by end-of-call). It was hardcoded 0 with "updated
              // later", but the mid-call tireInquiry/bookSlot UPDATE runs
              // before THIS row exists (0 rows matched), so it stayed 0 for
              // every call — the conversion meter read 0% forever. A capture
              // tool (state 'tool_called') or sendConfirmationSms ('confirmed')
              // means the AI completed a conversion action. Best-effort: any
              // read failure leaves it 0 and the daily eval reconciles. This is
              // a TOOL-ENGAGEMENT signal — distinct from the nightly digest's
              // score>=70 "converted" count; see vapiConversionSignals.ts.
              let convertedToLead = 0;
              try {
                const { getCallStateHistory } = await import("../../services/voice-call-state");
                const { trailReachedTool } = await import("../../services/vapiConversionSignals");
                convertedToLead = trailReachedTool(await getCallStateHistory(String(callId))) ? 1 : 0;
              } catch (stateErr) {
                log.warn("[vapi webhook] convertedToLead trail read failed (default 0; eval reconciles)", { error: stateErr instanceof Error ? stateErr.message : String(stateErr) });
              }
              let firstLog = true;
              await d.insert(vapiCallLogs).values({
                vapiCallId: String(callId),
                phoneNumber: customer?.number ?? null,
                customerName: customer?.name ?? null,
                durationSeconds: durationSec,
                endedReason: cleanEndedReason,
                aiSummary: summary,
                serviceMention,
                convertedToLead,
                transcriptUrl: (event.call as { transcript?: string; transcriptUrl?: string })?.transcriptUrl ?? null,
                recordingUrl: (event.call as { recordingUrl?: string })?.recordingUrl ?? null,
              }).catch((err: unknown) => {
                // Tolerate dup-key on retry — webhooks can fire twice
                firstLog = false;
                const msg = err instanceof Error ? err.message : String(err);
                if (!/Duplicate entry|ER_DUP_ENTRY/i.test(msg)) {
                  log.warn("vapi_call_logs insert failed", { error: msg });
                }
              });

              // wave-144 · forwarded-call safety net. A during-hours
              // transferCall hands the caller to the shop line; if nobody
              // picks up (tech mid-bay), that hot caller is lost with NO
              // follow-up surface — forwards only showed up as a Voice-page
              // chart bar. On the first end-of-call insert only, drop a row
              // into the front-desk callback queue so every forwarded caller
              // is accounted for. This is an INTERNAL queue entry, not an
              // outbound customer message — worst case is a row the operator
              // clears in one tap; the win is no forwarded caller falls
              // through. endedReason "assistant-forwarded-call" → /forward/i.
              // 2026-05-31 · forwarded-call follow-up flipped from an internal
              // callback to-do (it flooded the Today queue with "Call back Voice
              // caller" rows) to a self-serve SMS back to the caller. The caller
              // re-engages on their terms; the operator's callback queue stays clean.
              if (firstLog && isForwardedEndedReason(cleanEndedReason) && customer?.number) {
                const { orchestrateSms } = await import("../../services/smsOrchestrator");
                await orchestrateSms({
                  type: "vapi_forwarded_call_followup",
                  phone: customer.number.trim(),
                }).catch((err: unknown) => {
                  log.warn("[vapi webhook] forwarded-call SMS failed (non-blocking)", {
                    error: err instanceof Error ? err.message : String(err),
                  });
                });
              }
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
              metadata: { reason: cleanEndedReason, eventType: event.type },
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
              // wave-fix-2026-05-25 (audit #106) · same artifact-first
              // fallback as the service-mention path · without this,
              // confirmation-call evaluation runs on empty transcript
              // and undercounts every converted call by ~10 eval-score
              // points.
              const transcriptText = ((event as { artifact?: { transcript?: string }; transcript?: string }).artifact?.transcript ?? (event as { transcript?: string }).transcript ?? "")
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
      // wave-181.x · Tier S · BDI upgrade (declined-recovery opener).
      // VAPI fires `assistant-request` BEFORE the call connects. The
      // response shape is `{ assistantOverrides?: {...} }` which VAPI
      // merges with the assistant's configured fields for THIS call
      // only (no PATCH to the global assistant). The BDI composer
      // (vapi-bdi.ts) looks up the caller AND any unconverted estimate
      // and opens the call with the recovery hook when one is on file.
      // Unknown callers fall through to the default first message ·
      // backward compatible with the wave-181.63 personalization path.
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
          const { buildBdiFirstMessage } = await import(
            "../../services/vapi-bdi"
          );
          const result = await buildBdiFirstMessage(phone);
          log.info("assistant-request bdi", {
            phoneSuffix: phone.replace(/\D/g, "").slice(-4),
            matched: result.matched,
            kind: result.kind,
            reason: result.reason,
          });
          if (result.firstMessage) {
            res.json({
              assistantOverrides: { firstMessage: result.firstMessage },
            });
            return;
          }
        } catch (err) {
          log.warn("assistant-request bdi threw", {
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
