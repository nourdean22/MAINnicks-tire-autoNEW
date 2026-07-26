/**
 * Photo-Assess Pipeline · MMS → Vision → SMS Reply
 *
 * Wave AZ · the orchestrator that ties together:
 *   1. Vision analysis (vision-analyzer.ts · Cat 4 HF strategy)
 *   2. Reply drafting (optionally via nickgpt-client.ts · Wave AE)
 *   3. SMS delivery (sms.ts sendSms() with { via: "shop" } · F25e)
 *   4. Persistence (sms_messages + communication_log)
 *
 * Call sites · Twilio MMS webhook + Capevace gateway attachments
 * webhook + the manual /api/photo-assess admin route. Each call site
 * passes { phone, photoUrl, source } · this orchestrator handles the
 * full flow + ack semantics.
 *
 * Compliance · same TCPA + opt-out + sending-hours discipline as any
 * outbound SMS. sendSms() handles all of those; this orchestrator
 * doesn't have to re-implement them.
 */

import { createLogger } from "../lib/logger";
import { analyzePhoto } from "./vision-analyzer";
import { sendSms } from "../sms";

const log = createLogger("photo-assess-pipeline");

export interface PhotoAssessRequest {
  /** Customer phone · will be normalized by sendSms */
  phone: string;
  /** Public HTTPS URL of the photo */
  photoUrl: string;
  /** Source tag for logging · "twilio_mms" | "shop_gateway_mms" | "manual_admin" */
  source: "twilio_mms" | "shop_gateway_mms" | "manual_admin";
  /** Optional override for the SMS reply (skip auto-draft, use this) */
  smsReplyOverride?: string;
  /** Optional · only run analysis, don't send SMS (for /api/photo-assess preview) */
  skipSmsSend?: boolean;
}

export interface PhotoAssessOutcome {
  ok: boolean;
  description?: string;
  serviceSuggest?: string;
  urgency?: string;
  smsSent: boolean;
  smsError?: string;
  visionLatencyMs?: number;
  /** Always populated if vision ran · for audit trail */
  visionSource?: "replicate" | "hf";
  error?: string;
}

const MAX_REPLY_CHARS = 300;

/**
 * Default reply templates by service suggestion. Used when NickGPT is
 * unavailable OR the operator prefers deterministic replies. Each ends
 * with the canonical "no charge until you say yes" message + shop
 * number.
 */
const DEFAULT_REPLIES: Record<string, string> = {
  // A photo can show what something LOOKS like. It cannot establish
  // repairability, remaining tread, stock, or how long a job takes — so each
  // reply separates what is visible from what is still uncertain, then gives the
  // easiest way to close that gap. The retired copy asserted all four:
  // "the tire needs replacement" (a remote verdict), "we have your size in stock
  // most days" (a live-inventory claim this path bypassed CLAIM_STOCK to make),
  // "we can patch that if it's in the tread" (remote repairability),
  // "usually 20 min" and "free 15-min inspection" (completion promises backed by
  // no approved fact). photoReplyViolations() below now makes drift structurally
  // detectable instead of relying on review.
  //
  // "free check" is the required phrasing, not "free inspection": customers say
  // check, and the send-preflight rule for the word "free" matches that literal.
  "tire-replacement":
    "Got the photo · there's real wear showing, but how much tread is left needs measuring in person. Bring it by for a free check and we'll tell you where it stands before anything is charged. (216) 862-0005.",
  "tire-repair":
    "Got the photo · whether it can be patched depends on exactly where the puncture sits and what it looks like inside the tire. Bring it by for a free check — no charge if it turns out we can't repair it. (216) 862-0005.",
  "brake-service":
    "Saw the brake photo · pad thickness and rotor condition need measuring in person before any pricing. Free check, written price before any paid work. (216) 862-0005.",
  "inspection-needed":
    "Thanks for the photo · a photo can't settle this one. Bring it by for a free check and we'll give you a real answer and a written price. (216) 862-0005.",
  unclear:
    "Got the photo, but it's hard to tell from this angle. Send one wider shot showing the whole area, or bring it by for a free check. (216) 862-0005.",
};

/**
 * The claims a photo reply must never make, enforced with the SAME regexes the
 * SMS reply planner uses. This path builds its copy from hardcoded strings rather
 * than through buildReplyPlan, so without this it silently sits outside every
 * prohibition the planner enforces — which is exactly how a live-inventory claim
 * and two completion promises survived here after being removed elsewhere.
 *
 * Exported so the tests can assert every template, including future ones.
 */
export function photoReplyViolations(reply: string): string[] {
  const found: string[] = [];
  // Remote verdicts a photo cannot support.
  // `replac\w*` on purpose: a trailing \b after "replac" cannot match inside
  // "replacement", which silently let the exact retired sentence through.
  if (/\b(needs? (to be )?replac\w*|has to be replaced|is (shot|toast|unsafe|bad))\b/i.test(reply)) {
    found.push("remote_replacement_verdict");
  }
  if (/\b(we can (patch|repair|fix) (that|it|this)|is (patchable|repairable)|that'?s (patchable|repairable))\b/i.test(reply)) {
    found.push("remote_repairability_verdict");
  }
  // Inventory and timing this path has no source for.
  if (/\b(in stock|we (have|got) your size|have (it|them|that size))\b/i.test(reply)) {
    found.push("inventory_claim");
  }
  if (/\b(usually|about|around|takes?|in) ?~?\d+ ?(min|minute|hour|hr)\b/i.test(reply)) {
    found.push("completion_time_promise");
  }
  // ROS-058 preflight rule: "free" copy must carry the literal "free check".
  if (/\bfree\b/i.test(reply) && !/\bfree (quick )?check\b/i.test(reply)) {
    found.push("free_without_free_check");
  }
  return found;
}

/**
 * Test-only view of the template table, so the claim tests cover EVERY reply —
 * including ones added later — instead of a hand-copied subset that silently
 * drifts out of date.
 */
export const DEFAULT_REPLIES_FOR_TEST: Readonly<Record<string, string>> = DEFAULT_REPLIES;

function pickDefaultReply(serviceSuggest?: string): string {
  if (serviceSuggest && DEFAULT_REPLIES[serviceSuggest]) {
    return DEFAULT_REPLIES[serviceSuggest];
  }
  return DEFAULT_REPLIES.unclear;
}

/**
 * Run the photo-assess pipeline. The caller should not block on this
 * for webhook ack purposes · use `void runPhotoAssess(...)` from the
 * webhook handler and ack immediately.
 */
export async function runPhotoAssess(req: PhotoAssessRequest): Promise<PhotoAssessOutcome> {
  log.info("photo_assess_start", {
    source: req.source,
    phone: req.phone.slice(-4),
    photoHost: safeHostname(req.photoUrl),
  });

  // Step 1 · Vision analysis
  const vision = await analyzePhoto({ photoUrl: req.photoUrl });
  if (!vision.ok) {
    log.warn("photo_assess_vision_failed", {
      reason: vision.reason,
      error: vision.error,
      source: req.source,
    });
    return {
      ok: false,
      smsSent: false,
      error: `vision: ${vision.error}`,
    };
  }

  log.info("photo_assess_vision_ok", {
    source: req.source,
    serviceSuggest: vision.serviceSuggest,
    urgency: vision.urgency,
    latencyMs: vision.latencyMs,
    visionSource: vision.source,
  });

  // Step 2 · Decide reply text
  let replyText = req.smsReplyOverride ?? pickDefaultReply(vision.serviceSuggest);
  // Optionally route through NickGPT (Wave AE) for voice fidelity ·
  // gated on `nickgpt_drafter_enabled` · falls back to template silently
  try {
    const { draftSmsReply } = await import("./nickgpt-client");
    const draft = await draftSmsReply({
      inboundMessage: `Customer sent a photo. Mechanic analysis: ${vision.description}`,
    });
    if (draft.ok && draft.draft && draft.source === "nickgpt-ollama") {
      // Only adopt the NickGPT draft if it came from the fine-tuned model.
      // Fallback Claude drafts are usable but the template is shorter +
      // operator-pre-vetted for SMS · prefer template unless we have
      // operator-voice signal.
      replyText = draft.draft.slice(0, MAX_REPLY_CHARS);
    }
  } catch (err) {
    log.warn("nickgpt draft skipped", { error: err instanceof Error ? err.message : String(err) });
  }

  // Truncate to SMS-sane length
  if (replyText.length > MAX_REPLY_CHARS) {
    replyText = replyText.slice(0, MAX_REPLY_CHARS - 3) + "...";
  }

  // Step 3 · Send SMS (unless skipping for preview)
  if (req.skipSmsSend) {
    return {
      ok: true,
      description: vision.description,
      serviceSuggest: vision.serviceSuggest,
      urgency: vision.urgency,
      smsSent: false,
      visionLatencyMs: vision.latencyMs,
      visionSource: vision.source,
    };
  }

  try {
    const { orchestrateSms } = await import("./smsOrchestrator");
    const orchResult = await orchestrateSms({
      type: "photo_assess_reply",
      phone: req.phone,
      replyText: replyText,
    });

    // ACCEPTED, not delivered. `queued` means the send layer took ownership
    // (quiet hours, gateway offline, rate cap) — the customer has NOT received
    // anything yet, and the drain still has to succeed. Collapsing the two into
    // one boolean is how a queued reply reads as an answered customer on a
    // dashboard; keep the distinction and report it (ROS-021's lesson: a message
    // that never reached a customer must leave a trace).
    const accepted = orchResult.status === "sent" || orchResult.status === "queued";
    const deliveredNow = orchResult.status === "sent";
    if (accepted && !deliveredNow) {
      log.info("photo_assess_sms_queued_not_delivered", {
        source: req.source,
        status: orchResult.status,
        reason: orchResult.reason,
      });
    }
    const success = accepted;
    if (!success) {
      log.warn("photo_assess_sms_failed", {
        source: req.source,
        error: orchResult.reason,
      });
      return {
        ok: false,
        description: vision.description,
        serviceSuggest: vision.serviceSuggest,
        urgency: vision.urgency,
        smsSent: false,
        smsError: orchResult.reason,
        visionLatencyMs: vision.latencyMs,
        visionSource: vision.source,
      };
    }

    log.info("photo_assess_sms_ok", {
      source: req.source,
      phone: req.phone.slice(-4),
    });
  } catch (err) {
    return {
      ok: false,
      description: vision.description,
      serviceSuggest: vision.serviceSuggest,
      urgency: vision.urgency,
      smsSent: false,
      smsError: err instanceof Error ? err.message : String(err),
      visionLatencyMs: vision.latencyMs,
      visionSource: vision.source,
    };
  }

  return {
    ok: true,
    description: vision.description,
    serviceSuggest: vision.serviceSuggest,
    urgency: vision.urgency,
    smsSent: true,
    visionLatencyMs: vision.latencyMs,
    visionSource: vision.source,
  };
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return "(invalid)";
  }
}
