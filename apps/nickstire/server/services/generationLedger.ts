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

const log = createLogger("services:generation-ledger");

/** ESTIMATES — Higgsfield does not expose per-call USD through the CLI; these
 *  are operator-tunable stand-ins and every row they touch is FLAGGED
 *  isEstimate until a real provider-usage feed replaces them. */
export const COST_ESTIMATES_USD = {
  seedance_clip: 0.25, // ASSUMPTION (unverified): believed ~12 credits/clip; Higgsfield publishes no per-call USD - operator-tunable
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
  if (provider !== "veo") return COST_ESTIMATES_USD.seedance_clip;
  // Number(undefined) and Number("abc") are NaN, Number("") is 0 — all falsy,
  // so a missing or malformed override falls back rather than booking a zero.
  const seconds = Number(env.REEL_VEO_DURATION) || VEO_DEFAULT_CLIP_SECONDS;
  const perSecond = Number(env.REEL_VEO_USD_PER_SECOND) || COST_ESTIMATES_USD.veo_second_720p;
  return seconds * perSecond;
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
