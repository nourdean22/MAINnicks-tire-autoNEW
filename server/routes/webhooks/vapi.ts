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
 * SECURITY: Vapi signs each request with `x-vapi-signature` (HMAC-SHA256
 * over the body using VAPI_WEBHOOK_SECRET). We validate signature in
 * production. In dev, we skip + log a warning.
 */

import { Router, type Request, type Response } from "express";
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
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
  // Allow unsigned in dev
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      log.warn("VAPI_WEBHOOK_SECRET not configured — rejecting request in prod");
      return false;
    }
    return true;
  }
  const signature = req.headers["x-vapi-signature"];
  if (!signature || typeof signature !== "string") return false;
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  // Constant-time compare
  try {
    const expBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(signature);
    if (expBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expBuf, sigBuf);
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
    const caller = voiceAgentRouter.createCaller({ user: null } as never);
    let output: unknown;

    switch (call.function.name) {
      case "shopInfo":
        output = await caller.shopInfo();
        break;
      case "capacityCheck":
        output = await caller.capacityCheck(args as { day?: string });
        break;
      case "quoteRange":
        output = await caller.quoteRange(args as { service: string; vehicleYear?: number; vehicleMake?: string });
        break;
      case "bookSlot":
        output = await caller.bookSlot(args as { name: string; phone: string; service: string; vehicle?: string; preferredDay?: string; callId?: string });
        break;
      case "escalate":
        output = await caller.escalate(args as { name: string; phone: string; reason: string; urgency?: "low" | "medium" | "high"; callId?: string });
        break;
      case "sendConfirmationSms":
        output = await caller.sendConfirmationSms(args as { phone: string; summary: string; mapLink?: string });
        break;
      default:
        output = { error: `Unknown tool: ${call.function.name}` };
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
        // Multiple tool calls arrive in one webhook. Run in parallel.
        const calls = event.toolCalls || [];
        const results = await Promise.all(calls.map(dispatchToolCall));
        res.json({ results });
        return;
      }

      case "status-update":
      case "call-start": {
        log.info("Vapi call started", { callId: event.call?.id });
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
        // Future: write call transcript + outcome to DB for admin review
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
