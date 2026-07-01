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
  { key: "REEL_PUBLISH_ENABLED", description: "publishToSocial() reel gate — controls whether assembled reels can be posted to IG", defaultOff: true },
  { key: "REEL_AUTOPOST_ENABLED", description: "Daily cron (9am ET) auto-posts one pre-made reel from the 26-reel manifest", defaultOff: true },
  { key: "IG_AUTOPOST_DRYRUN", description: "IG autopost dry-run mode — when NOT 'false', posts go to Telegram only (default: dry-run ON)", defaultOff: false },
  { key: "SOCIAL_INVENTORY_PUBLISH_ENABLED", description: "Social content inventory publisher cron (every 5 min)", defaultOff: true },
  { key: "CONTENT_REPLENISH_ENABLED", description: "Content reserve replenishment cron (every 2 hours)", defaultOff: true },
  { key: "SMS_KILL_SWITCH", description: "Blocks Twilio SMS path when 'true' (shop gateway still works). Set 'false' or unset when Twilio is restored.", defaultOff: false },
  { key: "ENABLE_CUSTOMER_CONFIRMATIONS", description: "Customer confirmation SMS/email notifications (dry-run if unset)", defaultOff: true },
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
