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
  "tire-replacement":
    "Got the photo · looks like the tire needs replacement. We have your size in stock most days. No charge to look. Call/text (216) 862-0005 when you're ready.",
  "tire-repair":
    "Got the photo · we can patch that if it's in the tread. Bring it by — usually 20 min. No charge if it's not patchable. (216) 862-0005.",
  "brake-service":
    "Saw the brake photo · we'd want to check pad thickness + rotor condition in-person before pricing. Free inspection. (216) 862-0005.",
  "inspection-needed":
    "Thanks for the photo · we'd want eyes on it to give you a real answer. Free 15-min inspection. (216) 862-0005.",
  unclear:
    "Got the photo. Hard to tell from one angle — could you swing by for a free look? (216) 862-0005.",
};

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

    const success = orchResult.status === "sent" || orchResult.status === "queued";
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
