/**
 * AgentPhone webhook · wave-181.84 · /api/webhooks/agentphone
 *
 * Receives call.ended events from AgentPhone for the confirmation bot.
 * Updates confirmation_calls row · parses transcript for confirmation/
 * reschedule/no-answer state · surfaces to admin via the cron tile.
 *
 * Security · AgentPhone webhooks include a signature header (`secret`
 * field from the webhook setup) using HMAC-SHA256. We verify against
 * AGENTPHONE_WEBHOOK_SECRET env var. In production · refuse to process
 * if the secret is unset (per wave-141b pattern from F25e gateway).
 */
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { createLogger } from "../../lib/logger";

const log = createLogger("agentphone-webhook");
const router = Router();

interface AgentPhoneEvent {
  event?: string;
  data?: {
    id?: string;
    status?: string;
    endedAt?: string;
    durationSeconds?: number;
    transcripts?: Array<{ transcript: string; response: string | null }>;
  };
}

function verifySignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const bodyStr = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secret).update(bodyStr).digest("hex");
  // Strip optional "sha256=" prefix
  const provided = signature.replace(/^sha256=/, "").trim();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Inspect a transcript and infer the customer's intent:
 *   - confirmed · they said yes / "I'll be there" / "yep" / "still on"
 *   - rescheduled · they asked to move it / "can we do Tuesday"
 *   - no_answer · voicemail markers OR very short transcript with no
 *     customer turn
 *
 * Returns the inferred status + any reschedule request text. Operator
 * still sees the full transcript in the admin tile to override if the
 * classifier is wrong.
 */
function classifyTranscript(transcripts: Array<{ transcript: string; response: string | null }> | undefined): {
  status: "confirmed" | "rescheduled" | "no_answer";
  rescheduleRequest: string | null;
  snippet: string;
} {
  if (!transcripts || transcripts.length === 0) {
    return { status: "no_answer", rescheduleRequest: null, snippet: "" };
  }
  const full = transcripts
    .map((t) => `${t.transcript}${t.response ? " | " + t.response : ""}`)
    .join("\n")
    .toLowerCase();
  const snippet = full.slice(0, 500);

  // Voicemail markers · stronger signal than transcript brevity
  if (/leave (a |your )?(message|voicemail)|after the (beep|tone)/i.test(full)) {
    return { status: "no_answer", rescheduleRequest: null, snippet };
  }

  // Reschedule signals
  if (/\b(reschedule|move it|change the time|different day|can we do|push it|next week|day after|earlier|later in the day)\b/i.test(full)) {
    // Grab the sentence containing the reschedule keyword
    const sentences = full.split(/[.!?]/);
    const reschedSentence = sentences.find((s) => /\b(reschedule|move|change|different day|push|earlier|later)\b/i.test(s));
    return {
      status: "rescheduled",
      rescheduleRequest: (reschedSentence || "").trim().slice(0, 200),
      snippet,
    };
  }

  // Confirmation signals
  if (/\b(yes|yeah|yep|confirm|still on|see you|i.?ll be there|sounds good|works for me|all set)\b/i.test(full)) {
    return { status: "confirmed", rescheduleRequest: null, snippet };
  }

  // Default · ambiguous · treat as confirmed (assume customer didn't object)
  return { status: "confirmed", rescheduleRequest: null, snippet };
}

router.post("/agentphone", async (req: Request, res: Response) => {
  const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  if (secret) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const sig = req.header("X-AgentPhone-Signature") || req.header("X-Signature");
    if (!rawBody || !verifySignature(rawBody, sig ?? undefined, secret)) {
      log.warn("[agentphone-webhook] rejected · bad or missing signature");
      res.status(401).json({ error: "invalid_signature" });
      return;
    }
  } else if (process.env.NODE_ENV === "production") {
    log.error("[agentphone-webhook] AGENTPHONE_WEBHOOK_SECRET unset in production · rejecting");
    res.status(500).json({ error: "webhook_misconfigured" });
    return;
  } else {
    log.warn("[agentphone-webhook] AGENTPHONE_WEBHOOK_SECRET unset · accepting unsigned (non-prod)");
  }

  const event = req.body as AgentPhoneEvent;
  const eventType = event.event || "";
  const callId = event.data?.id || "";

  log.info("agentphone_event", { event: eventType, callId: callId.slice(0, 16) });

  if (eventType !== "call.ended") {
    // Only care about call-end events for the confirmation flow.
    res.status(200).json({ received: true, ignored_event: eventType });
    return;
  }

  if (!callId) {
    res.status(400).json({ error: "missing call id" });
    return;
  }

  try {
    const { getDb } = await import("../../db");
    const { confirmationCalls } = await import("../../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) {
      res.status(503).json({ error: "db_unavailable" });
      return;
    }

    // Find the confirmation_calls row by AgentPhone call id
    const [row] = await db
      .select()
      .from(confirmationCalls)
      .where(eq(confirmationCalls.agentphoneCallId, callId))
      .limit(1);

    if (!row) {
      log.warn(`[agentphone-webhook] no confirmation_calls row found for callId=${callId.slice(0, 16)}`);
      // Still 200 · AgentPhone will keep retrying otherwise
      res.status(200).json({ received: true, no_match: true });
      return;
    }

    const classification = classifyTranscript(event.data?.transcripts);
    await db
      .update(confirmationCalls)
      .set({
        status: classification.status,
        transcriptSnippet: classification.snippet,
        rescheduleRequest: classification.rescheduleRequest,
        completedAt: new Date(),
      })
      .where(eq(confirmationCalls.id, row.id));

    log.info(`[agentphone-webhook] confirmation_calls #${row.id} → ${classification.status}`, {
      callId: callId.slice(0, 16),
      hasReschedule: !!classification.rescheduleRequest,
    });

    res.status(200).json({ received: true, status: classification.status });
  } catch (err) {
    log.warn("[agentphone-webhook] processing failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    // Return 500 so AgentPhone retries
    res.status(500).json({ error: "processing_failed" });
  }
});

export { router as agentphoneWebhookRouter };
