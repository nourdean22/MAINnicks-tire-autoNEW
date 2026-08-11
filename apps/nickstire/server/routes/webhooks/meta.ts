/**
 * Meta / Instagram webhook — comment notifications.
 *
 * WHY THIS EXISTS: the comment responder (services/commentResponder.ts) already
 * works, but it is CRON-DRIVEN — it discovers a new comment only on the next
 * pulse. First-hour comment velocity is a Reels ranking signal and Meta made
 * two-way conversation a ranked signal in 2026, so reply LATENCY is the thing
 * being bought here. This endpoint does not add a capability; it removes a wait.
 *
 * DELIBERATELY NOT A SECOND REPLY ENGINE. The handler's entire job is to say
 * "something happened, run the responder now". All policy — the
 * REEL_COMMENT_RESPONDER_ENABLED gate, the REEL_COMMENT_RESPONDER_LIVE dry-run
 * gate, the @shared/reviewReplyQa claim-safety detector, the watermark dedup and
 * the per-run velocity cap — stays in runReelCommentResponder() where it is
 * already tested. A webhook that drafted its own replies would fork that policy
 * and the two copies would drift.
 *
 * Endpoints (mounted at /api/webhooks by _core/index.ts):
 *   GET  /api/webhooks/instagram — Meta's subscription verification challenge
 *   POST /api/webhooks/instagram — comment change notifications
 *
 * Signature: Meta signs the request with HMAC-SHA256 over the EXACT raw bytes,
 * keyed by the app secret, in `X-Hub-Signature-256: sha256=<hex>`. We verify
 * against `req.rawBody` (captured by the express.json verify hook in
 * _core/index.ts) — re-serializing req.body would change the bytes and every
 * signature would fail.
 *
 * Credentials already provisioned in Railway: FB_VERIFY_TOKEN, FB_APP_SECRET.
 *
 * INERT UNTIL SUBSCRIBED: Meta sends nothing until the operator adds this
 * callback URL and subscribes the `comments` field in the app dashboard.
 * Deploying this file alone changes no behavior.
 *
 * Docs: https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */

import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { createLogger } from "../../lib/logger";

const log = createLogger("meta-webhook");
const router = Router();

/**
 * Collapse a burst of comments into one responder run. A popular reel can fire
 * dozens of notifications in a few seconds; without this each one would start
 * its own Graph fetch + LLM pass over the same comment set.
 */
const DEBOUNCE_MS = Number(process.env.IG_WEBHOOK_DEBOUNCE_MS) || 15_000;

let pendingTimer: NodeJS.Timeout | null = null;
let inFlight = false;
/** A notification arrived mid-run — its comment is newer than the set being scanned. */
let rerunRequested = false;

/**
 * Verify Meta's X-Hub-Signature-256 over the raw request bytes.
 * Exported for tests. Returns false on any malformed input rather than throwing —
 * a bad signature and a garbage header are the same answer to the caller.
 */
export function verifyMetaSignature(
  rawBody: Buffer | string | undefined,
  header: string | undefined,
  secret: string,
): boolean {
  if (!rawBody || !header || !secret) return false;
  const [algo, provided] = header.split("=");
  if (algo !== "sha256" || !provided) return false;

  const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  // Constant-time compare. Buffer.from(hex) silently truncates on odd-length or
  // non-hex input, so compare lengths first — otherwise a short forged header
  // would compare equal against a truncated digest.
  if (provided.length !== computed.length) return false;
  const a = Buffer.from(provided, "hex");
  const b = Buffer.from(computed, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Meta webhook payload — only the shape we consume. */
type MetaWebhookBody = {
  object?: string;
  entry?: Array<{ id?: string; time?: number; changes?: Array<{ field?: string; value?: unknown }> }>;
};

/**
 * True when the payload contains at least one Instagram `comments` change.
 * Exported for tests. Meta multiplexes many fields (mentions, story_insights,
 * messages) onto one callback URL, so most deliveries are not ours.
 */
export function hasCommentChange(body: MetaWebhookBody | undefined): boolean {
  if (!body || body.object !== "instagram" || !Array.isArray(body.entry)) return false;
  return body.entry.some((e) => Array.isArray(e?.changes) && e.changes.some((c) => c?.field === "comments"));
}

async function runResponderNow(reason: string): Promise<void> {
  if (inFlight) {
    // Don't queue a second concurrent pass over the same reels — just remember
    // that the set changed and re-arm once this run finishes.
    rerunRequested = true;
    return;
  }
  inFlight = true;
  try {
    const { runReelCommentResponder } = await import("../../services/commentResponder");
    const result = await runReelCommentResponder();
    log.info("webhook-triggered comment responder finished", { reason, details: result.details });
  } catch (err) {
    // Never rethrow: this runs detached from the HTTP response, and an unhandled
    // rejection here would take the process down. Meta already got its 200.
    log.error("webhook-triggered comment responder failed", {
      reason,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    inFlight = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleResponderRun("rerun-after-inflight");
    }
  }
}

function scheduleResponderRun(reason: string): void {
  if (pendingTimer) return; // already debouncing — this burst is accounted for
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void runResponderNow(reason);
  }, DEBOUNCE_MS);
  // Don't hold the event loop open on shutdown.
  if (typeof pendingTimer.unref === "function") pendingTimer.unref();
}

/** Test seam: drop any armed timer so a suite doesn't leak state between cases. */
export function __resetWebhookStateForTests(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  inFlight = false;
  rerunRequested = false;
}

// ─── Subscription verification (GET) ──────────────────
// Meta calls this once when the callback URL is saved, and re-verifies
// periodically. Echo hub.challenge VERBATIM as text/plain or the subscription
// is rejected.
router.get("/instagram", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  const expected = process.env.FB_VERIFY_TOKEN;

  if (!expected) {
    log.error("verification attempted but FB_VERIFY_TOKEN is not set");
    res.sendStatus(500);
    return;
  }

  if (mode === "subscribe" && typeof token === "string" && typeof challenge === "string") {
    const provided = Buffer.from(token);
    const wanted = Buffer.from(expected);
    const ok = provided.length === wanted.length && crypto.timingSafeEqual(provided, wanted);
    if (ok) {
      log.info("webhook subscription verified");
      res.type("text/plain").send(challenge);
      return;
    }
  }

  log.warn("webhook verification rejected", { mode: typeof mode === "string" ? mode : null });
  res.sendStatus(403);
});

// ─── Comment notifications (POST) ─────────────────────
router.post("/instagram", (req: Request, res: Response) => {
  const secret = process.env.FB_APP_SECRET;
  if (!secret) {
    // Fail CLOSED. An unsigned-but-accepted webhook would let anyone on the
    // internet drive the reply engine.
    log.error("rejecting webhook: FB_APP_SECRET is not set");
    res.sendStatus(500);
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.get("x-hub-signature-256");
  if (!verifyMetaSignature(rawBody, signature, secret)) {
    log.warn("rejecting webhook: bad or missing signature", { hasRawBody: !!rawBody, hasSignature: !!signature });
    res.sendStatus(403);
    return;
  }

  // ACK FIRST, WORK AFTER. Meta expects a 200 within seconds and retries (then
  // disables the subscription) on timeouts. The responder does Graph calls and
  // an LLM pass — far too slow to hold the response open for.
  res.sendStatus(200);

  if (!hasCommentChange(req.body as MetaWebhookBody)) return;

  // Respect the same arming gate the cron uses. Without this, subscribing the
  // field in the Meta dashboard would silently switch the responder on — the
  // flag would say "off" while replies posted.
  if (process.env.REEL_COMMENT_RESPONDER_ENABLED !== "true") {
    log.info("comment change received but REEL_COMMENT_RESPONDER_ENABLED is not true — ignoring");
    return;
  }

  scheduleResponderRun("ig-comment-webhook");
});

export const metaWebhookRouter = router;
