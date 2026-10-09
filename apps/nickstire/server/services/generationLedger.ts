/**
 * Generation ledger — Long Haul milestone 4: real cost accounting.
 *
 * Replaces "reel-job-count × fixed estimate" with a reservation ledger:
 * RESERVE before provider spend, SETTLE on completion (actuals when known,
 * estimates FLAGGED as estimates), RELEASE/FAIL otherwise. Daily and
 * per-campaign spend are SUMs over this ledger, with day boundaries at
 * Cleveland midnight.
 *
 * Concurrency: budget checking is optimistic-with-compensation — reserve
 * inserts, re-sums, and self-releases + throws if the sum went over budget.
 * TiDB-friendly (no SELECT FOR UPDATE dependency); a true serialized
 * allocator can replace the internals later without changing callers.
 *
 * Degrades gracefully until drizzle/0086 is applied: a missing table WARNs
 * and returns null — callers fall back to their previous coarse accounting
 * (loudly), never silently to zero.
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";
import { clevelandDayStart } from "./autonomyControl";
import { computeSourceFromEnv, costClassForComputeSource, getMediaProfile, type MediaCostClass } from "../../shared/mediaModelRegistry";

const log = createLogger("services:generation-ledger");

/** ESTIMATES — Higgsfield does not expose per-call USD through the CLI; these
 *  are operator-tunable stand-ins and every row they touch is FLAGGED
 *  isEstimate until a real provider-usage feed replaces them. */
export const COST_ESTIMATES_USD = {
  // 12 credits per 4 s 1080p clip is VERIFIED (every seedance1_5 row in the account's transaction history,
  // 2026-09-08..10-08, audio on). Higgsfield's no-submit cost preflight (get_cost, 2026-10-08) quoted audio off
  // at the same 12 at 1080p, and 4.8 at 720p with audio on or off, so silencing clips saves nothing; 720p is
  // the lever, a quality call. The dollar figure is still an ASSUMPTION: Higgsfield publishes no per-call USD, and a credit's
  // price depends on the plan - operator-tunable.
  seedance_clip: 0.25,
  /** template_stock renders with local ffmpeg — no API call, no credits, no marginal cost. */
  template_stock_clip: 0,
  gpt_image_2: 0.1,
  elevenlabs_vo: 0.05,
  gemini_brief: 0.01,
  /** Veo, 720p, per SECOND of generated video. Google publishes this one. */
  veo_second_720p: 0.1,
} as const;

/** Veo's own default clip length when `durationSeconds` is not sent. */
export const VEO_DEFAULT_CLIP_SECONDS = 8;

/**
 * What ONE reel clip costs, by the provider that actually rendered it.
 *
 * There was no veo entry at all, and both reel cost sites multiplied by
 * `seedance_clip` regardless of provider. `reelPipeline` had already been fixed
 * once for this exact bug — the comment above its reservation describes job
 * 1200003 logging provider="veo" while the ledger held zero veo rows — but that
 * fix corrected the `provider` and `model` columns and left the dollar amount
 * behind. So the columns said Veo and the money said Higgsfield.
 *
 * That figure is not cosmetic: it is what `reserve()` compares against
 * `policy.limits.maxGenerationCostPerDayUsd`, so an undercount makes the daily
 * spend ceiling proportionally too permissive. It also makes a provider or model
 * switch unmeasurable — moving Veo Fast to Lite would have recorded the identical
 * cost before and after, which is precisely the shape of a metric that lies.
 *
 * Veo bills per SECOND, so a flat per-clip constant cannot price it. Both inputs
 * are env-tunable so a rate change or a duration change does not need a deploy,
 * matching the operator-tunable doctrine of the estimates above. Still an
 * ESTIMATE: rows remain flagged isEstimate until a real provider-usage feed
 * exists, because this multiplies a published rate by an assumed duration rather
 * than reading what Google actually billed.
 */
export function reelClipCostUsd(provider: string, env: NodeJS.ProcessEnv = process.env): number {
  // template_stock renders with local ffmpeg — no API call, no credits, no
  // marginal cost. Billing it at the Seedance rate would consume
  // maxGenerationCostPerDayUsd and start throwing BUDGET_DAILY_EXCEEDED for
  // renders that cost nothing, and would corrupt every provider-comparison
  // figure the paragraph above exists to protect.
  if (provider === "template_stock") return COST_ESTIMATES_USD.template_stock_clip;
  // Self-hosted (NOUR Video Forge): GPU compute, not vendor credits. Priced from
  // the active profile's expected GPU-seconds × the configured $/GPU-hour; the
  // reel settles at MEASURED gpu_seconds from each job receipt. Owned/existing
  // GPUs price at the operator's marginal rate (power), never a fake Seedance
  // figure — and never literally "free" unless the operator sets that rate.
  if (provider === "self_hosted") return selfHostedClipEstimateUsd(env);
  if (provider !== "veo") return COST_ESTIMATES_USD.seedance_clip;
  // Number(undefined) and Number("abc") are NaN, Number("") is 0 — all falsy,
  // so a missing or malformed override falls back rather than booking a zero.
  const seconds = Number(env.REEL_VEO_DURATION) || VEO_DEFAULT_CLIP_SECONDS;
  const perSecond = Number(env.REEL_VEO_USD_PER_SECOND) || COST_ESTIMATES_USD.veo_second_720p;
  return seconds * perSecond;
}

function selfHostedClipEstimateUsd(env: NodeJS.ProcessEnv): number {
  const profile = getMediaProfile(env.VIDEO_FORGE_PROFILE || "ltx-2.5-distilled");
  if (!profile) return COST_ESTIMATES_USD.seedance_clip; // unknown profile: never under-price
  const src = computeSourceFromEnv(env);
  const rate =
    src === "rented_gpu"
      ? Number(env.VIDEO_FORGE_USD_PER_GPU_HOUR) || profile.cost.referenceUsdPerGpuHour
      : Number(env.VIDEO_FORGE_MARGINAL_USD_PER_GPU_HOUR) || 0;
  return (profile.cost.expectedGpuSeconds / 3600) * rate;
}

/**
 * Cost POLICY, separate from cost AMOUNT.
 *
 * `reelClipCostUsd(p) > 0` was being used as "this regen needs an operator's
 * spend authorization" (qualityGate → repairRouter). That proxy is wrong in
 * both directions once a self-hosted lane exists: a pre-authorized rented GPU
 * pool has a real, non-zero cost yet should run selective repairs inside the
 * daily budget without a human tap each time; and an owned GPU priced at $0
 * vendor cost is still not "free" for capacity planning. So the question
 * "must a human approve this spend?" is answered HERE, explicitly:
 *
 *   template_stock → no approval (local ffmpeg)
 *   self_hosted    → no approval ONLY when VIDEO_FORGE_POOL_PREAUTHORIZED=true
 *                    or the GPU is owned/existing infra; otherwise approval
 *   veo/higgsfield → approval (metered vendor spend)
 *
 * Budget ceilings (maxGenerationCostPerDayUsd) still apply to every lane via
 * reserve(); pre-authorization removes the per-repair human tap, not the cap.
 */
export interface ReelClipCostPolicy {
  provider: string;
  costClass: MediaCostClass;
  vendorApiCostUsd: number;
  estimatedComputeCostUsd: number;
  requiresSpendApproval: boolean;
}

export function reelClipCostPolicy(provider: string, env: NodeJS.ProcessEnv = process.env): ReelClipCostPolicy {
  if (provider === "template_stock") {
    return { provider, costClass: "LOCAL_FREE", vendorApiCostUsd: 0, estimatedComputeCostUsd: 0, requiresSpendApproval: false };
  }
  if (provider === "self_hosted") {
    const src = computeSourceFromEnv(env);
    const est = selfHostedClipEstimateUsd(env);
    return {
      provider,
      costClass: costClassForComputeSource(src),
      vendorApiCostUsd: 0,
      estimatedComputeCostUsd: est,
      requiresSpendApproval: !(src !== "rented_gpu" || env.VIDEO_FORGE_POOL_PREAUTHORIZED === "true"),
    };
  }
  return { provider, costClass: "METERED_PAID", vendorApiCostUsd: reelClipCostUsd(provider, env), estimatedComputeCostUsd: 0, requiresSpendApproval: true };
}

export interface ReserveInput {
  /** idempotency key — one reservation per action, retries return the original */
  actionId: string;
  campaignId?: string | null;
  provider: string;
  model: string;
  operation: string;
  estimatedCostUsd: number;
  /** daily ceiling to enforce; omit to reserve without a budget check */
  dailyBudgetUsd?: number;
}

export interface LedgerRow {
  id: string;
  actionId: string;
  status: "reserved" | "settled" | "released" | "failed";
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  isEstimate: boolean;
}

async function ledgerDb() {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const schema = await import("../../drizzle/schema");
  if (!("generationReservations" in schema)) return null;
  return { d, table: schema.generationReservations };
}

/** SUM of spend since `since` — reserved + settled + FAILED (failed spends
 *  likely burned credits; only released rows are free). Null = ledger
 *  unavailable (0086 pending). */
export async function spendSinceUsd(since: Date): Promise<number | null> {
  try {
    const ctx = await ledgerDb();
    if (!ctx) return null;
    const { gte, inArray, and } = await import("drizzle-orm");
    const { sql: dsql } = await import("drizzle-orm");
    const [row] = await ctx.d
      .select({ total: dsql<string>`COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0)` })
      .from(ctx.table)
      .where(and(gte(ctx.table.createdAt, since), inArray(ctx.table.status, ["reserved", "settled", "failed"])));
    return Number(row?.total ?? 0);
  } catch (err) {
    log.warn("ledger unavailable (0086 pending?) — spend unknown", { err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    return null;
  }
}

export async function dailySpendUsd(): Promise<number | null> {
  return spendSinceUsd(clevelandDayStart());
}

export async function campaignSpendUsd(campaignId: string): Promise<number | null> {
  try {
    const ctx = await ledgerDb();
    if (!ctx) return null;
    const { eq, inArray, and } = await import("drizzle-orm");
    const { sql: dsql } = await import("drizzle-orm");
    const [row] = await ctx.d
      .select({ total: dsql<string>`COALESCE(SUM(COALESCE(actual_cost_usd, estimated_cost_usd)), 0)` })
      .from(ctx.table)
      .where(and(eq(ctx.table.campaignId, campaignId), inArray(ctx.table.status, ["reserved", "settled", "failed"])));
    return Number(row?.total ?? 0);
  } catch {
    return null;
  }
}

/**
 * Reserve budget before provider spend. Idempotent on actionId. When a daily
 * budget is provided, the post-insert re-sum enforces it: if concurrent
 * reservations pushed the day over, THIS reservation self-releases and
 * throws — the budget breach never stands.
 */
export async function reserve(input: ReserveInput): Promise<LedgerRow | null> {
  try {
    const ctx = await ledgerDb();
    if (!ctx) {
      log.warn("ledger unavailable — reservation skipped (caller falls back to coarse accounting)", { actionId: input.actionId });
      return null;
    }
    const { eq } = await import("drizzle-orm");

    const existing = await ctx.d.select().from(ctx.table).where(eq(ctx.table.actionId, input.actionId)).limit(1);
    if (existing.length) {
      const e = existing[0];
      return { id: e.id, actionId: e.actionId, status: e.status as LedgerRow["status"], estimatedCostUsd: Number(e.estimatedCostUsd), actualCostUsd: e.actualCostUsd == null ? null : Number(e.actualCostUsd), isEstimate: !!e.isEstimate };
    }

    const id = `res_${randomUUID()}`;
    await ctx.d.insert(ctx.table).values({
      id,
      actionId: input.actionId,
      campaignId: input.campaignId ?? null,
      provider: input.provider.slice(0, 48),
      model: input.model.slice(0, 64),
      operation: input.operation.slice(0, 48),
      estimatedCostUsd: input.estimatedCostUsd.toFixed(4),
      isEstimate: true,
      status: "reserved",
    });

    if (input.dailyBudgetUsd !== undefined) {
      const spent = await spendSinceUsd(clevelandDayStart());
      if (spent !== null && spent > input.dailyBudgetUsd) {
        await ctx.d.update(ctx.table).set({ status: "released" }).where(eq(ctx.table.id, id));
        throw new Error(`BUDGET_DAILY_EXCEEDED: reserving $${input.estimatedCostUsd.toFixed(2)} would put today at $${spent.toFixed(2)} > $${input.dailyBudgetUsd.toFixed(2)}`);
      }
    }

    log.info("generation budget reserved", { actionId: input.actionId, estimatedCostUsd: input.estimatedCostUsd, operation: input.operation });
    return { id, actionId: input.actionId, status: "reserved", estimatedCostUsd: input.estimatedCostUsd, actualCostUsd: null, isEstimate: true };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("BUDGET_DAILY_EXCEEDED")) throw err;
    log.warn("reserve failed — caller falls back to coarse accounting", { actionId: input.actionId, err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
    return null;
  }
}

async function transition(actionId: string, status: "settled" | "released" | "failed", actualCostUsd?: number): Promise<void> {
  try {
    const ctx = await ledgerDb();
    if (!ctx) return;
    const { eq } = await import("drizzle-orm");
    await ctx.d
      .update(ctx.table)
      .set({
        status,
        settledAt: new Date(),
        ...(actualCostUsd !== undefined ? { actualCostUsd: actualCostUsd.toFixed(4), isEstimate: false } : {}),
      })
      .where(eq(ctx.table.actionId, actionId));
    log.info(`reservation ${status}`, { actionId, actualCostUsd });
  } catch (err) {
    log.warn(`reservation ${status} not recorded`, { actionId, err: err instanceof Error ? err.message.slice(0, 120) : String(err) });
  }
}

/**
 * How long a reservation may sit in `reserved` before the sweeper treats it as
 * abandoned. Generous on purpose: the longest legitimate hold is one
 * reel-pipeline pulse budget (14 min) plus assembly, so hours cannot be a live
 * job — but a value this loose can never race a running worker.
 */
export const RESERVATION_STALE_HOURS = 6;

/**
 * RELEASE RESERVATIONS NOTHING WILL EVER SETTLE.
 *
 * `reserve()` inserts `reserved`; the worker settles or releases it at the end
 * of the run. A crash, restart or deploy between those two points leaves the
 * row `reserved` forever — and `spendSinceUsd` counts `reserved` alongside
 * `settled` and `failed`, deliberately, so an in-flight job cannot be
 * double-spent. The consequence is that an abandoned row consumes daily budget
 * that nothing will ever return.
 *
 * Measured 2026-09-09: four such rows, oldest from 2026-07-20 (`reel_job_1350001`
 * at $1.50, plus three `ref_frames_*` at $0.10). None was in the current day's
 * window, so none was distorting today's ceiling — but one abandoned mid-day
 * would silently shrink that day's generation budget with no way to notice
 * except a puzzling BUDGET_DAILY_EXCEEDED.
 *
 * `contentGovernor` already has exactly this sweeper for its reservations; the
 * generation ledger did not.
 *
 * RELEASED, not settled: we do not know the provider charged. Marking it
 * `settled` would assert a spend we cannot evidence, and `released` is the
 * status the codebase already uses for "reserved, then nothing happened".
 */
/**
 * Does this reel job hold a provider operation we DISPATCHED and never resolved?
 *
 * `recordProviderOp` already stamps every beat attempt with an outcome, and
 * `abandoned` means exactly one thing: we sent the request, the provider may
 * have accepted, run and BILLED it, and we stopped watching. The data has been
 * recorded since it was added and read by nothing.
 *
 * It is the difference between "this reservation is dead" and "this reservation
 * is the only record of money that may already be gone".
 */
async function jobHasUnresolvedProviderOps(actionId: string): Promise<boolean> {
  const m = /^reel_job_(\d+)$/.exec(actionId);
  if (!m) return false;
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return true; // cannot check => assume exposure; never release blind
    const { reelJobs } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [job] = await d.select({ payload: reelJobs.payload }).from(reelJobs).where(eq(reelJobs.id, Number(m[1]))).limit(1);
    if (!job) return false;
    const payload = JSON.parse(job.payload ?? "{}") as { storyboardBeats?: Array<{ providerOps?: Array<{ outcome?: string }> }> };
    return (payload.storyboardBeats ?? []).some((b) =>
      (b?.providerOps ?? []).some((op) => op?.outcome === "abandoned"),
    );
  } catch {
    return true; // unreadable => assume exposure
  }
}

export async function sweepStaleReservations(staleHours = RESERVATION_STALE_HOURS): Promise<{ released: string[]; retainedUnknownExposure: string[] }> {
  const out: { released: string[]; retainedUnknownExposure: string[] } = { released: [], retainedUnknownExposure: [] };
  try {
    const ctx = await ledgerDb();
    if (!ctx) return out;
    const { and, eq, lt } = await import("drizzle-orm");
    const cutoff = new Date(Date.now() - staleHours * 60 * 60 * 1000);

    const stale = await ctx.d
      .select()
      .from(ctx.table)
      .where(and(eq(ctx.table.status, "reserved"), lt(ctx.table.createdAt, cutoff)))
      .limit(50);

    for (const row of stale) {
      // AN UNKNOWN CHARGE IS NOT A DEAD RESERVATION.
      //
      // Releasing here would turn "the provider may have taken $1.25" into a
      // recorded zero — the ledger would read $0 spent while the provider's
      // invoice reads $1.25, and the daily ceiling would be enforced against
      // the wrong number in the permissive direction. Age is evidence that no
      // WORKER is coming back; it is no evidence at all about what the
      // PROVIDER did. Hold the exposure until something positively reconciles
      // it against the provider.
      if (await jobHasUnresolvedProviderOps(row.actionId)) {
        out.retainedUnknownExposure.push(row.actionId);
        continue;
      }
      await ctx.d
        .update(ctx.table)
        .set({ status: "released", settledAt: new Date() })
        .where(and(eq(ctx.table.id, row.id), eq(ctx.table.status, "reserved")));
      out.released.push(row.actionId);
    }
    if (out.released.length) {
      log.warn("released stale generation reservations — no worker will settle these", {
        count: out.released.length,
        actionIds: out.released.slice(0, 10),
        staleHours,
      });
    }
    if (out.retainedUnknownExposure.length) {
      // Deliberately a warn, not an info: this is money whose fate we do not
      // know, held against the day's budget on purpose. It should be visible
      // and it should be finite — a growing count here is the signal that a
      // provider-side reconciliation lane is genuinely needed, not optional.
      log.warn("stale reservations RETAINED — the provider may have charged for these", {
        count: out.retainedUnknownExposure.length,
        actionIds: out.retainedUnknownExposure.slice(0, 10),
        why: "beat carries a provider op with outcome=abandoned; age proves the worker is gone, not that the provider did nothing",
      });
    }
  } catch (err) {
    log.warn("stale-reservation sweep failed", { err: err instanceof Error ? err.message.slice(0, 160) : String(err) });
  }
  return out;
}

/** Settle after success. Pass actualCostUsd only when the provider reported
 *  real usage — otherwise the reservation's flagged estimate stands. */
export async function settle(actionId: string, actualCostUsd?: number): Promise<void> {
  return transition(actionId, "settled", actualCostUsd);
}

/** Release an unused reservation (nothing was spent). */
export async function release(actionId: string): Promise<void> {
  return transition(actionId, "released");
}

/** Record a failed spend (credits may have partially burned — the flagged
 *  estimate stands as the conservative record). */
export async function fail(actionId: string): Promise<void> {
  return transition(actionId, "failed", undefined);
}
