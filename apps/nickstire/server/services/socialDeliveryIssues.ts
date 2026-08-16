/**
 * Delivery-issue engine — the Ads-Manager idea worth stealing: "created" and
 * "delivering" are different states, and every blocker names the CONSTRAINED
 * LAYER plus the smallest safe next action. "Post failed" teaches nothing;
 * "blocked at asset hosting — set S3_BUCKET" is an instruction.
 *
 * Shape rules (learned the hard way across this repo):
 *  - The deriver is PURE. All reads live in the gatherer, so the rules are
 *    testable without mocking half the server.
 *  - Unknown is never zero. A fact we could not read arrives as null and
 *    produces its own WARNING — "we could not look" must not render as calm.
 *  - An intentional stop (kill switch ON) is an INFO-level control state, not
 *    a defect. Painting deliberate stops red trains the operator to ignore red.
 */
import { createLogger } from "../lib/logger";
import { durableStorageConfigured, ephemeralStorageOverride, servesPermanentUrls } from "../storage";

const log = createLogger("services:social-delivery-issues");

export type DeliveryIssueSeverity = "blocker" | "warning" | "info";
export type DeliveryIssueLayer =
  | "asset_hosting"
  | "meta_connection"
  | "kill_switch"
  | "publish_gate"
  | "reconciliation"
  | "generation";

export interface SocialDeliveryIssue {
  /** Stable key — UIs route and dedupe on this, so renaming one is a breaking change. */
  key: string;
  layer: DeliveryIssueLayer;
  severity: DeliveryIssueSeverity;
  /** One honest sentence: what is true. */
  reason: string;
  /** What we actually read to conclude that. */
  evidence: string;
  /** Smallest safe next action, in the operator's hands. */
  nextAction: string;
}

export interface DeliveryFacts {
  storageConfigured: boolean;
  permanentUrls: boolean;
  /** Explicit opt-in to ephemeral output — generation PROCEEDS without a bucket. */
  ephemeralOverride: boolean;
  metaConfigured: boolean;
  /** null = we could not ASK Meta (transport), which is not "rejected". */
  metaLive: boolean | null;
  metaLiveError: string | null;
  generatorProvider: string;
  generatorConfigured: boolean;
  generationEnabled: boolean;
  /** As enforced at the choke point (env read), not as displayed anywhere else. */
  reelPublishArmed: boolean;
  /** null = kill-switch state unreadable — automated actors fail CLOSED in that state. */
  controls: {
    globalKillSwitch: boolean;
    publishingKillSwitch: boolean;
    generationKillSwitch: boolean;
  } | null;
  controlsSource: string | null;
  /** null = count query failed (unknown, never zero). */
  publishAmbiguousReelJobs: number | null;
  jobsNeedingAttention: number | null;
}

const SEVERITY_ORDER: Record<DeliveryIssueSeverity, number> = { blocker: 0, warning: 1, info: 2 };

export function deriveDeliveryIssues(f: DeliveryFacts): SocialDeliveryIssue[] {
  const issues: SocialDeliveryIssue[] = [];

  if (!f.storageConfigured && f.ephemeralOverride) {
    // Not a blocker: assertDurableStorageForGeneration has TWO passing
    // conditions and this is the second one, so generation is running. It is
    // still LOSING files on every restart, which is a warning, not calm.
    issues.push({
      key: "storage_ephemeral_by_override",
      layer: "asset_hosting",
      severity: "warning",
      reason: "Generation is running WITHOUT durable storage by explicit opt-in — every generated file is lost on the next deploy or restart.",
      evidence: "S3_BUCKET unset and REEL_ALLOW_EPHEMERAL_STORAGE=true (the second passing branch of assertDurableStorageForGeneration).",
      nextAction: "Set S3_BUCKET to keep output, or leave the override if this is a throwaway environment.",
    });
  } else if (!f.storageConfigured) {
    issues.push({
      key: "storage_bucket_not_connected",
      layer: "asset_hosting",
      severity: "blocker",
      reason: "Meta requires a public video URL, and there is no durable bucket — generation refuses to spend credits (fail-closed by design).",
      // S3_BUCKET alone is what assertDurableStorageForGeneration enforces;
      // CLOUDFRONT_DOMAIN is the separate permanent-URL warning below.
      // Measured 2026-07-29: prod had S3 set and CloudFront unset — reporting
      // that state as a full blocker would have been a false alarm.
      evidence: "S3_BUCKET unset (the exact check storage.ts enforces before paid generation).",
      nextAction: "Set S3_BUCKET on the Railway service, then retry the same job — no code change needed.",
    });
  } else if (!f.permanentUrls) {
    issues.push({
      key: "storage_urls_not_permanent",
      layer: "asset_hosting",
      // INFO, not warning: publicObjectUrl serves {SITE_URL}/generated/{key}
      // through the app, backed by S3 — URLs are stable while the bucket holds
      // the object. CloudFront is a CDN/bandwidth offload, not a permanence
      // requirement (measured 2026-07-29: prod runs exactly this shape).
      severity: "info",
      reason: "Media serves through the app from S3 (stable URLs). CLOUDFRONT_DOMAIN would offload bandwidth to a CDN — optional.",
      evidence: "S3_BUCKET set, CLOUDFRONT_DOMAIN unset; /generated/* streams from object storage.",
      nextAction: "Optional: create a CloudFront distribution over the bucket and set CLOUDFRONT_DOMAIN.",
    });
  }

  if (!f.metaConfigured) {
    issues.push({
      key: "meta_not_connected",
      layer: "meta_connection",
      severity: "blocker",
      reason: "No usable Meta connection — nothing can publish.",
      evidence: "Meta credentials/page state incomplete (getMetaSocialStatus).",
      nextAction: "Connect the account in Instagram → Settings.",
    });
  } else if (f.metaLive === false) {
    issues.push({
      key: "meta_token_rejected",
      layer: "meta_connection",
      severity: "blocker",
      reason: "Meta REJECTED the live credential check — every publish will fail at the Graph call.",
      evidence: f.metaLiveError ?? "verifyMetaConnectionLive: rejected",
      nextAction: "Reconnect via the official flow in Settings, then re-check health before resuming schedules.",
    });
  } else if (f.metaLive === null) {
    issues.push({
      key: "meta_liveness_unknown",
      layer: "meta_connection",
      severity: "warning",
      reason: "Could not ASK Meta whether the token works — this is unknown, not a dead token.",
      evidence: f.metaLiveError ?? "liveness check unreachable",
      nextAction: "Re-run health in a minute; do not rotate tokens on a transport blip.",
    });
  }

  if (f.controls === null) {
    issues.push({
      key: "kill_switch_state_unreadable",
      layer: "kill_switch",
      severity: "warning",
      reason: "Kill-switch state is unreadable — automated publishers fail CLOSED until it is readable again (operators can still publish, loudly).",
      evidence: `emergency controls source: ${f.controlsSource ?? "unreachable"}`,
      nextAction: "Check autonomy policy storage/DB health; automated posting resumes by itself once the state reads.",
    });
  } else {
    if (f.controls.globalKillSwitch) {
      issues.push({
        key: "global_kill_switch_on",
        layer: "kill_switch",
        severity: "info",
        reason: "GLOBAL kill switch is ON — all automated action is deliberately stopped.",
        evidence: "autonomy policy emergencyControls.globalKillSwitch = true",
        nextAction: "Flip it in the Autonomy Command Center when you intend to resume.",
      });
    }
    if (f.controls.publishingKillSwitch && !f.controls.globalKillSwitch) {
      issues.push({
        key: "publishing_kill_switch_on",
        layer: "kill_switch",
        severity: "info",
        reason: "Publishing kill switch is ON — automated publishing is deliberately stopped.",
        evidence: "autonomy policy emergencyControls.publishingKillSwitch = true",
        nextAction: "Flip it in the Autonomy Command Center when you intend to resume.",
      });
    }
    if (f.controls.generationKillSwitch && !f.controls.globalKillSwitch) {
      issues.push({
        key: "generation_kill_switch_on",
        layer: "kill_switch",
        severity: "info",
        reason: "Generation kill switch is ON — no new paid assets will be created.",
        evidence: "autonomy policy emergencyControls.generationKillSwitch = true",
        nextAction: "Flip it in the Autonomy Command Center when you intend to resume.",
      });
    }
  }

  if (!f.reelPublishArmed) {
    issues.push({
      key: "reel_publish_disarmed",
      layer: "publish_gate",
      severity: "info",
      reason: "REEL_PUBLISH_ENABLED is off (default) — assembled reels cannot post, by design.",
      evidence: "env REEL_PUBLISH_ENABLED !== \"true\" (the exact check at the publish choke point).",
      nextAction: "Arm it only when you intend live reel posting; leave off otherwise.",
    });
  }

  if (f.publishAmbiguousReelJobs === null) {
    issues.push({
      key: "ambiguous_count_unknown",
      layer: "reconciliation",
      severity: "warning",
      reason: "Could not count ambiguous publishes — unknown is not zero.",
      evidence: "reel_jobs publish_ambiguous count query failed.",
      nextAction: "Check DB health, then re-open Today; do not retry any publish until the count reads.",
    });
  } else if (f.publishAmbiguousReelJobs > 0) {
    issues.push({
      key: "publish_ambiguous_reel_jobs",
      layer: "reconciliation",
      severity: "blocker",
      reason: `${f.publishAmbiguousReelJobs} reel publish(es) are parked AMBIGUOUS — the post may be live; a blind retry is how duplicates happen.`,
      evidence: "reel_jobs.status = publish_ambiguous",
      nextAction: "Run the reconciler (Action Center) — it asks Meta and only auto-resolves confident matches.",
    });
  }

  if (f.jobsNeedingAttention === null) {
    issues.push({
      key: "attention_count_unknown",
      layer: "generation",
      severity: "warning",
      reason: "Could not count reel jobs needing attention — unknown is not zero.",
      evidence: "selectReelJobsNeedingAttention failed.",
      nextAction: "Check DB health and re-open Today.",
    });
  } else if (f.jobsNeedingAttention > 0) {
    issues.push({
      key: "reel_jobs_need_attention",
      layer: "generation",
      severity: "warning",
      reason: `${f.jobsNeedingAttention} reel job(s) are held or failed and need a decision.`,
      evidence: "Action Center recoverability list (same source as the badge).",
      nextAction: "Open the Action Center and resolve the oldest first.",
    });
  }

  if (!f.generatorConfigured) {
    issues.push({
      key: "generator_credentials_missing",
      layer: "generation",
      severity: "warning",
      reason: `The active video provider (${f.generatorProvider}) has no credentials — reel generation will fail at submit.`,
      evidence: "provider selected by the same selector the pipeline uses; its credential check returned false.",
      nextAction: "Add the provider's credentials in Railway, or switch REEL_VIDEO_PROVIDER.",
    });
  }
  if (!f.generationEnabled) {
    issues.push({
      key: "reel_generation_disabled",
      layer: "generation",
      severity: "info",
      reason: "REEL_GENERATION_ENABLED is off — the background reel pipeline will not create new work.",
      evidence: "env REEL_GENERATION_ENABLED !== \"true\"",
      nextAction: "Enable only when you want autonomous generation to spend credits.",
    });
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Read every fact the deriver needs. Each read fails to null/false honestly. */
export async function gatherDeliveryFacts(): Promise<DeliveryFacts> {
  const { getMetaSocialStatus, verifyMetaConnectionLive } = await import("./metaSocial");
  const meta = await getMetaSocialStatus();
  const metaConfigured = meta.configured && (meta.facebookReady || meta.instagramReady);

  let metaLive: boolean | null = null;
  let metaLiveError: string | null = null;
  if (metaConfigured) {
    try {
      const live = await verifyMetaConnectionLive();
      if (live.unknown) {
        metaLive = null;
        metaLiveError = live.error ?? "Could not reach Meta to verify";
      } else {
        metaLive = live.ok;
        metaLiveError = live.ok ? null : (live.error ?? "Meta rejected the credentials");
      }
    } catch (err) {
      metaLive = null;
      metaLiveError = err instanceof Error ? err.message.slice(0, 200) : "Could not reach Meta to verify";
    }
  }

  let controls: DeliveryFacts["controls"] = null;
  let controlsSource: string | null = null;
  try {
    const { getEmergencyControlsFresh } = await import("./autonomyControl");
    const fresh = await getEmergencyControlsFresh();
    controlsSource = fresh.source;
    // An unreachable-fallback source means we are NOT reading live state —
    // report unreadable rather than presenting the default as the policy.
    controls = fresh.source === "fallback_unreachable"
      ? null
      : {
          globalKillSwitch: fresh.controls.globalKillSwitch,
          publishingKillSwitch: fresh.controls.publishingKillSwitch,
          generationKillSwitch: fresh.controls.generationKillSwitch,
        };
  } catch (err) {
    log.warn("emergency controls unreadable", { err: err instanceof Error ? err.message : String(err) });
    controls = null;
  }

  let publishAmbiguousReelJobs: number | null = null;
  let jobsNeedingAttention: number | null = null;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (d) {
      const { reelJobs } = await import("../../drizzle/schema");
      const { eq, sql } = await import("drizzle-orm");
      const rows = await d
        .select({ n: sql<number>`count(*)` })
        .from(reelJobs)
        .where(eq(reelJobs.status, "publish_ambiguous"));
      const n = Number((rows as Array<{ n: unknown }>)[0]?.n);
      publishAmbiguousReelJobs = Number.isFinite(n) ? n : null;

      const { selectReelJobsNeedingAttention } = await import("./reelRecoverability");
      jobsNeedingAttention = (await selectReelJobsNeedingAttention(d, 200)).length;
    }
  } catch (err) {
    log.warn("delivery counts unreadable", { err: err instanceof Error ? err.message : String(err) });
  }

  const { selectReelVideoProvider } = await import("./reelPipeline");
  const generatorProvider = await selectReelVideoProvider();
  let generatorConfigured = false;
  try {
    if (generatorProvider === "template_stock") {
      // Local ffmpeg lane — no credentials exist to be missing. Falling through
      // to the Veo branch raised a false generator_credentials_missing warning
      // on the operator's Today screen whose nextAction told them to switch
      // REEL_VIDEO_PROVIDER away from a lane that was working.
      generatorConfigured = true;
    } else if (generatorProvider === "higgsfield") {
      const { getHiggsfieldCredentialsJson } = await import("./higgsfieldStudio");
      generatorConfigured = !!(await getHiggsfieldCredentialsJson());
    } else {
      const { veoCredentialsPresent } = await import("./veoStudio");
      generatorConfigured = veoCredentialsPresent();
    }
  } catch {
    generatorConfigured = false;
  }

  return {
    // Matches enforcement, not display: storage.ts hard-requires S3_BUCKET
    // only; CLOUDFRONT_DOMAIN is a CDN offload, NOT the permanence condition.
    //
    // `permanentUrls` was `!!CLOUDFRONT_DOMAIN` — the INVERSE of the proxied-reads
    // path. The issue text below had already been reasoned down to severity
    // "info" with the correct explanation, but the flag feeding it stayed wrong,
    // so prod raised a storage_urls_not_permanent issue while serving permanent
    // proxied URLs. Read the storage module's own authority instead of keeping a
    // second definition here.
    storageConfigured: durableStorageConfigured(),
    permanentUrls: servesPermanentUrls(),
    ephemeralOverride: ephemeralStorageOverride(),
    metaConfigured,
    metaLive,
    metaLiveError,
    generatorProvider,
    generatorConfigured,
    generationEnabled: process.env.REEL_GENERATION_ENABLED === "true",
    reelPublishArmed: process.env.REEL_PUBLISH_ENABLED === "true",
    controls,
    controlsSource,
    publishAmbiguousReelJobs,
    jobsNeedingAttention,
  };
}

export async function getDeliveryIssues(): Promise<{ issues: SocialDeliveryIssue[]; facts: DeliveryFacts }> {
  const facts = await gatherDeliveryFacts();
  return { issues: deriveDeliveryIssues(facts), facts };
}
