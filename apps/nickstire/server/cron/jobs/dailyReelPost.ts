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
 * Three kill switches, all default OFF:
 *   REEL_AUTOPOST_ENABLED      — this job (set true on Railway to arm the schedule)
 *   REEL_PUBLISH_ENABLED       — the publishToSocial reel gate (Phase-0 safety; IG and FB)
 *   REEL_FB_CROSSPOST_ENABLED  — also hand the SAME video to the Facebook Page as a
 *                                video reel (operator armed 2026-10-01). Instagram stays
 *                                the delivery authority: a Facebook failure never changes
 *                                the job's status, and a Facebook SUCCESS beside an
 *                                Instagram failure PARKS the job instead of releasing it,
 *                                because a retry would post the Page a second time.
 *
 * Idempotency: posts at most once per ET day. On any failure the index is NOT
 * advanced and the date is NOT recorded, so the next eligible tick retries the
 * same reel — never a skip, never a double-post.
 */
import { and, asc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { createLogger } from "../../lib/logger";
import { shopSettings, reelJobs, reelPublishApprovals } from "../../../drizzle/schema";
import { BUSINESS } from "@shared/business";
import { prepareCleanReelBrief, PreflightExhaustedError } from "../../services/reelDraftPrep";
import { enqueueReelJob } from "../../services/reelPipeline";
import { reelPublicationIntentFor } from "@shared/reelPublicationSchedule";
import { publishToSocial } from "../../services/socialPublish";
import { publishDisclosureProblem, shouldDiscloseAi } from "@shared/reelDisclosure";
import { auditPublishBlock, condemnedContentProblem } from "@shared/reelClaimAudit";
import { reelApprovalProblem } from "../../services/reelApproval";
import { parseReelJobPayload } from "@shared/reelJobPayload";
import {
  ACTIVE_REEL_SLATE_CURSOR_KEY,
  APPROVED_REEL_PACKS,
  advanceRotationPastRefusedPack,
  approvedVariantSnapshot,
  buildBriefFromApprovedProductionPack,
  loadApprovedProductionPack,
  readActiveReelSlate,
  resolveApprovedPackProgressTarget,
  resolveApprovedPackRotationIndex,
  resolveApprovedPackSelection,
} from "../../services/approvedReelPackRotation";
import {
  decideReadyBuffer,
  normalizeProductionTargetHour,
  productionSlotForHour,
  queueStateForReelStatus,
  readyCandidateIsUsable,
} from "@shared/reelQueue";

const log = createLogger("cron:daily-reel-post");

const POST_HOUR_ET = 9;

/**
 * Rendered-QA gate values that WAIT ON A HUMAN and therefore read identically on
 * every future pulse: needs_paid_repair parks until an operator authorizes the
 * spend, reject and stock_fallback park until the reel is regenerated.
 *
 * Deliberately EXCLUDED, because these do change by themselves and belong to the
 * gate chain: auto_repair (the chain queues the free repair, QA re-verdicts the
 * new render), unavailable (QA has not run yet, or could not be read - the chain
 * fails closed on it), needs_review, and disabled (which is allowed anyway).
 *
 * Used ONLY to decide what is worth SELECTING in the drain. The authoritative
 * chain still runs in full on whatever is selected, so no reel reaches Instagram
 * that the chain would refuse.
 */
const PARKED_QA_GATES: ReadonlySet<string> = new Set(["needs_paid_repair", "reject", "stock_fallback"]);

/**
 * 'unavailable' is transient only while something can still produce the
 * evidence: the gate runs rendered QA and (since 2026-10-10) audio QA on first
 * contact. A job still 'unavailable' this long after it was ready has a reason
 * nothing automatic will clear (critic lane down, master unreadable), and
 * re-selecting it every pulse is the head-of-line jam again — job 2070001 was
 * selected and held on every pulse for a day while production never ran.
 * Measured against the 15-minute pulse: 3 hours is 12 chances.
 */
export const STALE_UNAVAILABLE_MS = 3 * 60 * 60 * 1000;
export function staleUnavailable(
  job: { productionReadyAt?: Date | string | null; updatedAt?: Date | string | null; createdAt?: Date | string | null },
  nowMs: number = Date.now(),
): boolean {
  const at = job.productionReadyAt ?? job.updatedAt ?? job.createdAt;
  const t = at instanceof Date ? at.getTime() : Date.parse(String(at ?? ""));
  if (!Number.isFinite(t)) return false; // no timestamp: never park on a guess
  return nowMs - t > STALE_UNAVAILABLE_MS;
}
export const REEL_READY_TARGET = 3;
export const REEL_READY_LOW_WATERMARK = 1;

function hasReadyClipManifest(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const clips = JSON.parse(value) as unknown;
    return Array.isArray(clips) && clips.length > 0 && clips.every((clip) => typeof clip === "string" && clip.trim().length > 0);
  } catch {
    return false;
  }
}

/**
 * Count only inventory that can actually advance through the next gate.
 *
 * `drainSkippedIds` is every approved job the publish drain refused on THIS pulse.
 * The drain runs first and applies six checks; this count used to re-derive
 * only three of them, so on 2026-10-09 it called two drain-refused jobs
 * "usable", held production at the low watermark, and the lane neither
 * published nor produced. Reusing the drain's own verdict keeps one rule.
 *
 * `drainEvaluatedIds` is every assembled candidate the drain scanned. An
 * assembled job outside its bounded window is unproven and not counted. In
 * practice production runs only when the drain selected nothing, so every
 * evaluated assembled job was refused and the buffer is the in-production
 * (assets_ready) rows: a usable assembled Reel publishes instead of holding
 * production.
 */
async function countUsableReadyEpisodes(
  d: any,
  drainSkippedIds: ReadonlySet<number>,
  drainEvaluatedIds: ReadonlySet<number>,
): Promise<number> {
  const rows = await d
    .select({
      id: reelJobs.id,
      status: reelJobs.status,
      clipUrlsJson: reelJobs.clipUrlsJson,
      mp4Url: reelJobs.mp4Url,
      caption: reelJobs.caption,
      error: reelJobs.error,
    })
    .from(reelJobs)
    .where(inArray(reelJobs.status, ["assets_ready", "assembled"]))
    .orderBy(asc(reelJobs.id));

  let usable = 0;
  for (const row of rows) {
    const assembled = row.status === "assembled";
    const hasAsset = assembled
      ? Boolean(typeof row.mp4Url === "string" && row.mp4Url.trim() && typeof row.caption === "string" && row.caption.trim())
      : hasReadyClipManifest(row.clipUrlsJson);
    // An old approval hold is stale once the live exact-asset/exact-caption
    // approval now passes. Other errors are QA/claim/provider vetoes and stay
    // out of the usable buffer until an operator or a repair clears them.
    const error = typeof row.error === "string" ? row.error.trim() : "";
    const hasBlockingError = Boolean(error && !error.startsWith("HELD awaiting approval"));
    const skippedByDrain = drainSkippedIds.has(Number(row.id));
    const evaluatedByDrain = drainEvaluatedIds.has(Number(row.id));
    const hasLiveApproval = assembled && hasAsset && !hasBlockingError && !skippedByDrain && evaluatedByDrain
      ? (await reelApprovalProblem({ jobId: Number(row.id), caption: String(row.caption), videoUrl: String(row.mp4Url) })) === null
      : false;
    if (readyCandidateIsUsable({ status: String(row.status), hasAsset, hasBlockingError, hasLiveApproval, skippedByDrain, evaluatedByDrain })) usable += 1;
    if (usable >= REEL_READY_TARGET) break;
  }
  return usable;
}

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

/**
 * NT-001 (2026-08-13) · shadow-judge input for an assembled reel, pure so the
 * payload-parsing edge cases are testable without the cron flow. The reel
 * lane's rendered-QA is a DEFECT detector (garbled pixels, gloved hands); the
 * independent judge is a JUDGMENT check (generic concept, weak hook) — the
 * image lane's judge caught 5/25 self-eval passes. A reel payload can be
 * 70KB+ or unparseable; either way this must return something judgeable and
 * NEVER throw — a broken brief JSON is not a reason to skip the readout.
 */
export function buildReelShadowJudgeInput(job: {
  id: number;
  briefId: string;
  payload: string | null;
  caption: string;
}): {
  campaignAsk: string;
  concept: { title: string; hook: string; coreIdea: string; visualIdea: string; whyItWorks: string };
} {
  let title = job.briefId;
  let visualIdea = "assembled faceless reel (free lane)";
  // parseReelJobPayload never throws (returns {} on unparseable JSON), so
  // this stays the "judge on the caption alone" path without a try/catch —
  // the empty-view case IS the unparseable case.
  const brief = parseReelJobPayload(job.payload);
  if (brief.topic?.trim()) title = brief.topic.trim();
  const visual = [brief.archetype, brief.objectCharacter].filter((v): v is string => Boolean(v)).join(" · ");
  if (visual) visualIdea = visual;
  const caption = job.caption || title;
  return {
    campaignAsk: `Autonomous daily Instagram REEL for the shop feed (job ${job.id})`,
    concept: {
      title,
      hook: caption.split("\n")[0] || caption.slice(0, 120),
      coreIdea: caption,
      visualIdea,
      whyItWorks: "shadow readout — the reel lane has no self-eval notes to quote",
    },
  };
}

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

/**
 * Terminal-refusal rotation advance. The decision and the write live in
 * services/approvedReelPackRotation so they can be exercised directly against a
 * mocked database — an earlier version lived inline here and was covered only
 * by tests that matched source text, which stay green if the write never
 * persists. This is now just "pull the slug off the job and delegate".
 */
async function advancePastRefusedPack(job: { id: number; payload: string | null }, reason: string): Promise<void> {
  const payload = parseReelJobPayload(job.payload);
  await advanceRotationPastRefusedPack({
    jobId: job.id,
    jobPackSlug: payload.approvedPackSlug,
    jobPackPool: payload.approvedPackPool,
    jobSlateRevision: payload.approvedPackSlateRevision,
    reason,
  });
}

/** The approved-pack lane shares the one-post-per-day date, but not the legacy
 * manifest index. Advancing the latter while an approved pack posts would
 * silently skip an untouched manifest item. */
async function setApprovedPackProgress(idx: number, date: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  await d.transaction(async (tx: any) => {
    await tx.insert(shopSettings).values({
      key: "reel_approved_pack_rotation_index",
      value: String(idx),
      label: "Approved Reel-pack rotation — next pack index",
      category: "general",
      updatedBy: "system",
    }).onDuplicateKeyUpdate({ set: { value: String(idx), updatedBy: "system" } });
    await tx.insert(shopSettings).values({
      key: "reel_autopost_last_date",
      value: date,
      label: "Daily reel autopost — last post date (ET)",
      category: "general",
      updatedBy: "system",
    }).onDuplicateKeyUpdate({ set: { value: date, updatedBy: "system" } });
  });
}

/** Active slate is an overlay: advance its own cursor without touching the
 * canonical approved-library cursor. The one-post-per-day date is still shared. */
async function setActiveSlateProgress(idx: number, date: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  await d.transaction(async (tx: any) => {
    await tx.insert(shopSettings).values({
      key: ACTIVE_REEL_SLATE_CURSOR_KEY,
      value: String(idx),
      label: "Instagram active Reel slate — next item index",
      category: "general",
      updatedBy: "system",
    }).onDuplicateKeyUpdate({ set: { value: String(idx), updatedBy: "system" } });
    await tx.insert(shopSettings).values({
      key: "reel_autopost_last_date",
      value: date,
      label: "Daily reel autopost — last post date (ET)",
      category: "general",
      updatedBy: "system",
    }).onDuplicateKeyUpdate({ set: { value: date, updatedBy: "system" } });
  });
}

async function setAutopostDate(date: string): Promise<void> {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return;
  await d.insert(shopSettings).values({
    key: "reel_autopost_last_date",
    value: date,
    label: "Daily reel autopost — last post date (ET)",
    category: "general",
    updatedBy: "system",
  }).onDuplicateKeyUpdate({ set: { value: date, updatedBy: "system" } });
}

function etNow(): { date: string; hour: number } {
  const now = new Date();
  const date = now.toLocaleDateString("en-CA", { timeZone: BUSINESS.timezone }); // YYYY-MM-DD
  const hour = parseInt(now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }), 10);
  return { date, hour };
}

/** Which platforms the nightly reel goes to. Instagram always; Facebook only when
 *  REEL_FB_CROSSPOST_ENABLED is exactly "true" (the Page gate inside publishToSocial
 *  still requires REEL_PUBLISH_ENABLED and the claim check on the FB caption). */
export function reelPublishPlatforms(env: NodeJS.ProcessEnv = process.env): ("instagram" | "facebook")[] {
  return env.REEL_FB_CROSSPOST_ENABLED === "true" ? ["instagram", "facebook"] : ["instagram"];
}

/** publishToSocial posts Facebook BEFORE Instagram, so "FB live, IG not" is a real
 *  outcome. Releasing the claim then would republish the Page on the next tick.
 *  An ambiguous Facebook finish (the publish call got no answer after the upload)
 *  may be live too, so it parks the same way (2026-10-01, review of #2865). */
export function facebookLiveWithoutInstagram(
  results: ReadonlyArray<{ platform: string; success: boolean; postId?: string; ambiguous?: boolean }>,
): string | null {
  const fb = results.find((r) => r.platform === "facebook");
  const ig = results.find((r) => r.platform === "instagram");
  if (ig?.success) return null;
  if (fb?.success) return fb.postId ?? "(no id returned)";
  if (fb?.ambiguous) return `${fb.postId ?? "(no id returned)"}, publish unanswered: may be live`;
  return null;
}

export async function runDailyReelPost(): Promise<{ recordsProcessed?: number; details?: string }> {
  if (process.env.REEL_AUTOPOST_ENABLED !== "true") {
    return { recordsProcessed: 0, details: "disabled (REEL_AUTOPOST_ENABLED != true)" };
  }

  const { date, hour } = etNow();

  // POLICY-RECORDED CONSENT, on EVERY tick — before the already-posted-today
  // return, not after it. When autonomy_policy.formatPermissions.reel is
  // "auto", every assembled reel with no live approval gets one through
  // recordReelApproval — same writer, same binding, same veto — so the drain
  // below (which selects on approval rows) can carry it. Running it ahead of
  // the daily short-circuit means a reel assembled at 15:00 is approved at
  // 16:00, not at tomorrow's first tick (2026-09-08: the first live tick after
  // #2217 returned "already posted today" and left 1890003 unapproved for
  // 20 hours). Any other policy value makes this a no-op. Failure here must
  // not stop the cron: an unapproved reel is simply held, as before.
  try {
    const { autoApproveAssembledReels } = await import("../../services/reelAutoApproval");
    await autoApproveAssembledReels();
  } catch (err) {
    log.warn("daily reel: auto-approval pass failed — reels stay held, cron continues", { err: err instanceof Error ? err.message : String(err) });
  }

  const lastDate = await getKv("reel_autopost_last_date");
  if (lastDate === date) {
    return { recordsProcessed: 0, details: `already posted today (${date})` };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "DB not available" };

  const briefId = `autopost-${date}`;
  const jobs = await d.select().from(reelJobs).where(eq(reelJobs.briefId, briefId)).limit(1);
  const todaysJob = jobs[0];
  let job: typeof todaysJob | undefined = undefined;
  let drainedFrom: string | null = null;

  // DRAIN THE BACKLOG FIRST. The lookup above is scoped to TODAY's briefId, so a
  // job assembled on a previous day (briefId autopost-<that day>) is never
  // selected again and its finished mp4 never publishes - even though the
  // comment below correctly states that publishing an assembled job is meant to
  // run on ANY pulse. Measured in prod 2026-08-28: 10 jobs stuck in "assembled",
  // every one with mp4Url set, oldest 2026-08-20, eight of them with no error at
  // all, while daily-reel-post ran 704 times. Those are finished videos that
  // could have posted. Oldest first, so the queue drains FIFO.
  //
  // THE DRAIN SELECTS ONLY APPROVED JOBS, and that is load-bearing rather than
  // belt-and-braces. The per-job approval gate further down returns WITHOUT
  // advancing an index, so a plain oldest-first drain parks on the first
  // unapproved job and never looks past it - head-of-line blocking. That is
  // exactly the pathology this whole change exists to remove: before it, the
  // queue was pinned on job 1710001 (stock-contaminated) and nothing behind it
  // could ever move. Selecting on approval means approving the ninth job in the
  // queue actually publishes the ninth job, instead of silently doing nothing.
  //
  // A missing approvals table (the DDL is hand-applied and may not have run)
  // yields an empty set, so nothing drains. That is the correct safe state.
  //
  // ── 2026-09-07 · THE DRAIN NOW RUNS BEFORE TODAY'S JOB IS CONSIDERED ──
  //
  // It used to be `if (!job)` against a lookup for `autopost-<today>`, so the
  // drain only ran until the enqueue branch created today's row. After that,
  // every remaining pulse THAT DAY found today's job and skipped the drain
  // entirely — a master approved at 10am waited until tomorrow. That is the
  // same head-of-line pathology the drain was written to remove, reintroduced
  // one branch upstream. An approved, finished reel outranks starting a new one.
  // Every approved job the drain refuses on this pulse, by id. The READY count
  // further down reads it so production and the drain agree on what is usable.
  let drainSkippedIds: ReadonlySet<number> = new Set();
  let drainEvaluatedIds: ReadonlySet<number> = new Set();
  {
    let approvedJobIds: number[] = [];
    try {
      // Annotated because the shared db handle is loosely typed here, so a
      // projected select widens to unknown[].
      const rows: Array<{ jobId: number }> = await d
        .select({ jobId: reelPublishApprovals.reelJobId })
        .from(reelPublishApprovals)
        .where(isNull(reelPublishApprovals.revokedAt));
      approvedJobIds = [...new Set(rows.map((r) => r.jobId))];
    } catch (err) {
      log.warn("daily reel: approvals table unreadable — no reel is drainable", {
        err: err instanceof Error ? err.message : String(err),
      });
      approvedJobIds = [];
    }

    // inArray([]) is not a safe "match nothing" in every dialect, so the empty
    // case skips the query outright rather than relying on generated SQL.
    // SCAN, don't peek. This used to take `.limit(1)` — the oldest approved
    // assembled job — and hand it to the per-job gate below, which returns
    // WITHOUT advancing. But a row can carry a live-looking approval and still
    // fail that gate: the approval binds to exact caption bytes and the exact
    // asset URL, and it EXPIRES (REEL_APPROVAL_TTL_HOURS, default 72). So an
    // approval that has aged out, or a job whose caption was edited after
    // approval, sat at the head of the queue and blocked every valid reel
    // behind it — the same failure the approval-scoped select was meant to fix,
    // one layer down.
    //
    // So: take a bounded window of candidates, and pick the first that ACTUALLY
    // passes the gate. Bounded because this runs on every pulse and each
    // candidate costs one approval read; 25 is far above the observed backlog
    // (10 stuck jobs, measured 2026-08-28) and far below a runaway scan.
    //
    // Critically, an ineligible candidate is SKIPPED, never published. This
    // advances past a blocked item without weakening a single gate — the
    // per-job gate below still runs on whatever is chosen.
    const DRAIN_SCAN_LIMIT = 25;
    const candidates = approvedJobIds.length
      ? await d
          .select()
          .from(reelJobs)
          .where(
            and(
              eq(reelJobs.status, "assembled"),
              isNotNull(reelJobs.mp4Url),
              ne(reelJobs.mp4Url, ""),
              inArray(reelJobs.id, approvedJobIds),
            ),
          )
          .orderBy(asc(reelJobs.id))
          .limit(DRAIN_SCAN_LIMIT)
      : [];

    const skipped: Array<{ jobId: number; code: string }> = [];

    // TERMINAL-GATE PRE-FILTER. The approval check alone is not enough to pick a
    // candidate: an APPROVED job can still be refused downstream by a verdict
    // that will never change, and because the gate chain below returns from the
    // handler rather than trying the next job, one such candidate jams the drain
    // for every reel behind it. Live example this was written against: job
    // 1740003 was approved by the operator and is a 0.99 caption repost of a
    // published post, so it was selected on every pulse and nothing else could
    // ever be drained.
    //
    // Only the two PURE, PERMANENT verdicts are pre-checked — a repost and a
    // condemned script. Both read the same tomorrow. Transient states
    // (rendered-QA, auto-repair) are deliberately NOT pre-checked: they belong
    // to the gate chain, which remains the authority. This filter only decides
    // what is worth SELECTING; nothing here can let a reel through that the
    // chain would refuse.
    //
    // The corpus is loaded once per drain, and only when there is something to
    // drain, so a quiet day costs no extra read.
    const { originalityProblem } = await import("@shared/reelOriginality");
    const { loadPublishedCorpus } = await import("../../services/reelOriginality");
    const drainCorpus = candidates.length ? await loadPublishedCorpus() : [];

    for (const candidate of candidates) {
      const caption = typeof candidate.caption === "string" ? candidate.caption : "";
      const videoUrl = typeof candidate.mp4Url === "string" ? candidate.mp4Url : "";
      if (!caption.trim() || !videoUrl.trim()) {
        skipped.push({ jobId: candidate.id, code: "missing_caption_or_asset" });
        continue;
      }
      let problem: Awaited<ReturnType<typeof reelApprovalProblem>> = null;
      try {
        problem = await reelApprovalProblem({ jobId: candidate.id, caption, videoUrl });
      } catch (err) {
        // An unreadable approval is NOT an approval. Fail closed and keep
        // scanning — reelApproval.ts already fails closed internally, this
        // guards the loop itself.
        skipped.push({ jobId: candidate.id, code: "approval_read_failed" });
        log.warn("daily reel: approval read failed while draining", {
          jobId: candidate.id,
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      if (problem) {
        skipped.push({ jobId: candidate.id, code: problem.code });
        continue;
      }

      // INVENTORY HOLD. The Queue row is where the operator rejects a reel and
      // where the Queue/Trial doors publish it. A rejected, already-published,
      // publishing or ambiguous row means this job must not go out from here —
      // and it reads the same on every pulse, so it is skipped, not selected.
      // An unreadable row is skipped too: fail closed.
      {
        let hold: string | null;
        try {
          const { reelInventoryHold } = await import("../../services/reelInventoryLink");
          hold = await reelInventoryHold(d, candidate.briefId);
        } catch {
          hold = "unreadable";
        }
        if (hold) {
          skipped.push({ jobId: candidate.id, code: `inventory_${hold}` });
          continue;
        }
      }

      const cPayload = parseReelJobPayload(candidate.payload);
      const cOnScreen = (cPayload.storyboardBeats ?? []).map((b) => b?.onScreenText ?? "").filter(Boolean).join(" ");
      const cCondemned = condemnedContentProblem({ voiceover: cPayload.voiceoverScript, onScreenText: cOnScreen });
      if (cCondemned) {
        skipped.push({ jobId: candidate.id, code: "condemned_script" });
        continue;
      }
      const cDupe = originalityProblem(
        { onScreenText: cOnScreen, caption, videoUrl },
        drainCorpus.filter((p) => p.label !== `reel job ${candidate.id}`),
      );
      if (cDupe) {
        skipped.push({ jobId: candidate.id, code: `repost:${cDupe.surface}` });
        continue;
      }

      // PARKED-QA PRE-FILTER. The comment above says rendered-QA states are
      // "transient" and belong to the gate chain. That is true of auto_repair
      // (the chain queues the free repair and the verdict changes by itself)
      // and of a verdict not yet computed. It is NOT true of the states that
      // wait on a human: needs_paid_repair parks until an operator authorizes
      // spend; reject and stock_fallback park until the reel is regenerated.
      // Those read identically on every future pulse, so a candidate in one of
      // them is exactly the jam this pre-filter exists to prevent.
      //
      // Live example this was written against: job 1890002 (autopost-2026-09-09)
      // came back from the vision critic with three BLOCK findings - the hero
      // object changes from a compact spare to a full-size tire mid-reel - which
      // route to a PAID beat regeneration. It was selected on every pulse on
      // 2026-09-09 and held, so NOTHING posted that day while 29 other reels sat
      // approved behind it with a clean "approve" verdict.
      //
      // Read-only on purpose: runIfMissing:false reuses the persisted verdict and
      // never runs QA here, so this filter cannot spend money, cannot mutate the
      // job, and cannot manufacture a verdict. A candidate whose QA has not run
      // yet returns "unavailable" and is deliberately NOT skipped - that one IS
      // transient and still belongs to the chain, unchanged.
      //
      // Nothing here can let a reel through that the chain would refuse: the full
      // gate still runs on whatever is selected. This only decides what is worth
      // SELECTING.
      try {
        const { evaluateReelPublishGate } = await import("../../services/qualityGate");
        const cGate = await evaluateReelPublishGate(candidate.id, { runIfMissing: false });
        if (!cGate.allowed && PARKED_QA_GATES.has(cGate.gate)) {
          skipped.push({ jobId: candidate.id, code: `qa_parked:${cGate.gate}` });
          continue;
        }
        if (!cGate.allowed && cGate.gate === "unavailable" && staleUnavailable(candidate)) {
          skipped.push({ jobId: candidate.id, code: "qa_parked:unavailable_stale" });
          continue;
        }
      } catch (err) {
        // A gate that cannot be READ is not a gate that passed, but it is also
        // not evidence against this candidate: leave it selectable and let the
        // authoritative chain below decide (it fails closed on error).
        log.warn("daily reel: parked-QA pre-filter read failed; leaving candidate selectable", {
          jobId: candidate.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }

      job = candidate;
      drainedFrom = candidate.briefId;
      break;
    }

    drainSkippedIds = new Set(skipped.map((s) => s.jobId));
    drainEvaluatedIds = new Set(candidates.map((c: { id: number }) => Number(c.id)));
    if (skipped.length) {
      // Visible, because a queue that silently skips is how the last one hid.
      log.info("daily reel: skipped ineligible approved jobs while draining", {
        skipped: skipped.slice(0, 10),
        totalSkipped: skipped.length,
        scanned: candidates.length,
        selected: job?.id ?? null,
      });
    }
    if (job) {
      log.info("draining assembled reel job from a previous day", {
        jobId: job.id,
        briefId: job.briefId,
        today: briefId,
        skippedAhead: skipped.length,
      });
    }
  }

  // Today's job is the fallback, not the priority: finishing an approved reel
  // beats starting a new one.
  //
  // BUT IT GETS THE SAME PARKED-QA PRE-FILTER THE DRAIN GETS.
  //
  // The drain skips a candidate parked on needs_paid_repair / reject /
  // stock_fallback, because those wait on a human and read identically on every
  // future pulse. Today's job reached `job` without that check, so the exact
  // head-of-line stall the pre-filter exists to prevent survived on this one
  // branch: a parked today's-job is re-selected every pulse, refused by the
  // chain, and the whole lane stalls behind it for the rest of the ET day.
  //
  // Read-only (`runIfMissing: false`), same as the drain: this cannot run QA,
  // spend, or mutate. An unreadable gate leaves the job selectable and lets the
  // authoritative chain below decide, which fails closed on its own.
  if (!job && todaysJob) {
    let parked: string | null = null;
    try {
      const { evaluateReelPublishGate } = await import("../../services/qualityGate");
      const g = await evaluateReelPublishGate(todaysJob.id, { runIfMissing: false });
      if (!g.allowed && PARKED_QA_GATES.has(g.gate)) parked = g.gate;
      else if (!g.allowed && g.gate === "unavailable" && staleUnavailable(todaysJob)) parked = "unavailable_stale";
    } catch (err) {
      log.warn("daily reel: parked-QA check on today's job failed; leaving it selectable", {
        jobId: todaysJob.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
    if (parked) {
      log.info("daily reel: today's job is parked awaiting a human — not selecting it", {
        jobId: todaysJob.id, gate: parked,
      });
      return {
        recordsProcessed: 0,
        details: `today's job ${todaysJob.id} parked (qa_parked:${parked}) and no drainable backlog; index not advanced`,
      };
    }
    job = todaysJob;
  }

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
      if (times.length && Number.isInteger(times[0].hourOfDay) && times[0].hourOfDay >= 0 && times[0].hourOfDay <= 23) {
        targetHour = times[0].hourOfDay;
      }
    } catch (err) {
      log.warn("best-posting-time lookup failed; using default hour", { err: err instanceof Error ? err.message : String(err) });
    }
    const normalizedTargetHour = normalizeProductionTargetHour(targetHour);
    if (hour !== normalizedTargetHour) {
      return { recordsProcessed: 0, details: `not production hour (ET ${hour}:00, want ${normalizedTargetHour}:00; analytics selected ${targetHour}:00) — waiting to enqueue` };
    }
    const idx = parseInt((await getKv("reel_autopost_index")) || "0", 10) || 0;
    const approvedPackCursor = await getKv("reel_approved_pack_rotation_index");
    const approvedPackIndex = resolveApprovedPackRotationIndex(approvedPackCursor);
    const activeSlate = await readActiveReelSlate(d);
    const packSelection = resolveApprovedPackSelection(approvedPackIndex, activeSlate);
    const approvedPack = packSelection.pack;
    if (packSelection.state === "cursor_invalid") {
      log.error("approved-pack rotation index is malformed — leaving its cursor untouched", {});
    }
    if (packSelection.state === "slate_malformed") {
      log.error("active Reel slate is malformed — production holds instead of bypassing operator selection", {});
      return { recordsProcessed: 0, details: "held: active Reel slate is malformed; save a valid slate in Instagram → Strategy" };
    }
    if (packSelection.state === "slate_exhausted") {
      return {
        recordsProcessed: 0,
        details: `held: active Reel slate exhausted at index ${packSelection.index} of ${activeSlate.slugs.length}; refresh/reorder the slate in Instagram → Strategy`,
      };
    }
    if (!approvedPack && idx >= MANIFEST.length) {
      return { recordsProcessed: 0, details: `campaign complete (${MANIFEST.length}/${MANIFEST.length} posted)` };
    }

    // Production is allowed to refill only a genuinely low READY buffer. This
    // is intentionally separate from the publication schedule: an assembled
    // episode can wait for its exact human approval while production remains
    // paused once usable inventory is above the low-watermark.
    const usableReadyCount = await countUsableReadyEpisodes(d, drainSkippedIds, drainEvaluatedIds);
    const readyDecision = decideReadyBuffer(usableReadyCount, REEL_READY_TARGET, REEL_READY_LOW_WATERMARK);
    if (readyDecision !== "refill") {
      return {
        recordsProcessed: 0,
        details: `production held: usable READY buffer ${usableReadyCount >= REEL_READY_TARGET ? `>=${REEL_READY_TARGET}` : usableReadyCount} (${readyDecision}); publication remains separately approval-gated`,
      };
    }

    // Topic authority is the LIVE MINER, not the hardcoded manifest. The
    // manifest is a fixed campaign list written once; it cannot know what
    // performed, what reviews said, what season it is, or what has already been
    // covered. It stays ONLY as a last resort so a signal outage cannot stall
    // the daily reel — and when it is used, the result says so.
    let topic = approvedPack?.topic ?? "";
    let topicOrigin = approvedPack ? `approved_pack:${approvedPack.slug}` : "miner";
    if (approvedPack) {
      log.info("daily reel topic from approved pack selection", {
        slug: approvedPack.slug,
        index: packSelection.index,
        topic,
        pool: packSelection.state,
        poolSize: packSelection.state === "active_slate" ? activeSlate.slugs.length : APPROVED_REEL_PACKS.length,
      });
    } else {
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
    }
    if (!topic) {
      const { caption: manifestCaption } = MANIFEST[idx];
      topic = manifestCaption.split("\n")[0] || manifestCaption;
      topicOrigin = "manifest_fallback";
    }

    let prepared: { brief: Record<string, any>; attempts: number };
    if (approvedPack) {
      // An approved pack is already production input. Do not reduce it to a
      // topic and ask a fresh model to replace the reviewed beats/caption.
      const baseSnapshot = loadApprovedProductionPack(approvedPack.slug);
      // Pack-build experiments (06-EXPERIMENTS): visual_direction_v1 picks the
      // lens family, a pack_variant experiment (#1/#4) builds an approved variant.
      // Both are resolved here, before the build, on the episode key enqueue
      // records with; undefined (the default, or an unreadable store) builds the
      // base pack with the full lens pick. The arms actually applied are stamped
      // on the brief, and enqueue records only those (recorded must equal built).
      const { visualDirectionForEpisode, packVariantForEpisode } = await import("../../services/contentExperimentStore");
      const visual = baseSnapshot ? await visualDirectionForEpisode(briefId) : undefined;
      const variantArm = baseSnapshot ? await packVariantForEpisode(briefId) : undefined;
      const variantSnapshot = variantArm
        ? approvedVariantSnapshot(variantArm.applied.experimentId, approvedPack.slug, variantArm.applied.armId, variantArm.armIds)
        : null;
      const snapshot = variantSnapshot ?? baseSnapshot;
      const packBrief = snapshot
        ? buildBriefFromApprovedProductionPack(approvedPack, snapshot, briefId, false, visual?.direction)
        : null;
      if (packBrief) {
        const appliedPackArms = [
          ...(visual ? [visual.applied] : []),
          ...(variantSnapshot && variantArm ? [variantArm.applied] : []),
        ];
        if (appliedPackArms.length) (packBrief as { appliedPackArms?: typeof appliedPackArms }).appliedPackArms = appliedPackArms;
      }
      if (!snapshot || !packBrief) {
        return {
          recordsProcessed: 0,
          details: `held: approved pack ${approvedPack.slug} has no complete machine-readable production input; no topic-only regeneration`,
        };
      }
      (packBrief as { approvedProductionPack?: unknown }).approvedProductionPack = snapshot;
      prepared = { brief: packBrief, attempts: 0 };
      log.info("daily reel using exact approved production pack contents", {
        slug: approvedPack.slug,
        contentSha256: snapshot.contentSha256,
      });
    } else {
      try {
      log.info(`Generating fresh dynamic storyboard brief for topic: "${topic}"`);
      // Regenerate on a preflight block: generateReelBriefAI is non-deterministic
      // and a brief that trips the M10 preflight (in-frame-text / free-claim) would
      // otherwise silently cost the day's reel (this cron generates once). The
      // helper retries and only attaches the visual-world anchor (flag-gated
      // REEL_AUTO_VISUAL_WORLD) + builds the prompt pack for a brief that passed.
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
      // The pack lane and this lane were mutually invisible until 2026-08-16:
      // scheduled agent runs commit production packs to docs/reel-packs/ for
      // HUMAN review, this cron posts autonomously, and nothing under server/
      // referenced that directory. On 2026-08-16 two scheduled runs produced the
      // same battery topic within two hours while this cron remained free to
      // pick it a third time. Adding covered topics to the avoid-list is the
      // whole bridge — packs stay a review queue, they just stop colliding.
      let packTopics: string[] = [];
      try {
        const { packCoveredTopics } = await import("../../services/reelPackRegistry");
        packTopics = packCoveredTopics(30);
        if (packTopics.length) log.info("avoiding topics already covered by committed packs", { count: packTopics.length });
      } catch (err) {
        log.warn("pack registry unavailable — proceeding without pack awareness", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      prepared = await prepareCleanReelBrief(
          { topic, hookStyle, ...(packTopics.length ? { additionalAvoidTopics: packTopics } : {}) },
          { maxAttempts: 6 },
        );
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
    }
    const { brief } = prepared;
    brief.id = briefId;
    if (approvedPack) {
      const approvedPackPool = packSelection.state === "active_slate"
        ? "active_slate"
        : "full_approved_library";
      (brief as { approvedPackSlug?: string }).approvedPackSlug = approvedPack.slug;
      (brief as { approvedPackPool?: "active_slate" | "full_approved_library" }).approvedPackPool = approvedPackPool;
      if (approvedPackPool === "active_slate") {
        (brief as { approvedPackSlateRevision?: string }).approvedPackSlateRevision = activeSlate.updatedAt ?? undefined;
      }
      (brief as { productionSlot?: string }).productionSlot = productionSlotForHour(normalizedTargetHour);
    }

    // The brief's factual spine, joined to real evidence records. mechanicTruth
    // becomes the claim; proof-kind sourceNotes become handles the resolver
    // turns into entailment-bearing records. Nothing is invented here — a brief
    // with no resolvable proof yields a claim with no citations, and preflight
    // is what decides whether that may ship.
    const { buildClaimsFromBrief } = await import("../../services/episodeClaims");
    const claimPacket = await buildClaimsFromBrief(brief as never);
    log.info("episode claim packet", {
      briefId,
      claims: claimPacket.claims.length,
      evidence: claimPacket.evidence.length,
      entailment: claimPacket.evidence.map((e) => e.entailment),
      rejected: claimPacket.rejected,
    });

    // Declared, not defaulted. `visibly_animated` is a real assertion about
    // this pipeline's output — fully generated, no photorealistic human
    // footage — and it is what decides whether Meta AI disclosure is mandatory.
    // ─── ENQUEUE PREFLIGHT CAN REFUSE, AND A REFUSED *PACK* MUST NOT JAM ───
    //
    // Review P1 on #2171, and it is the rotation deadlock of 089823177 coming
    // back through a different door. `enqueueReelJob` runs runReelPreflight and
    // THROWS before persisting anything, while `advancePastRefusedPack` needs a
    // job row — so an approved pack that fails preflight left the cursor
    // untouched and every later pulse re-picked the same pack forever. The
    // 35s-ceiling change made that reachable: the new voiceover-fits-render gate
    // refuses packs that used to enqueue.
    //
    // A content verdict is TERMINAL for that pack (retrying it unchanged can
    // never succeed), so the rotation advances past it and the run ends as a
    // legible skip. Every OTHER failure still throws: a provider outage or DB
    // fault is transient and must stay loud, which is why this catches the
    // TYPED error and nothing wider.
    let jobId: number;
    try {
      ({ jobId } = await enqueueReelJob(brief, "cron", {
      objective: "DISCOVERY",
      disclosureMode: "visibly_animated",
      // ReelBrief (the generator's shape) has no ctaType yet — the generated
      // caption carries its ask in prose. Declared NONE rather than guessed, so
      // the governor's repetition check is not fed a fabricated CTA.
      ctaType: (brief as { ctaType?: "SEND" | "SAVE" | "COMMENT" | "VISIT" | "FOLLOW" | "NONE" }).ctaType ?? "NONE",
      productionSlot: productionSlotForHour(normalizedTargetHour),
      // DUE-AT for this reel. The approved-pack lane knows its position in the
      // rotation, so it can say WHEN this one is meant to go out instead of
      // leaving the intent null and discovering lateness only in hindsight.
      // The miner lane deliberately gets none: an ad-hoc topic has no queue
      // position, and a fabricated deadline is worse than an absent one.
      ...(approvedPack
        ? {
            publicationIntendedAt:
              reelPublicationIntentFor(0, new Date()) ?? undefined,
          }
        : {}),
      ...(approvedPack
        ? { approvedProductionPack: (brief as { approvedProductionPack?: import("@shared/episodeContract").ApprovedProductionPackSnapshot }).approvedProductionPack }
        : {}),
      claims: claimPacket.claims,
      evidence: claimPacket.evidence,
      }));
    } catch (err) {
      const { ReelPreflightBlockedError } = await import("../../services/reelPipeline");
      if (!(err instanceof ReelPreflightBlockedError)) throw err;
      if (!approvedPack) {
        // Miner lane: prepareCleanReelBrief regenerates on every refusal enqueue
        // can make from the brief alone (reelEnqueueRefusals), so reaching here
        // is a check it cannot run first (the episode contract's claim checks).
        // No cursor to move; logged as an error so a lost day is not a quiet skip.
        log.error("daily reel: mined brief refused at enqueue preflight", { briefId, blocking: err.blocking });
        return { recordsProcessed: 0, details: `skipped — enqueue preflight blocked: ${err.message}` };
      }
      await advanceRotationPastRefusedPack({
        jobPackSlug: approvedPack.slug,
        jobPackPool: packSelection.state === "active_slate" ? "active_slate" : "full_approved_library",
        jobSlateRevision: packSelection.state === "active_slate" ? activeSlate.updatedAt : null,
        reason: `enqueue preflight blocked: ${err.blocking.join("; ")}`,
      });
      log.warn("daily reel: approved pack refused at enqueue preflight — rotation advanced past it", {
        slug: approvedPack.slug, briefId, blocking: err.blocking,
      });
      return {
        recordsProcessed: 0,
        details: `skipped — approved pack ${approvedPack.slug} blocked at enqueue preflight, rotation advanced: ${err.message}`,
      };
    }
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

    // ── INVENTORY GATE: the Queue row has the last word ─────────────────────
    // Same check as the drain pre-filter, applied to WHATEVER was selected
    // (today's job reaches here without the drain). A reel the operator
    // rejected in the Queue, or one already published / publishing / possibly
    // live through the Queue or Trial doors, is held. FIRST in the assembled
    // branch, before the rendered-QA gate: that gate can queue an auto-repair,
    // and a re-assembly resets the inventory row to review_ready — which would
    // quietly un-reject the reel. Fail closed on a read error. Not terminal:
    // the index is not advanced.
    {
      let hold: string | null;
      try {
        const { reelInventoryHold } = await import("../../services/reelInventoryLink");
        hold = await reelInventoryHold(d, job.briefId);
      } catch {
        hold = "unreadable";
      }
      if (hold) {
        const note = `HELD: Queue inventory row ${job.briefId} is '${hold}' — the autonomous lane will not publish it`.slice(0, 1000);
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.warn(`daily reel: job ${job.id} held by its inventory row (${hold})`);
        return { recordsProcessed: 0, details: `held: job ${job.id} inventory is ${hold}; index not advanced` };
      }
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
        // auto_repair is a WORK ORDER, not a hold: every block finding routes to
        // a fix that costs nothing (deterministic, or a $0 regen on the free
        // lane). Before this branch existed the gate could SAY auto_repair and
        // nothing consumed it — only the operator tRPC ever queued a repair, so
        // an autonomous reel sat exactly as held as needs_paid_repair. Queue the
        // first regenerable beat through the SAME requestBeatRepair the operator
        // button uses (one-in-flight, cost boundary, repair cap all enforced
        // there); the pipeline cron renders it, assembly re-runs, rendered QA
        // re-verdicts the new mp4, and a later pulse publishes only if THAT
        // passes. A failure to queue is a plain hold — never a publish.
        // needs_paid_repair is auto_repair that happens to cost money. Both are
        // "a known defect with a known fix"; the only difference is whether the
        // fix touches the provider. When policy says spend, they take the SAME
        // path below - requestBeatRepair prices the beat at the active provider
        // and calls enforceAtBoundary with today's real spend, so
        // maxGenerationCostPerDayUsd and maxRepairAttemptsPerAsset remain the
        // ceilings and a breach is refused into the ordinary hold.
        //
        // Reading policy failure as "do not spend" is deliberate: an unreadable
        // policy must never authorize money.
        let paidRepairAllowed = false;
        // The per-asset repair cap the publish gate also reads; 2 is that gate's
        // own fallback when the policy is unreadable.
        let paidRepairCap = 2;
        if (g.gate === "needs_paid_repair") {
          try {
            const { getActivePolicy } = await import("../../services/autonomyControl");
            const pol = await getActivePolicy();
            paidRepairAllowed = pol?.autonomousRepair?.paidBeatRegeneration === "auto";
            const cap = Number(pol?.limits?.maxRepairAttemptsPerAsset);
            if (Number.isInteger(cap) && cap >= 0) paidRepairCap = cap;
          } catch (polErr) {
            log.warn("daily reel: could not read autonomousRepair policy — treating as approval_required", {
              err: polErr instanceof Error ? polErr.message : String(polErr),
            });
          }
        }
        if (g.gate === "auto_repair" || paidRepairAllowed) {
          try {
            const { pickRepairTarget, paidRepairCanClearVerdict } = await import("../../services/repairRouter");
            const { beatRepairRefusal } = await import("../../services/selectiveRepair");
            // The executor's own per-beat rule, so the cron never chooses or
            // approves a beat requestBeatRepair would refuse.
            const isRepairable = (beat: number) => beatRepairRefusal(parseReelJobPayload(job.payload), beat, job.id) === null;
            // SPEND ONLY ON A REPAIR THAT CAN WORK. Each paid attempt regenerates
            // one beat. If the blocking findings span more beats than attempts
            // remain, or name no beat at all, the re-render cannot pass and the
            // credits are waste: job 2040001 (2026-10-08) had blocks on beats
            // 1, 2, 4, 5 plus asset-level blocks, spent 12 credits on beat 2,
            // and scored worse. Hold it for a human instead: rebuild or retire.
            if (g.gate === "needs_paid_repair") {
              const plan = paidRepairCanClearVerdict(g.findings, { repairAttempts: g.repairAttempts, maxRepairAttempts: paidRepairCap }, {}, isRepairable);
              if (!plan.clearable) {
                log.warn(`daily reel: paid repair declined for job ${job.id} — ${plan.reason}`, {
                  blockedBeats: plan.blockedBeats,
                  assetLevelBlocks: plan.assetLevelBlocks,
                  remainingAttempts: plan.remainingAttempts,
                });
                return {
                  recordsProcessed: 0,
                  details: `held: paid repair cannot clear job ${job.id}'s verdict (${plan.reason}); rebuild or retire it; index not advanced`,
                };
              }
            }
            // Lowest blocked beat first: later beats are judged against it.
            const target = pickRepairTarget(g.findings, {}, isRepairable);
            if (target) {
              const { requestBeatRepair } = await import("../../services/selectiveRepair");
              // The cron is NOT an operator. Passing the real actor keeps the
              // spend boundary fail-closed and denies this path a human's
              // implied approval — see requestBeatRepair's `actor` docstring.
              const r = await requestBeatRepair({
                jobId: job.id,
                beatNumber: target.beatNumber as number,
                actor: { type: "cron", id: `daily-reel-post:job_${job.id}` },
              });
              log.info(`daily reel: auto-repair queued (${g.gate === "auto_repair" ? "free lane" : "POLICY-AUTHORIZED PAID"}) — beat ${r.beatNumber} on job ${job.id}`, { code: target.code, gate: g.gate });
              return { recordsProcessed: 0, details: `auto-repair queued for beat ${r.beatNumber} on job ${job.id} (${target.code}); re-verdict after re-render; index not advanced` };
            }
            // No regenerable beat-targeted finding: deterministic-only plan with
            // no beat target is not queueable from here — hold for the operator.
          } catch (repairErr) {
            const msg = repairErr instanceof Error ? repairErr.message : String(repairErr);
            log.warn(`daily reel: auto-repair queue failed for job ${job.id} — holding`, { err: msg });
            return { recordsProcessed: 0, details: `held: auto-repair queue failed (${msg.slice(0, 120)}); index not advanced` };
          }
        }
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

    // ── INDEPENDENT JUDGE — SHADOW, LOG-ONLY (NT-001, 2026-08-13) ──
    // The image lane ran its judge shadow 08-05 → gate 08-07 over a measured
    // 5/25 blind-spot readout; the reel lane has never had one — rendered-QA
    // scores pixels, not judgment. Same promotion path: log the verdict, block
    // NOTHING, and only a future operator flip turns disagreement into a gate.
    // Failure is disclosed, never fatal — a judge error must not hold a reel
    // that rendered-QA already passed (this is exactly why it isn't a gate yet).
    if (process.env.IG_SHADOW_JUDGE !== "false") {
      // Once per JOB, not per tick (self-review fix): the assembled branch is
      // deliberately not wall-clock-gated, so a held reel (publish disabled,
      // Meta failure) revisits this point on every cron tick — unbounded, that
      // is N judge calls/day on the same quota-fragile LLM lane the #1507
      // evening-403 arc was about. A durable KV marks a job as judged; a
      // FAILED judge writes nothing, so it retries next tick (still log-only).
      const judgedKey = `reel_shadow_judge_${job.id}`;
      const alreadyJudged = await getKv(judgedKey);
      if (!alreadyJudged) {
        try {
          const { judgeSingleConcept } = await import("../../services/conceptTournament");
          const judgeInput = buildReelShadowJudgeInput({
            id: job.id, briefId: job.briefId, payload: job.payload, caption,
          });
          const verdict = await judgeSingleConcept({ ...judgeInput, priority: 1 });
          log.info("daily reel shadow judge (log-only — no gate)", {
            jobId: job.id,
            total: verdict.total,
            rejected: verdict.rejected,
            note: (verdict.note || verdict.rejectionReason || "").slice(0, 200),
          });
          await setKv(judgedKey, JSON.stringify({
            total: verdict.total,
            rejected: verdict.rejected,
            // briefId + topic make the row JOINABLE and identifiable, and the
            // note carries the WHY. Without them the corpus is a bag of numbers:
            // this verdict was written for three days with no reader at all, and
            // a reader could not have named which reel a score belonged to.
            // Every field here is consumed by reelShadowReadout.parseJudgeRow —
            // an unread field would repeat the defect this fixes.
            briefId: job.briefId,
            topic: judgeInput.concept.title,
            // Bounded at 200 like the log line above, so one pathological
            // verdict cannot bloat a shop_settings row.
            note: (verdict.note || verdict.rejectionReason || "").slice(0, 200),
            at: new Date().toISOString(),
          }), `Reel shadow-judge verdict — job ${job.id}`);
        } catch (err) {
          log.warn("daily reel shadow judge failed (run continues — shadow lane)", {
            jobId: job.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── ORIGINALITY + QC CHECKLIST — SHADOW, LOG-ONLY (NT-011, 2026-08-13) ──
    // One canonical readout of the brief's 9-item list instead of scattered
    // logs (claim verification, caption claim-safety, format/length all
    // already existed as SEPARATE, never-jointly-read checks). Same
    // promotion discipline as the judge above: log everything, gate nothing,
    // once per job via its own KV marker. Adds ONE genuinely new check this
    // pass — the voiceover script never ran reviewReplyQa before; only the
    // caption did.
    if (process.env.IG_SHADOW_JUDGE !== "false") {
      const qcKey = `reel_qc_checklist_${job.id}`;
      const alreadyChecked = await getKv(qcKey);
      if (!alreadyChecked) {
        try {
          // Real, canonical types (StoryboardBeat/EpisodeContract) instead of
          // a hand-rolled weakened inline type — self-review (2026-08-13)
          // found the original inline type here dropped disclosureMode from
          // the real DisclosureMode union to a bare string and entailment
          // from EntailmentVerdict to string, the same fragmentation class
          // that made hasCta structurally always false elsewhere.
          const parsed = parseReelJobPayload(job.payload);
          const { checkReviewReply, hasBlockingFindings } = await import("@shared/reviewReplyQa");
          const { extractBeatStructureSignals } = await import("@shared/beatStructureSignals");
          const { evaluateOriginalityQc } = await import("@shared/originalityQcChecklist");
          const { normalizeEntailmentVerdict } = await import("@shared/claimEntailment");

          const voiceover = parsed.episodeContract?.script?.voiceover ?? "";
          let voiceoverQaBlocking: boolean | null = null;
          try {
            voiceoverQaBlocking = voiceover ? hasBlockingFindings(checkReviewReply(voiceover)) : false;
          } catch {
            voiceoverQaBlocking = null;
          }

          const beatStructure = extractBeatStructureSignals({ storyboardBeats: parsed.storyboardBeats });
          const result = evaluateOriginalityQc({
            claimEntailments: (parsed.episodeContract?.evidence ?? []).map((e) => normalizeEntailmentVerdict(e.entailment)),
            captionQaBlocking: caption ? hasBlockingFindings(checkReviewReply(caption)) : null,
            voiceoverQaBlocking,
            disclosureMode: parsed.episodeContract?.disclosureMode,
            clevelandAngle: parsed.clevelandAngle,
            caption,
            totalDurationSeconds: beatStructure.totalDurationSeconds,
            storyboardBeats: parsed.storyboardBeats,
          });
          log.info("daily reel originality/QC checklist (log-only — no gate)", {
            jobId: job.id,
            passCount: result.passCount,
            failCount: result.failCount,
            failed: result.checks.filter((c) => c.status === "fail").map((c) => c.id),
          });
          await setKv(qcKey, JSON.stringify({ passCount: result.passCount, failCount: result.failCount, at: new Date().toISOString() }), `Reel originality/QC checklist — job ${job.id}`);
        } catch (err) {
          log.warn("daily reel originality/QC checklist failed (run continues — shadow lane)", {
            jobId: job.id,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // ── CONTENT VETO: the hand claim-audit outranks any approval ──────────
    // Three of the ten rendered reels carry false or overstated factual claims,
    // two of them burned into audio and pixels where no copy edit can reach
    // them. A report saying so does not stop an armed pipeline, so the verdicts
    // are code (shared/reelClaimAudit.ts) and this is where they bite. This
    // runs BEFORE the approval check deliberately: an operator must not be able
    // to approve away a false claim about Ohio law.
    //
    // The status write is IDEMPOTENT. This cron pulses roughly every 60s and a
    // held job stays held indefinitely, so an unconditional UPDATE here would
    // rewrite the same string forever - pointless load on TiDB and a churning
    // updatedAt that makes a stuck job look freshly touched.
    // The id-keyed veto and the CONTENT veto, in that order. The second exists
    // because the first is keyed by row: jobs 1830001-1830003 were regenerated
    // from three condemned jobs on 2026-08-30 and reproduced their scripts
    // verbatim, so `auditPublishBlock` returned null for every one of them.
    // Enqueue now refuses a condemned script outright, but jobs already sitting
    // in the queue predate that check — this is what holds them.
    {
      const beats = parseReelJobPayload(job.payload).storyboardBeats ?? [];
      const condemned = condemnedContentProblem({
        voiceover: parseReelJobPayload(job.payload).voiceoverScript,
        onScreenText: beats.map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
      });
      if (condemned) {
        const note = `BLOCKED by claim audit (content): ${condemned}`.slice(0, 1000);
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.error(`daily reel: job ${job.id} reproduces a condemned script — not publishing`, { reason: condemned });
        // TERMINAL: a condemned script reads the same tomorrow.
        await advancePastRefusedPack(job, "condemned script (content)");
        return { recordsProcessed: 0, details: `held: job ${job.id} reproduces a condemned script; rotation advanced` };
      }
    }

    {
      const vetoed = auditPublishBlock(job.id);
      if (vetoed) {
        const note = `BLOCKED by claim audit: ${vetoed}`.slice(0, 1000);
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.error(`daily reel: claim audit VETOES job ${job.id} — not publishing`, { reason: vetoed });
        // TERMINAL: an audited condemnation does not expire.
        await advancePastRefusedPack(job, "claim audit veto");
        return { recordsProcessed: 0, details: `held: claim audit vetoes job ${job.id}; rotation advanced` };
      }
    }

    // ── DISCLOSURE GATE: generated footage may not claim a real event ─────
    // `disclosureViolation` — and `realEvidenceClaims` inside it — had NO
    // production caller. Its only non-test reference was
    // shared/reelPromotability.ts, and nothing under server/ imports that, so
    // the rule "generated footage may never be framed as a real customer,
    // repair, test or before/after" was enforced NOWHERE on the publish path.
    // The account is fully generated, which makes that rule the main thing
    // standing between the shop and a false claim about its own work.
    //
    // It runs in the veto chain, BEFORE the approval check, for the same reason
    // the claim audit does: an operator must not be able to approve away a
    // claim the footage cannot support.
    //
    // The flag judged is the SAME value the publish call will send below, not a
    // re-derivation — a gate that checks a different value than the one
    // transmitted is checking nothing.
    {
      const dPayload = parseReelJobPayload(job.payload);
      const dBeats = dPayload.storyboardBeats ?? [];
      const violation = publishDisclosureProblem({
        jobId: job.id,
        caption,
        onScreenText: dBeats.map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
        willDiscloseAi: shouldDiscloseAi(job.clipUrlsJson, process.env.REEL_VIDEO_PROVIDER, { shotLineage: dPayload.shotLineage }),
      });
      if (violation) {
        const note = `BLOCKED by disclosure gate: ${violation}`.slice(0, 1000);
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.error(`daily reel: disclosure gate VETOES job ${job.id} — not publishing`, { reason: violation });
        // TERMINAL: the verdict is computed from the PERSISTED caption and
        // on-screen text, so a retry re-derives the same violation. Flagged in
        // review on #2167 — without this, a disclosure veto pins the rotation
        // on its pack exactly the way a repost used to.
        await advancePastRefusedPack(job, "disclosure veto");
        return { recordsProcessed: 0, details: `held: disclosure gate vetoes job ${job.id}; rotation advanced` };
      }
    }

    // ── ORIGINALITY GATE: has this already gone out? ──────────────────────
    // Reel 1770003 published on 2026-08-29 after an audit that checked claims,
    // disclosure, aspect ratio, burned-in text and destination — and never
    // asked this question. Job 1620001 had published the same script twelve
    // days earlier (similarity 1.00 on both the on-screen text and the
    // caption). A repost is demoted by Instagram's originality weighting, not
    // merely redundant, so this runs BEFORE the approval check: an operator
    // should not be able to approve a duplicate into the feed.
    {
      const { loadPublishedCorpus } = await import("../../services/reelOriginality");
      const { originalityProblem } = await import("@shared/reelOriginality");
      const beats = parseReelJobPayload(job.payload).storyboardBeats ?? [];
      const dupe = originalityProblem(
        {
          onScreenText: beats.map((b) => b?.onScreenText ?? "").filter(Boolean).join(" "),
          caption,
          videoUrl,
        },
        await loadPublishedCorpus(job.id),
      );
      if (dupe) {
        const note = `BLOCKED as a repost: ${dupe.reason}`.slice(0, 1000);
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.error(`daily reel: job ${job.id} duplicates already-published content — not publishing`, {
          match: dupe.label, score: dupe.score, surface: dupe.surface,
        });
        // TERMINAL for this cycle: the same pack regenerated tomorrow produces
        // the same script and the same repost verdict. Advancing is what turns
        // an infinite retry back into a rotation.
        await advancePastRefusedPack(job, `repost of ${dupe.label}`);
        return { recordsProcessed: 0, details: `held: job ${job.id} duplicates ${dupe.label}; rotation advanced` };
      }
    }

    // ── APPROVAL GATE: default-deny, and the reason is written on the job ──
    // Publishing was armed and unattended; the only thing holding it was a
    // defective row jammed at the head of the queue, which is an accident, not
    // a control. Nothing publishes now without a recorded, attributable human
    // yes bound to THESE caption bytes and THIS asset.
    //
    // The hold is written to reel_jobs.error so an operator reading the job
    // sees why it is sitting there. It is deliberately NOT a new status value:
    // eight call sites gate on status === "assembled", including the operator's
    // own manual publish button in adminRoutes, and moving the job out of that
    // state to make the hold prettier would strand the very path a human uses
    // to act on the hold.
    {
      const problem = await reelApprovalProblem({ jobId: job.id, caption, videoUrl });
      if (problem) {
        const note = `HELD awaiting approval [${problem.code}]: ${problem.reason}`.slice(0, 1000);
        // Idempotent for the same reason as the veto write above.
        if (job.error !== note) {
          await d.update(reelJobs).set({ error: note }).where(eq(reelJobs.id, job.id));
        }
        log.warn(`daily reel: job ${job.id} is not approved to publish — HOLDING`, { code: problem.code });
        return {
          recordsProcessed: 0,
          details: `held: awaiting human approval for job ${job.id} (${problem.code}); index not advanced`,
        };
      }
    }

    // EXACTLY-ONCE: claim assembled -> publishing BEFORE the external Meta call,
    // so two overlapping cron ticks cannot both publish this reel. The loser of
    // the CAS simply reports that another run owns it.
    const claimRes = await d.update(reelJobs).set({ status: "publishing", queueState: queueStateForReelStatus("publishing"), publicationScheduledAt: new Date() })
      .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "assembled")));
    const { affectedRowCount } = await import("../../lib/db-affected");
    const claimed = affectedRowCount(claimRes);
    if (claimed !== 1) {
      log.warn(`daily reel: publish already claimed by another run (job ${job.id})`);
      return { recordsProcessed: 0, details: `publish already claimed by another run (job ${job.id})` };
    }

    log.info(`Attempting to publish assembled reel job ${job.id} (mp4Url: ${videoUrl})`);

    // Durable attempt record BEFORE any non-essential awaited work and BEFORE
    // the irreversible Meta call. If the process dies after the claim but
    // before this receipt exists, stale-job recovery has nothing to reconcile.
    // stops two runners racing, but it does not survive a process death: killed
    // between Meta accepting and the DB update, nothing would record that an
    // attempt happened at all. Refusing to publish unrecorded is the point — an
    // unrecorded publish is the ambiguity this exists to remove.
    const { recordPublishAttempt, recordPublishOutcome, OUTCOME } = await import("../../services/publishAttemptLedger");
    const platforms = reelPublishPlatforms();
    const attemptId = await recordPublishAttempt({
      jobId: job.id, platforms, mediaUrl: videoUrl, caption,
    });
    if (!attemptId) {
      await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled"), publicationScheduledAt: null })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      const { advanceContentRunByReelJobId, RUN_STAGE } = await import("../../services/contentRun");
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.held,
        failureReason: "publish-attempt ledger unavailable",
        evidence: { at: new Date().toISOString(), what: "Publish held before Meta because the attempt ledger was unavailable" },
      });
      log.error(`daily reel: could not record a publish attempt for job ${job.id} — HOLDING rather than publishing unrecorded`);
      return { recordsProcessed: 0, details: "held: publish-attempt ledger unavailable; index not advanced" };
    }

    // Best-effort observability only AFTER the durable attempt exists. A slow or
    // unavailable content-run mirror must never open a crash window where the
    // Reel is claimed but has no attempt id for reconciliation.
    {
      const { advanceContentRunByReelJobId, RUN_STAGE } = await import("../../services/contentRun");
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.publishing,
        evidence: { at: new Date().toISOString(), what: "Instagram publish claimed; durable attempt recorded" },
      });
    }

    let outcome;
    try {
      // "automated": nobody is watching this cron, so an UNREADABLE kill-switch
      // state must stop it rather than let it publish blind.
      // Structured AI self-disclosure, derived from THIS JOB'S CLIPS.
      //
      // It used to read isGenerativeProvider(process.env.REEL_VIDEO_PROVIDER) -
      // the lane configured right now, not the one that rendered the job being
      // published. Jobs sit in this backlog for days (measured 2026-08-29:
      // oldest assembled job was nine days old), so flipping the lane to a
      // stock provider would have published every queued Higgsfield reel with
      // no is_ai_generated at all - a Meta policy violation on the owner's
      // business account. The clip storage path is unforgeable and is already
      // the evidence the stock guard trusts; it decides this too.
      // The SAME derivation the disclosure veto above judged, lineage included —
      // a gate that checks a different value than the one transmitted checks nothing.
      const isAiGenerated = shouldDiscloseAi(job.clipUrlsJson, process.env.REEL_VIDEO_PROVIDER, { shotLineage: parseReelJobPayload(job.payload).shotLineage });
      outcome = await publishToSocial({
        platforms,
        videoUrl,
        caption,
        actor: "automated",
        isAiGenerated,
      });
    } catch (pubErr) {
      // THREW — Meta may or may not have accepted the reel. Do NOT restore
      // "assembled" (that risks a double-publish); park it for reconciliation
      // and fail the cron run loudly.
      const msg = pubErr instanceof Error ? pubErr.message : String(pubErr);
      await recordPublishOutcome(attemptId, OUTCOME.ambiguous, { error: msg });
      await d.update(reelJobs)
        .set({ status: "publish_ambiguous", queueState: queueStateForReelStatus("publish_ambiguous"), error: `publish threw: ${msg.slice(0, 300)}` })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      {
        const { advanceContentRunByReelJobId, RUN_STAGE, OPERATIONAL_STATE } = await import("../../services/contentRun");
        await advanceContentRunByReelJobId(job.id, {
          stage: RUN_STAGE.held,
          operationalState: OPERATIONAL_STATE.ambiguous,
          failureReason: msg.slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Instagram publish threw after dispatch may have occurred" },
        });
      }
      log.error(`daily reel: publish THREW — job ${job.id} parked publish_ambiguous; verify on Instagram before retrying`, { err: msg });
      throw pubErr;
    }
    const ig = outcome.results.find((r) => r.platform === "instagram");

    // AMBIGUOUS IS NOT FAILURE, AND THIS DOOR IS THE UNATTENDED ONE.
    //
    // metaSocial returns { success:false, ambiguous:true } when media_publish was
    // DISPATCHED and nothing came back; its own words are "the reel may be LIVE",
    // and its docstring instructs callers to park rather than reset. Instagram
    // publishes an ambiguous dispatch with NO idempotency key, NO request id, and
    // NO error code meaning "already published" (verified against Meta's error
    // reference 2026-09-09) — so a retry cannot be deduplicated by the platform
    // and simply posts the reel twice.
    //
    // Falling into the !ig.success branch below reset the row to `assembled`,
    // which the very next pulse republishes. scheduledPosts, instagramAdmin,
    // adStudio and instagramStudio all already park this; the autonomous reel
    // door was the only surface that did not.
    const fbLiveId = facebookLiveWithoutInstagram(outcome.results);
    if (!ig?.success && ig?.ambiguous) {
      await recordPublishOutcome(attemptId, OUTCOME.ambiguous, {
        igPostId: null, error: ig?.error ?? "ambiguous dispatch", platformResults: outcome.results,
      });
      await d.update(reelJobs)
        .set({
          status: "publish_ambiguous",
          queueState: queueStateForReelStatus("publish_ambiguous"),
          error: `${fbLiveId ? `Facebook reel LIVE (${fbLiveId}); ` : ""}${String(ig?.error ?? "media_publish dispatched, no response — may be LIVE")}`.slice(0, 500),
        })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      {
        const { advanceContentRunByReelJobId, RUN_STAGE, OPERATIONAL_STATE } = await import("../../services/contentRun");
        await advanceContentRunByReelJobId(job.id, {
          stage: RUN_STAGE.held,
          operationalState: OPERATIONAL_STATE.ambiguous,
          failureReason: String(ig?.error ?? "ambiguous Instagram dispatch").slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Instagram media_publish returned ambiguous" },
        });
      }
      log.error(`Reel autopost publish AMBIGUOUS for job ${job.id} — parked, NOT retried`, { error: ig?.error });
      return {
        recordsProcessed: 0,
        details: `publish AMBIGUOUS for job ${job.id} (may be live) — parked for reconciliation; index not advanced`,
      };
    }

    await recordPublishOutcome(attemptId, ig?.success ? OUTCOME.confirmed : OUTCOME.failed, {
      igPostId: ig?.postId ?? null, error: ig?.success ? null : (ig?.error ?? "unknown"), platformResults: outcome.results,
    });
    if (!ig?.success && fbLiveId) {
      // PARTIAL: the Page already has this reel, Instagram cleanly refused it.
      // Restoring "assembled" would hand the SAME video to Facebook again on the
      // next tick (same shape socialInventoryPublisher parks as published_partial).
      await d.update(reelJobs)
        .set({
          status: "publish_ambiguous",
          queueState: queueStateForReelStatus("publish_ambiguous"),
          error: `Facebook reel LIVE (${fbLiveId}) but Instagram refused: ${String(ig?.error ?? "unknown")}`.slice(0, 500),
        })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      {
        const { advanceContentRunByReelJobId, RUN_STAGE, OPERATIONAL_STATE } = await import("../../services/contentRun");
        await advanceContentRunByReelJobId(job.id, {
          stage: RUN_STAGE.held,
          operationalState: OPERATIONAL_STATE.ambiguous,
          failureReason: `Facebook live, Instagram refused: ${String(ig?.error ?? "unknown")}`.slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Facebook reel published; Instagram rejected — parked, not retried" },
        });
      }
      log.error(`Reel autopost PARTIAL for job ${job.id} — Facebook live (${fbLiveId}), Instagram refused; parked, NOT retried`, { error: ig?.error });
      return {
        recordsProcessed: 0,
        details: `publish PARTIAL for job ${job.id} (Facebook live, Instagram refused) — parked for reconciliation; index not advanced`,
      };
    }
    if (!ig?.success) {
      // Cleanly-returned failure: Meta explicitly did not accept it, so the
      // claim is safe to release for a later retry.
      await d.update(reelJobs).set({ status: "assembled", queueState: queueStateForReelStatus("assembled"), publicationScheduledAt: null })
        .where(and(eq(reelJobs.id, job.id), eq(reelJobs.status, "publishing")));
      {
        const { advanceContentRunByReelJobId, RUN_STAGE, OPERATIONAL_STATE } = await import("../../services/contentRun");
        await advanceContentRunByReelJobId(job.id, {
          stage: RUN_STAGE.held,
          operationalState: OPERATIONAL_STATE.failed,
          failureReason: String(ig?.error ?? "Instagram publish failed").slice(0, 1000),
          evidence: { at: new Date().toISOString(), what: "Instagram explicitly rejected the publish attempt" },
        });
      }
      log.error(`Reel autopost publish failed for job ${job.id}`, { error: ig?.error });
      // Throw, not return: a returned run is recorded `completed` and the cron
      // observer never sees it. The job row is already restored above.
      throw new Error(`Publish failed: ${ig?.error ?? "unknown"} — not advancing index`);
    }

    // Successfully posted live!
    // error is cleared deliberately: a job that was held for approval carries
    // the "HELD awaiting approval ..." explanation in that column, and leaving
    // it on a successfully posted reel would describe a live post as blocked.
    await d.update(reelJobs).set({ status: "posted", queueState: queueStateForReelStatus("posted"), igPostId: ig.postId, error: null }).where(eq(reelJobs.id, job.id));

    // Facebook is a cross-post, never the authority: its id lives in the
    // attempt ledger's platformResults; a failure is logged, not retried.
    if (platforms.includes("facebook")) {
      const fb = outcome.results.find((r) => r.platform === "facebook");
      if (fb?.success) log.info("Facebook reel cross-post published", { jobId: job.id, fbPostId: fb.postId ?? null });
      else log.warn("Facebook reel cross-post did not publish — Instagram is live, job stays posted", { jobId: job.id, error: fb?.error ?? "no facebook result", ambiguous: fb?.ambiguous ?? false });
    }

    // The Reel job is the delivery authority, but social_content_inventory is
    // what Queue/creative-memory/metric-sync learn from. Keep that mirror in the
    // same confirmed-live transition so a posted Reel cannot remain
    // "review_ready" forever. Failure here must NEVER turn a successful Meta
    // publish into a retry (duplicate-post risk); the recurring self-heal repairs
    // it later.
    try {
      const { markReelInventoryPublished } = await import("../../services/reelInventoryLink");
      const mirror = await markReelInventoryPublished(d, {
        briefId: job.briefId,
        publishedAt: new Date(),
        mp4Url: videoUrl,
        caption,
        brief: parseReelJobPayload(job.payload),
      });
      if (mirror === "conflict_rejected") {
        // Only reachable if the reel was rejected after the gates above ran.
        log.error("Reel is LIVE but its Queue draft was REJECTED — inventory kept as rejected; operator must reconcile", {
          jobId: job.id,
          inventoryId: job.briefId,
          igPostId: ig.postId,
        });
      } else {
        log.info("confirmed Reel publication mirrored to social inventory", {
          jobId: job.id,
          inventoryId: job.briefId,
          mirror,
        });
      }
    } catch (inventoryErr) {
      log.error("Reel is LIVE but social inventory mirror could not be updated; self-heal will retry", {
        jobId: job.id,
        inventoryId: job.briefId,
        err: inventoryErr instanceof Error ? inventoryErr.message.slice(0, 240) : String(inventoryErr).slice(0, 240),
      });
    }

    {
      const { advanceContentRunByReelJobId, RUN_STAGE, OPERATIONAL_STATE } = await import("../../services/contentRun");
      let proof: string | null = ig.postId ? `instagram-media:${ig.postId}` : null;
      if (ig.postId) {
        try {
          const { getInstagramPermalink } = await import("../../services/metaSocial");
          proof = (await getInstagramPermalink(ig.postId)) || proof;
        } catch { /* media id remains durable publish proof */ }
      }
      await advanceContentRunByReelJobId(job.id, {
        stage: RUN_STAGE.done,
        operationalState: proof ? OPERATIONAL_STATE.published : OPERATIONAL_STATE.attempted,
        failureReason: null,
        evidence: {
          at: new Date().toISOString(),
          what: proof ? "Instagram publish confirmed" : "Instagram publish returned success without a durable media id",
          proof,
        },
      });
    }

    // Experiment traceability: if this job was assigned to an experiment at
    // enqueue, stamp the published media id + time — the verdict horizon
    // cannot be derived without them. The post is already live; a failed
    // attach is a measurement gap, never a publish failure.
    try {
      if (ig.postId) {
        const { attachPublishedMediaForReelJob } = await import("../../services/contentExperimentStore");
        await attachPublishedMediaForReelJob(job.id, ig.postId, new Date());
      }
    } catch (attachErr) {
      log.warn("experiment media attach failed (post already live)", {
        jobId: job.id,
        err: attachErr instanceof Error ? attachErr.message : String(attachErr),
      });
    }
    const postedPayload = parseReelJobPayload(job.payload);
    let progressDetail: string;
    if (postedPayload.approvedPackSlug) {
      const fullLibraryIndex = resolveApprovedPackRotationIndex(await getKv("reel_approved_pack_rotation_index"));
      const activeSlate = await readActiveReelSlate(d);
      const target = resolveApprovedPackProgressTarget(
        postedPayload.approvedPackSlug,
        fullLibraryIndex,
        activeSlate,
        postedPayload.approvedPackPool,
        postedPayload.approvedPackSlateRevision,
      );
      if (target?.pool === "active_slate") {
        await setActiveSlateProgress(target.nextIndex, date);
        progressDetail = `active-slate index: ${target.nextIndex}`;
      } else if (target?.pool === "full_approved_library") {
        await setApprovedPackProgress(target.nextIndex, date);
        progressDetail = `approved-library index: ${target.nextIndex}`;
      } else {
        // The post is already live. Always record its date, but never guess
        // which queue to consume after an operator enabled, cleared, or reordered
        // Strategy while this Reel was rendering.
        await setAutopostDate(date);
        log.warn("approved-pack source queue changed while a reel rendered; date recorded but cursor held", {
          jobId: job.id,
          posted: postedPayload.approvedPackSlug,
          jobPool: postedPayload.approvedPackPool ?? "legacy_full_approved_library",
          jobSlateRevision: postedPayload.approvedPackSlateRevision ?? null,
          fullLibraryIndex,
          activeSlateCursor: activeSlate.cursor,
          activeSlateRevision: activeSlate.updatedAt,
        });
        progressDetail = "approved-pack cursor held after concurrent source-queue change";
      }
    } else {
      const idx = parseInt((await getKv("reel_autopost_index")) || "0", 10) || 0;
      await setAutopostProgress(idx + 1, date);
      progressDetail = `manifest index: ${idx + 1}`;
    }
    log.info(`Successfully posted dynamic reel for job ${job.id}`, { postId: ig.postId });
    return {
      recordsProcessed: 1,
      details: `posted dynamic reel for job ${job.id} (${progressDetail})${drainedFrom ? ` [DRAINED backlog job from ${drainedFrom}]` : ""}`,
    };
  }

  if (["queued", "generating", "assets_ready", "assembling", "uploading", "publishing", "repair_queued"].includes(job.status)) {
    return { recordsProcessed: 0, details: `Generation or assembly in progress (status: ${job.status})` };
  }

  if (job.status === "failed") {
    return {
      recordsProcessed: 0,
      details: `Generation failed for job ${job.id}: ${job.error}; no fallback media posted and index not advanced`,
    };
  }

  // `published` and `publish_ambiguous` are real terminal states that this
  // switch did not name, so both fell through to "Unknown job status" — a
  // reconciled job (the ONLY writer of `published` is the reconciler) reported
  // as an unrecognised state, which reads like corruption rather than success.
  if (job.status === "published" || job.status === "posted") {
    return { recordsProcessed: 0, details: `Job ${job.id} is already live (status: ${job.status}); nothing to do` };
  }
  if (job.status === "publish_ambiguous") {
    return {
      recordsProcessed: 0,
      details: `Job ${job.id} publish outcome UNKNOWN — parked for the reconcile lane, never retried blind`,
    };
  }

  return {
    recordsProcessed: 0,
    details:
      job.status === "repair_queued" || job.status === "repair_rendering"
        ? `Repair in flight (status: ${job.status}) - re-verdict after re-render`
        : job.status === "repair_failed"
          ? "Repair FAILED - waiting for a re-queue (requestBeatRepair) or an operator discard"
          : `Unknown job status: ${job.status}`,
  };
}
