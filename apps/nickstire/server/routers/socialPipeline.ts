/**
 * Social Pipeline Status Router — single-pane admin visibility into every
 * kill-switch, feature flag, and env gate that controls the content/social
 * automation stack. READ-ONLY: surfaces booleans and status strings, NEVER
 * token values or secrets.
 *
 * Why this exists: the social pipeline has 3 layers of independent gating
 * (content generation → reel pipeline → live publishing) spread across both
 * DB flags (featureFlags table) and env vars. Without a unified view, the
 * operator can't tell what's actually armed vs. what's silently disabled.
 *
 * Dependency direction: inward. This module reads from featureFlags service
 * + process.env. It never writes, posts, or mutates.
 */
import { router, adminProcedure } from "../_core/trpc";
import type { FlagKey } from "../services/featureFlags";

/** Env-backed gates for the social pipeline (not in the DB flags table). */
const ENV_GATES = [
  { key: "REEL_GENERATION_ENABLED", description: "FFmpeg reel assembly pipeline (processNextReelJob, processNextAssemblyJob, recoverStuckReelJobs)", defaultOff: true },
  { key: "REEL_PUBLISH_ENABLED", description: "publishToSocial() reel gate — controls whether assembled reels can be posted to IG and (as video) to the Facebook Page", defaultOff: true },
  { key: "REEL_FB_CROSSPOST_ENABLED", description: "Nightly reel cron also hands the reel video to the Facebook Page (Reels Publishing). IG stays the authority; FB failure never retries.", defaultOff: true }, // gitleaks:allow — flag name, not a secret
  { key: "REEL_AUTOPOST_ENABLED", description: "Daily cron (9am ET) auto-posts one pre-made reel from the 26-reel manifest", defaultOff: true },
  { key: "IG_AUTOPOST_DRYRUN", description: "IG autopost dry-run mode — when NOT 'false', posts go to Telegram only (default: dry-run ON)", defaultOff: false },
  { key: "CONTENT_REPLENISH_ENABLED", description: "Content reserve replenishment cron (every 2 hours)", defaultOff: true },
  { key: "SMS_KILL_SWITCH", description: "Blocks Twilio SMS path when 'true' (shop gateway still works). Set 'false' or unset when Twilio is restored.", defaultOff: false },
  { key: "ENABLE_CUSTOMER_CONFIRMATIONS", description: "Customer confirmation SMS/email notifications (dry-run if unset)", defaultOff: true },
  // 2026-07-20 · These two were ARMED IN PRODUCTION and listed NOWHERE.
  //
  // This file's own header promises "single-pane admin visibility into every
  // kill-switch, feature flag, and env gate that controls the content/social
  // automation stack". Both of these were set true in production while absent
  // from ENV_GATES, from SOCIAL_DB_FLAGS, and from the entire client — so an
  // operator reading the panel concluded nothing autonomous was publishing,
  // while an LLM was drafting and posting PUBLIC replies to comments on Nick's
  // reels with no human in the loop (up to 5/run, 15 in the hour after a post).
  //
  // A kill-switch panel that omits a live switch is worse than no panel: it
  // converts "I don't know" into a confident "nothing is running".
  { key: "REEL_COMMENT_RESPONDER_ENABLED", description: "Autonomous IG comment responder — LLM drafts replies to comments on reels", defaultOff: true },
  { key: "REEL_COMMENT_RESPONDER_LIVE", description: "PUBLICLY POSTS those AI-drafted comment replies. With ENABLED, this publishes to IG with no human review.", defaultOff: true },
  // Registered WITH the feature, not after it. This panel's own header promises
  // visibility into every gate controlling the content stack, and the two
  // entries above are here because they were live in prod while listed nowhere.
  //
  // NOTE FOR THE NEXT FLAG ADDED HERE: gitleaks' generic-api-key rule matches
  // `key: "SOME_NAME"` and the secret-scan gate scans only the PR's ADDED lines
  // — so every pre-existing entry is invisible to it and yours will be the one
  // that trips. These are feature-flag NAMES, already rendered in the admin
  // panel, never credentials. Annotate the line as below rather than renaming
  // the flag or weakening the gate.
  { key: "MP4_INGEST_ENABLED", description: "Ingest a FINISHED mp4 (MoneyPrinter, hand-edited cut) into content inventory as a review_ready draft. Creates the reel_jobs row the publish gate needs; still subject to every approval/publish gate.", defaultOff: true }, // gitleaks:allow — flag name, not a secret
  // 2026-08-20 · Higgsfield stock-fallback remediation. This flag USED TO gate
  // rendering the rest of a reel on the free ffmpeg lane instead of failing
  // the job when the paid provider was unusable. That silent-substitution
  // branch is deleted from reelPipeline.ts (a terminal paid-provider failure
  // now routes to needs_regen, never to stock footage) — this env var is
  // read nowhere in the codebase and is now INERT regardless of its value.
  // Left registered, not removed: a live-looking entry describing dead
  // behavior is exactly the panel-accuracy failure this file's own header
  // (2026-07-20 note above) already documents happening once before.
  { key: "REEL_FALLBACK_TO_TEMPLATE_STOCK", description: "DEFUNCT as of 2026-08-20 — read nowhere in the codebase, changing it does nothing. Formerly gated rendering the rest of a reel on the free local ffmpeg lane instead of failing when the paid provider was unusable; that silent stock-substitution path was deleted (a terminal paid-provider failure now routes to needs_regen, never to stock footage). Kept here, not removed, so a stale value in prod env doesn't read as a live gate.", defaultOff: true }, // gitleaks:allow — flag name, not a secret
] as const;

/** DB feature flags relevant to the social/content pipeline. */
const SOCIAL_DB_FLAGS: FlagKey[] = [
  "legacy_autopost_live",
  "gbp_auto_posting",
  "sms_review_requests",
  "sms_retention_sequences",
  "sms_appointment_reminders",
  "smart_sms_auto_reply",
  "nickgpt_low_risk_autosend_enabled",
  "drip_campaigns_enabled",
  "drop_off_sms_flow",
  "predictive_maintenance_alerts",
  "sms_cross_sell_outreach",
  "live_telegram_feed",
  "daily_wins_digest",
  "weather_triggered_sms",
  "photo_assess_enabled",
  "outbound_voicemail_enabled",
  "nickgpt_drafter_enabled",
  "safety_monitor_enabled",
];

export const socialPipelineRouter = router({
  /**
   * Unified status read-out: every env gate + every social DB flag in one call.
   * The admin UI can render a single "Social Pipeline Health" card from this.
   */
  status: adminProcedure.query(async () => {
    const { isEnabled } = await import("../services/featureFlags");

    // ─── Env-backed gates ─────────────────────────────
    const envGates = ENV_GATES.map((gate) => {
      const raw = process.env[gate.key];
      let armed: boolean;

      if (gate.key === "IG_AUTOPOST_DRYRUN") {
        // Inverted logic: dry-run is ON unless explicitly "false"
        armed = raw === "false"; // armed = live posting enabled
      } else if (gate.key === "SMS_KILL_SWITCH") {
        // Inverted: "true" = Twilio blocked
        armed = raw !== "true"; // armed = Twilio path open
      } else {
        armed = raw === "true";
      }

      return {
        key: gate.key,
        armed,
        raw: raw ?? "(unset)",
        description: gate.description,
        source: "env" as const,
      };
    });

    // ─── DB-backed flags ──────────────────────────────
    const dbFlags = await Promise.all(
      SOCIAL_DB_FLAGS.map(async (key) => {
        const armed = await isEnabled(key);
        return { key, armed, source: "db" as const };
      }),
    );

    // ─── Composite readiness checks ───────────────────
    const igLivePosting = envGates.find((g) => g.key === "IG_AUTOPOST_DRYRUN")!.armed
      && dbFlags.find((f) => f.key === "legacy_autopost_live")!.armed;

    const reelPipeline = envGates.find((g) => g.key === "REEL_GENERATION_ENABLED")!.armed;
    const reelPublish = envGates.find((g) => g.key === "REEL_PUBLISH_ENABLED")!.armed;
    const reelAutopost = envGates.find((g) => g.key === "REEL_AUTOPOST_ENABLED")!.armed;
    const gbpPosting = dbFlags.find((f) => f.key === "gbp_auto_posting")!.armed;
    const smsPath = envGates.find((g) => g.key === "SMS_KILL_SWITCH")!.armed;

    return {
      envGates,
      dbFlags,
      readiness: {
        igLivePosting,
        reelPipeline,
        reelPublish,
        reelAutopost,
        gbpPosting,
        smsPathOpen: smsPath,
        fullReelPipeline: reelPipeline && reelPublish && reelAutopost,
      },
      timestamp: new Date().toISOString(),
    };
  }),
});
