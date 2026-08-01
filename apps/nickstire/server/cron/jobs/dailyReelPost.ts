/**
 * Daily Instagram Reel auto-poster.
 *
 * Posts one pre-made Nick's Tire reel per morning (reels 5-30 — reel 4 was the
 * manual kickoff), in the 9am ET window, through the ONE gated publish door
 * (`publishToSocial`). Laptop-independent: runs on the always-on Railway server,
 * so a broken laptop never stops the campaign.
 *
 * State lives in the `shop_settings` KV table (no migration):
 *   reel_autopost_index     — index of the NEXT reel into MANIFEST (0..length)
 *   reel_autopost_last_date — YYYY-MM-DD (ET) of the last successful post
 *
 * Two kill switches, both default OFF:
 *   REEL_AUTOPOST_ENABLED  — this job (set true on Railway to arm the schedule)
 *   REEL_PUBLISH_ENABLED   — the publishToSocial reel gate (Phase-0 safety)
 *
 * Idempotency: posts at most once per ET day. On any failure the index is NOT
 * advanced and the date is NOT recorded, so the next eligible tick retries the
 * same reel — never a skip, never a double-post.
 */
import { and, eq } from "drizzle-orm";
import { createLogger } from "../../lib/logger";
import { shopSettings, reelJobs } from "../../../drizzle/schema";
import { BUSINESS } from "@shared/business";
import { prepareCleanReelBrief, PreflightExhaustedError } from "../../services/reelDraftPrep";
import { enqueueReelJob } from "../../services/reelPipeline";
import { publishToSocial } from "../../services/socialPublish";

const log = createLogger("cron:daily-reel-post");

const POST_HOUR_ET = 9;

// reels 5-30 in calendar order. Captions are claim-safe: no prices, no "free"
// except "free check", no guarantees/best/kill-words. Verified by the unit test.
export const MANIFEST: { reel: number; caption: string }[] = [
  { reel: 5, caption: "Your brakes are on a diet 🍦 Once the pad gets this thin, you're one drive from metal-on-metal — loud and pricey. A free check tells you exactly how much is left.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 6, caption: "This oil gave up weeks ago ☕ Old oil turns to sludge and grinds your engine from the inside. A fresh change is the cheapest insurance your car will ever get.\n\n#oilchange #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 7, caption: "Your battery hates Cleveland winters ❄️ Cold can cut its cranking power by a third — which is why it dies the first freezing morning. A quick test now beats a no-start later.\n\n#carbattery #wintercar #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 8, caption: "Your wipers are just smearing now 🌧️ When the rubber edge cracks, it streaks right where you need to see. It's a two-minute swap — don't wait for a downpour.\n\n#wiperblades #cartips #rainydays #euclidohio #clevelandcars #nickstire" },
  { reel: 9, caption: "You've been breathing through a dirty sock 🧦 A clogged cabin filter means weak airflow and a musty smell. Swap it and the air's fresh again. Smell something off? Stop by.\n\n#cabinfilter #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 10, caption: "We caught the nail 🔨 A nail in the tread is often repairable — in the sidewall, usually not (it flexes too much to patch safely). Picked one up? Stop by and we'll take a look.\n\n#flattire #tirerepair #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 11, caption: "The tires are having a dispute 🍽️ One's wearing faster than the rest. Rotating every 5 to 7k miles keeps the wear even. Due for one? Stop by and we'll sort it.\n\n#tirerotation #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 12, caption: "Why's your wheel doing the laundry? 🌀 An out-of-balance wheel shakes worst around 60 mph. A quick re-balance smooths it right out. Feel a shimmy? Stop by.\n\n#wheelbalance #cartips #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 13, caption: "That little light isn't lying 💡 The TPMS light means a tire's low on pressure — worth checking soon (low pressure wears tires and kills your mileage). Stop by for a free check.\n\n#tpms #tirepressure #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 14, caption: "This tire has a serious comb-over 💈 Feathered, angled tread edges often mean an alignment problem. Catch it early and your tires last longer. Notice odd wear? Stop by.\n\n#wheelalignment #tirewear #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 15, caption: "Bald tires can't swim 🌊 Low tread can't channel water away, so you hydroplane in the rain. Good tread keeps you gripping the road. Curious where yours stand? Free check.\n\n#hydroplaning #tiresafety #rainydriving #euclidohio #clevelandcars #nickstire" },
  { reel: 16, caption: "Your tires are wearing the wrong shoes ⛸️ Below about 45F, winter tires grip way better — their rubber stays soft in the cold. Drive through real winters? Stop by and we'll talk options.\n\n#wintertires #snowtires #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 17, caption: "Your spare is a forgotten promise 🛞 Spares lose air and age too — then they're flat the day you need them. Check it before you have to. Stop by and we'll take a look.\n\n#sparetire #cartips #roadtripready #euclidohio #clevelandcars #nickstire" },
  { reel: 18, caption: "Your brake fluid is drinking water 🧽 It quietly absorbs moisture over time and the pedal starts feeling soft. A periodic flush keeps it firm. Pedal feel off? Worth checking.\n\n#brakefluid #brakes #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 19, caption: "Your engine's about to whistle 🫖 Low or old coolant lets the heat climb until it boils over. A quick level check keeps things calm. Stop by and we'll take a look.\n\n#coolant #overheating #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 20, caption: "One little belt runs almost everything 🎗️ When it dries out and cracks it can snap and strand you. Caught early, it's a small fix. Worth a quick look anytime.\n\n#serpentinebelt #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 21, caption: "Your headlights need reading glasses 👓 As the lens clouds and yellows it quietly steals your night vision. Good news: foggy lenses can be restored. Stop by and we'll take a look.\n\n#headlightrestoration #cartips #nightdriving #euclidohio #clevelandcars #nickstire" },
  { reel: 22, caption: "That highway hum? 🐹 A low roar that grows louder with speed is the classic wheel-bearing sign — and it only gets worse. Hear it? Stop by.\n\n#wheelbearing #cartips #carnoise #euclidohio #clevelandcars #nickstire" },
  { reel: 23, caption: "Your car shouldn't pogo 🦘 Worn struts keep bouncing after a bounce — and that bounce stretches your stopping distance. Smooth rides are safer rides. Swing by anytime.\n\n#struts #suspension #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 24, caption: "It's a riddle, not a death sentence 🔦 The check engine light won't just tell you — don't guess. Scan it for codes and the code points the way. Light on? Stop by and we'll take a look.\n\n#checkenginelight #cartips #cardiagnostics #euclidohio #clevelandcars #nickstire" },
  { reel: 25, caption: "More air isn't better 🎈 Over-inflated tires ride harsh and wear out the center. Match the door-sticker number. Not sure of yours? Stop by and we'll take a look.\n\n#tirepressure #cartips #tiresafety #euclidohio #clevelandcars #nickstire" },
  { reel: 26, caption: "Before the long drive 🧳 Give your car the checklist: tread, tire pressure, the spare, and fluids. A few minutes now means a smoother trip. Heading out? Stop by first.\n\n#roadtrip #cartips #travelready #euclidohio #clevelandcars #nickstire" },
  { reel: 27, caption: "Used tires aren't a gamble — if they're inspected 🃏 Each one we sell gets checked first for tread and damage. Real savings, done right. Curious what fits your car? Stop by.\n\n#usedtires #tiredeals #cartips #euclidohio #clevelandcars #nickstire" },
  { reel: 28, caption: "Pure gloss therapy ✨ But a clean tire isn't just pretty — when the rubber shines, you can spot cracks and damage early. Keep them clean and keep an eye out.\n\n#tiredetailing #oddlysatisfying #carcare #euclidohio #clevelandcars #nickstire" },
  { reel: 29, caption: "Hear that high note? 🎶 That brake squeal is often the built-in wear indicator telling you the pads are getting low. It's a built-in heads-up. Hearing it? Stop by.\n\n#brakes #cartips #carmaintenance #euclidohio #clevelandcars #nickstire" },
  { reel: 30, caption: "Get your car a winter coat 🧣 Before the cold sets in, check the battery, tires, fluids, and wipers. A little prep keeps winter from catching you off guard. Stop by and we'll get you ready.\n\n#wintercar #carmaintenance #cartips #euclidohio #clevelandcars #nickstire" },
];

async function getKv(key: string): Promise<string | null> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return null;
  const rows = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  return rows.length ? (rows[0].value as string) : null;
}

async function setKv(key: string, value: string, label: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  const existing = await d.select().from(shopSettings).where(eq(shopSettings.key, key)).limit(1);
  if (existing.length > 0) {
    await d.update(shopSettings).set({ value, updatedBy: "system" }).where(eq(shopSettings.key, key));
  } else {
    await d.insert(shopSettings).values({ key, value, label, category: "general", updatedBy: "system" });
  }
}

async function setAutopostProgress(idx: number, date: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  await d.transaction(async (tx: any) => {
    // 1. Update index
    await tx.insert(shopSettings).values({ 
      key: "reel_autopost_index", 
      value: String(idx), 
      label: "Daily reel autopost — next reel index", 
      category: "general", 
      updatedBy: "system" 
    }).onDuplicateKeyUpdate({ set: { value: String(idx), updatedBy: "system" } });
    
    // 2. Update date
    await tx.insert(shopSettings).values({ 
      key: "reel_autopost_last_date", 
      value: date, 
      label: "Daily reel autopost — last post date (ET)", 
      category: "general", 
      updatedBy: "system" 
    }).onDuplicateKeyUpdate({ set: { value: date, updatedBy: "system" } });
  });
}

function etNow(): { date: string; hour: number } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone }); // YYYY-MM-DD
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
  return { date, hour };
}

export async function runDailyReelPost(): Promise<{ recordsProcessed?: number; details?: string }> {
  if (process.env.REEL_AUTOPOST_ENABLED !== "true") {
    return { recordsProcessed: 0, details: "disabled (REEL_AUTOPOST_ENABLED != true)" };
  }

  const { date, hour } = etNow();

  const lastDate = await getKv("reel_autopost_last_date");
  if (lastDate === date) {
    return { recordsProcessed: 0, details: `already posted today (${date})` };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "DB not available" };

  const briefId = `autopost-${date}`;
  const jobs = await d.select().from(reelJobs).where(eq(reelJobs.briefId, briefId)).limit(1);
  const job = jobs[0];

  if (!job) {
    // Only ENQUEUE during the best posting hour. Publishing an already-assembled
    // job (below) runs on ANY pulse — async gen+assembly routinely finishes after
    // the window, so gating publish on wall-clock would silently skip the reel.
    // Phase 5.3: the enqueue hour is data-driven (top-engagement slot) once the
    // analytics table has enough data; until then it stays POST_HOUR_ET (9 ET).
    let targetHour = POST_HOUR_ET;
    try {
      const { getBestPostingTimes } = await import("../../pipelines/instagram-data");
      const times = await getBestPostingTimes({ limit: 1 });
      if (times.length && Number.isFinite(times[0].hourOfDay)) targetHour = times[0].hourOfDay;
    } catch (err) {
      log.warn("best-posting-time lookup failed; using default hour", { err: err instanceof Error ? err.message : String(err) });
    }
    if (hour !== targetHour) {
      return { recordsProcessed: 0, details: `not post hour (ET ${hour}:00, want ${targetHour}:00) — waiting to enqueue` };
    }
    const idx = parseInt((await getKv("reel_autopost_index")) || "0", 10) || 0;
    if (idx >= MANIFEST.length) {
      return { recordsProcessed: 0, details: `campaign complete (${MANIFEST.length}/${MANIFEST.length} posted)` };
    }

    // Topic authority is the LIVE MINER, not the hardcoded manifest. The
    // manifest is a fixed campaign list written once; it cannot know what
    // performed, what reviews said, what season it is, or what has already been
    // covered. It stays ONLY as a last resort so a signal outage cannot stall
    // the daily reel — and when it is used, the result says so.
    let topic = "";
    let topicOrigin = "miner";
    try {
      const { gatherTopicSignals } = await import("../../services/contentTopicSignals");
      const { mineTopicCandidates, autoRenderable } = await import("../../../shared/contentTopicMiner");
      const { signals, failed } = await gatherTopicSignals();
      const renderable = autoRenderable(mineTopicCandidates(signals));
      if (renderable.length) {
        topic = renderable[0].topic;
        log.info("daily reel topic from live miner", {
          topic,
          franchise: renderable[0].franchiseId,
          score: renderable[0].score,
          candidates: renderable.length,
          degradedSources: failed,
        });
      } else {
        log.warn("miner produced no auto-renderable candidate — falling back to manifest", { degradedSources: failed });
      }
    } catch (err) {
      log.warn("topic miner unavailable — falling back to manifest", { err: err instanceof Error ? err.message : String(err) });
    }
    if (!topic) {
      const { caption: manifestCaption } = MANIFEST[idx];
      topic = manifestCaption.split("\n")[0] || manifestCaption;
      topicOrigin = "manifest_fallback";
    }

    log.info(`Generating fresh dynamic storyboard brief for topic: "${topic}"`);
    // Regenerate on a preflight block: generateReelBriefAI is non-deterministic
    // and a brief that trips the M10 preflight (in-frame-text / free-claim) would
    // otherwise silently cost the day's reel (this cron generates once). The
    // helper retries and only attaches the visual-world anchor (flag-gated
    // REEL_AUTO_VISUAL_WORLD) + builds the prompt pack for a brief that passed.
    let prepared;
    try {
      // 6, not 3. The truth gate now BLOCKS an ungrounded brief instead of
      // warning, and measured compliance on real briefs was 5/12 — at ~42% per
      // attempt, 3 tries skip the day's reel roughly once a week (0.58^3 ≈ 20%);
      // 6 tries put that near 4%. This is affordable precisely because a
      // rejected brief costs ONE LLM CALL: prepareCleanReelBrief attaches the
      // visual world (which spends an image credit) only AFTER a brief passes.
      // Resolve the experiment arm BEFORE generating. Assignment at enqueue
      // (reelPipeline) records what happened; only this can change what is made.
      // Deterministic on the brief id, so a retry re-derives the same arm rather
      // than re-rolling and quietly contaminating the comparison.
      let hookStyle;
      try {
        const { hookArmForEpisode } = await import("../../services/contentExperimentStore");
        hookStyle = await hookArmForEpisode(briefId);
        if (hookStyle) log.info("daily reel: hook experiment arm", { briefId, hookStyle });
      } catch (err) {
        // An experiment that cannot be read must not stop the day's reel. The
        // episode simply runs as control and is recorded as such.
        log.warn("hook arm lookup failed — generating as control", { err: err instanceof Error ? err.message : String(err) });
      }
      prepared = await prepareCleanReelBrief({ topic, hookStyle }, { maxAttempts: 6 });
    } catch (err) {
      if (err instanceof PreflightExhaustedError) {
        // Deliberate benign skip: every candidate deterministically preflight-
        // blocked. No reel today; retries fresh tomorrow.
        log.warn("daily reel: all briefs preflight-blocked — skipping today", { err: err.message });
        return { recordsProcessed: 0, details: `skipped — all briefs preflight-blocked: ${err.message}` };
      }
      // Any OTHER failure (provider outage, parse/auth error, timeout, DB) is a
      // real generator fault — do NOT swallow it as a normal idle tick. Rethrow
      // so the cron run fails loudly and monitoring alerts.
      throw err;
    }
    const { brief } = prepared;
    brief.id = briefId;

    // Declared, not defaulted. `visibly_animated` is a real assertion about
    // this pipeline's output — fully generated, no photorealistic human
    // footage — and it is what decides whether Meta AI disclosure is mandatory.
    // Claims/evidence are not wired into this path yet; preflight reports that
    // as a warning rather than silently accepting it.
    const { jobId } = await enqueueReelJob(brief, "cron", {
      objective: "DISCOVERY",
      disclosureMode: "visibly_animated",
      // ReelBrief (the generator's shape) has no ctaType yet — the generated
      // caption carries its ask in prose. Declared NONE rather than guessed, so
      // the governor's repetition check is not fed a fabricated CTA.
      ctaType: (brief as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
    });
    log.info(`Enqueued new dynamic reel job: ${jobId} for briefId: ${briefId} (brief attempt ${prepared.attempts})`);
    // topicOrigin is in the cron_log line on purpose: a run that quietly fell
    // back to the manifest looks identical to a healthy one otherwise, and
    // "the miner has been dead for a week" is exactly the kind of silent
    // degradation this codebase keeps having to discover the hard way.
    return { recordsProcessed: 0, details: `Enqueued new dynamic reel job (ID: ${jobId}) for today [topic:${topicOrigin}]` };
  }

  if (job.status === "assembled") {
    const videoUrl = job.mp4Url;
    if (!videoUrl) {
      return { recordsProcessed: 0, details: `Job ${job.id} assembled but mp4Url is missing` };
    }
    
    try {
      const { assertPermanentPublicMediaUrl } = await import("../../services/socialPublish");
      assertPermanentPublicMediaUrl(videoUrl);
    } catch (err) {
      log.error(`Job ${job.id} has invalid mp4Url`, { error: err instanceof Error ? err.message : String(err) });
      return { recordsProcessed: 0, details: `Job ${job.id} URL invalid: ${err instanceof Error ? err.message : String(err)}` };
    }
    let caption = job.caption || "";
    // Phase 3.3 safety: the AI caption carries the share-CTA, and publishToSocial
    // claim-gates reel captions — so an unsafe CTA would make the reel SILENTLY
    // never post (campaign stall). Fall back to the known claim-safe MANIFEST
    // caption so the reel still ships on time (CTA dropped), with a loud log.
    try {
      const { checkReviewReply, hasBlockingFindings } = await import("@shared/reviewReplyQa");
      if (caption && hasBlockingFindings(checkReviewReply(caption))) {
        // HOLD, do not substitute. This used to swap in MANIFEST[idx0].caption,
        // but idx0 is the CURRENT autopost counter and need not correspond to
        // THIS job — so the fallback could attach a caption about topic A to a
        // video about topic B. A mismatched public caption is worse than a
        // delayed reel: the reel retries tomorrow, a wrong caption cannot be
        // edited on Instagram after publish.
        log.error("reel caption tripped the claim gate — HOLDING the reel (index not advanced; fresh brief tomorrow)", {
          jobId: job.id,
        });
        return { recordsProcessed: 0, details: `held — caption tripped the claim gate on job ${job.id}; not substituting an unrelated manifest caption` };
      }
    } catch (err) {
      log.warn("reel caption claim-check skipped", { err: err instanceof Error ? err.message : String(err) });
    }

    // Autonomous publish must clear the CONSOLIDATED rendered-QA gate — the same
    // evaluateReelPublishGate every reel door uses. A real non-"proceed" verdict
    // HOLDS the reel (index not advanced, retries a fresh brief tomorrow).
    //
    // A QA INFRA FAILURE ALSO HOLDS. This comment used to say the opposite —
    // that infra failure "proceeds with a loud warn" — which was true of an
    // earlier version and became false when the catch below was changed to hold
    // (see its own comment). A stale comment claiming fail-OPEN above code that
    // fails CLOSED is worse than no comment: this is the autonomous door, there
    // is no human reviewing the post, and the comment is what the next reader
    // will believe about the safety model.
    try {
      const { evaluateReelPublishGate } = await import("../../services/qualityGate");
      const g = await evaluateReelPublishGate(job.id);
      if (!g.allowed) {
        log.warn(`daily reel: publish gate '${g.gate}' — HOLDING job ${job.id}, not publishing`, { findings: g.findings.length, reason: g.reason });
        return { recordsProcessed: 0, details: `held by rendered-QA gate (${g.gate}); index not advanced` };
      }
    } catch (err) {
      // This catch used to log "publishing without gate" and fall through — the
      // exact fail-open this whole arc exists to remove, sitting in the
      // autonomous door. A transient DB error during the gate read would publish
      // a reel with NO quality decision computed at all.
      //
      // An error evaluating the gate is not a passing gate. Hold; the reel is a
      // day late instead of unscored, and the index is deliberately not advanced
      // so tomorrow's tick retries this same job.
      const detail = err instanceof Error ? err.message : String(err);
      log.error(`daily reel: publish gate ERRORED for job ${job.id} — HOLDING (an unreadable gate is not an open gate)`, { err: detail });
      return { recordsProcessed: 0, details: `held: publish gate could not be evaluated (${detail.slice(0, 120)}); index not advanced` };
    }

    // EXACTLY-ONCE: claim assembled -> publishing BEFORE the external Meta call,
    // so two overlapping cron ticks cannot both publish this reel. The loser of
    // the CAS simply reports that another run owns it.
    const claimRes = await d.update(reelJobs).set({ status: "publishing" })
      .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "assembled")));
    const { affectedRowCount } = await import("../../lib/db-affected");
    const claimed = affectedRowCount(claimRes);
    if (claimed !== 1) {
      log.warn(`daily reel: publish already claimed by another run (job ${job.id})`);
      return { recordsProcessed: 0, details: `publish already claimed by another run (job ${job.id})` };
    }

    log.info(`Attempting to publish assembled reel job ${job.id} (mp4Url: ${videoUrl})`);

    // Durable attempt record BEFORE the irreversible call. The CAS claim above
    // stops two runners racing, but it does not survive a process death: killed
    // between Meta accepting and the DB update, nothing would record that an
    // attempt happened at all. Refusing to publish unrecorded is the point — an
    // unrecorded publish is the ambiguity this exists to remove.
    const { recordPublishAttempt, recordPublishOutcome, OUTCOME } = await import("../../services/publishAttemptLedger");
    const attemptId = await recordPublishAttempt({
      jobId: job.id, platforms: ["instagram"], mediaUrl: videoUrl,
    });
    if (!attemptId) {
      await d.update(reelJobs).set({ status: "assembled" })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      log.error(`daily reel: could not record a publish attempt for job ${job.id} — HOLDING rather than publishing unrecorded`);
      return { recordsProcessed: 0, details: "held: publish-attempt ledger unavailable; index not advanced" };
    }

    let outcome;
    try {
      // "automated": nobody is watching this cron, so an UNREADABLE kill-switch
      // state must stop it rather than let it publish blind.
      outcome = await publishToSocial({ platforms: ["instagram"], videoUrl, caption, actor: "automated" });
    } catch (pubErr) {
      // THREW — Meta may or may not have accepted the reel. Do NOT restore
      // "assembled" (that risks a double-publish); park it for reconciliation
      // and fail the cron run loudly.
      const msg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      await recordPublishOutcome(attemptId, OUTCOME.ambiguous, { error: msg });
      await d.update(reelJobs)
        .set({ status: "publish_ambiguous", error: `publish threw: ${msg.slice(0, 300)}` })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      log.error(`daily reel: publish THREW — job ${job.id} parked publish_ambiguous; verify on Instagram before retrying`, { err: msg });
      throw pubErr;
    }
    const ig = outcome.results.find((r) => r.platform === "instagram");
    await recordPublishOutcome(attemptId, ig?.success ? OUTCOME.confirmed : OUTCOME.failed, {
      igPostId: ig?.postId ?? null, error: ig?.success ? null : (ig?.error ?? "unknown"), platformResults: outcome.results,
    });
    if (!ig?.success) {
      // Cleanly-returned failure: Meta explicitly did not accept it, so the
      // claim is safe to release for a later retry.
      await d.update(reelJobs).set({ status: "assembled" })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      log.error(`Reel autopost publish failed for job ${job.id}`, { error: ig?.error });
      return { recordsProcessed: 0, details: `Publish failed: ${ig?.error ?? "unknown"} — not advancing index` };
    }

    // Successfully posted live!
    await d.update(reelJobs).set({ status: "posted", igPostId: ig.postId }).where(eq(reelJobs.id, job.id));
    const idx = parseInt((await getKv("reel_autopost_index")) || "0", 10) || 0;
    await setAutopostProgress(idx + 1, date);
    log.info(`Successfully posted dynamic reel for job ${job.id}`, { postId: ig.postId });
    return { recordsProcessed: 1, details: `posted dynamic reel for job ${job.id} (index: ${idx + 1})` };
  }

  if (["queued", "generating", "assets_ready", "assembling", "uploading", "publishing"].includes(job.status)) {
    return { recordsProcessed: 0, details: `Generation or assembly in progress (status: ${job.status})` };
  }

  if (job.status === "failed") {
    return {
      recordsProcessed: 0,
      details: `Generation failed for job ${job.id}: ${job.error}; no fallback media posted and index not advanced`,
    };
  }

  return { recordsProcessed: 0, details: `Unknown job status: ${job.status}` };
}
