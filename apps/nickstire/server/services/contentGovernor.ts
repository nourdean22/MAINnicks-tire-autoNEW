/**
 * Content governor — Long Haul milestone 5: global cadence + collision control.
 *
 * Two layers, so legacy systems defer without each being rewritten:
 *
 * 1. CREATION reservations (`requestReservation`) — called BEFORE expensive
 *    production (reel enqueue today; carousel/photo creators as they wire in).
 *    Denies over-cap days, tight spacing, and topic/CTA/territory repetition
 *    against live reservations, so provider credits never burn for a post
 *    that could not be scheduled anyway.
 *
 * 2. PUBLISH-DOOR assertion (`assertPublishCadence`) — read-only check inside
 *    publishToSocial (the one Meta door) against ACTUALLY PUBLISHED inventory:
 *    daily caps and minimum spacing hold at the moment of irreversible action
 *    for every caller (scheduled posts, autoposters, admin), reservation or
 *    not.
 *
 * Reservation→publish consumption linkage (marking a specific reservation
 *  consumed by its published asset) is deliberately deferred until assets
 *  carry reservation ids through their payloads — documented, not faked.
 *
 * Degrades gracefully until drizzle/0086 is applied: reservations WARN +
 * null; the publish-door check still runs (it reads inventory, not the
 * reservations table).
 */
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger";
import { clevelandDayStart } from "./autonomyControl";

const log = createLogger("services:content-governor");

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export interface ReservationRequest {
  platform: "instagram" | "facebook";
  format: "reel" | "carousel" | "photo" | "story";
  windowStart: Date;
  windowEnd: Date;
  topic?: string;
  cta?: string;
  territory?: string;
  campaignId?: string | null;
  priority?: number;
}

export class GovernorDenial extends Error {
  constructor(public codes: string[]) {
    super(`Blocked by content governor: ${codes.join(", ")}`);
  }
}

const REPEAT_LOOKBACK = { topicDays: 7, ctaHours: 72, territoryHours: 48 } as const;

async function governorDb() {
  const { getDb } = await import("../db");
  const d = await getDb();
  if (!d) return null;
  const schema = await import("../../drizzle/schema");
  if (!("contentReservations" in schema)) return null;
  return { d, table: schema.contentReservations };
}

/**
 * Reserve a content slot before production. Throws GovernorDenial with codes;
 * returns null (loudly) when the reservations table is unavailable.
 */
export async function requestReservation(req: ReservationRequest): Promise<{ reservationId: string } | null> {
  const ctx = await governorDb();
  if (!ctx) {
    log.warn("reservations unavailable (0086 pending?) — creation proceeds ungoverned", { format: req.format });
    return null;
  }
  const { and, eq, gte, inArray, ne } = await import("drizzle-orm");
  const now = new Date();

  // Opportunistic expiry sweep — stale reservations must not eat the caps.
  try {
    const { lt } = await import("drizzle-orm");
    await ctx.d
      .update(ctx.table)
      .set({ status: "expired" })
      .where(and(eq(ctx.table.status, "reserved"), lt(ctx.table.windowEnd, now)));
  } catch { /* sweep is best-effort */ }

  const { getActivePolicy } = await import("./autonomyControl");
  const policy = await getActivePolicy();
  const codes: string[] = [];
  const dayStart = clevelandDayStart(req.windowStart);
  const liveRaw = await ctx.d
    .select()
    .from(ctx.table)
    .where(and(inArray(ctx.table.status, ["reserved", "consumed"]), gte(ctx.table.windowStart, dayStart), ne(ctx.table.status, "expired")));
  type ResRow = { format: string; topic: string | null; cta: string | null; territory: string | null; windowStart: Date | string; createdAt: Date | string };
  const live: ResRow[] = Array.isArray(liveRaw) ? (liveRaw as ResRow[]) : [];

  const isStory = req.format === "story";
  const sameDayFeed = live.filter((r: ResRow) => r.format !== "story");
  const sameDayStories = live.filter((r: ResRow) => r.format === "story");
  if (!isStory && sameDayFeed.length >= policy.limits.maxFeedPostsPerDay) codes.push("RESERVATION_FEED_CAP");
  if (isStory && sameDayStories.length >= policy.limits.maxStoriesPerDay) codes.push("RESERVATION_STORY_CAP");

  if (!isStory) {
    const spacingMs = policy.limits.minimumFeedSpacingHours * 3600_000;
    const collision = sameDayFeed.find((r: ResRow) => Math.abs(new Date(r.windowStart).getTime() - req.windowStart.getTime()) < spacingMs);
    if (collision) codes.push("RESERVATION_SPACING");
  }

  if (req.topic) {
    const topicN = norm(req.topic);
    const since = new Date(now.getTime() - REPEAT_LOOKBACK.topicDays * 86_400_000);
    const allRaw = await ctx.d
      .select()
      .from(ctx.table)
      .where(and(inArray(ctx.table.status, ["reserved", "consumed"]), gte(ctx.table.createdAt, since)));
    const all: ResRow[] = Array.isArray(allRaw) ? (allRaw as ResRow[]) : [];
    if (all.some((r: ResRow) => r.topic && norm(r.topic) === topicN)) codes.push("REPEAT_TOPIC");
    if (req.cta) {
      const ctaSince = now.getTime() - REPEAT_LOOKBACK.ctaHours * 3600_000;
      if (all.some((r: ResRow) => r.cta && r.cta === req.cta && new Date(r.createdAt).getTime() > ctaSince)) codes.push("REPEAT_CTA");
    }
    if (req.territory) {
      const terrSince = now.getTime() - REPEAT_LOOKBACK.territoryHours * 3600_000;
      if (all.some((r: ResRow) => r.territory && r.territory === req.territory && new Date(r.createdAt).getTime() > terrSince)) codes.push("REPEAT_TERRITORY");
    }
  }

  if (codes.length) {
    log.warn("reservation denied", { format: req.format, codes: codes.join(",") });
    throw new GovernorDenial(codes);
  }

  const reservationId = `resv_${randomUUID()}`;
  await ctx.d.insert(ctx.table).values({
    id: reservationId,
    campaignId: req.campaignId ?? null,
    platform: req.platform,
    format: req.format,
    topic: req.topic?.slice(0, 300) ?? null,
    cta: req.cta?.slice(0, 120) ?? null,
    territory: req.territory?.slice(0, 64) ?? null,
    windowStart: req.windowStart,
    windowEnd: req.windowEnd,
    priority: req.priority ?? 50,
    status: "reserved",
  });
  log.info("content slot reserved", { reservationId, format: req.format, window: req.windowStart.toISOString() });
  return { reservationId };
}

export async function releaseReservation(reservationId: string): Promise<void> {
  const ctx = await governorDb();
  if (!ctx) return;
  const { eq } = await import("drizzle-orm");
  await ctx.d.update(ctx.table).set({ status: "released" }).where(eq(ctx.table.id, reservationId));
}

export async function consumeReservation(reservationId: string): Promise<void> {
  const ctx = await governorDb();
  if (!ctx) return;
  const { eq } = await import("drizzle-orm");
  await ctx.d.update(ctx.table).set({ status: "consumed" }).where(eq(ctx.table.id, reservationId));
}

/**
 * Publish-door cadence check — reads ACTUALLY PUBLISHED inventory (not
 * reservations), so it holds for every publish path regardless of whether the
 * creator reserved. Throws GovernorDenial; a read failure allows (the policy
 * kill switches and claim gates still govern — cadence is a quality control,
 * not a safety boundary).
 */
export async function assertPublishCadence(input: { format: "reel" | "carousel" | "photo" | "story" }): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return;
    const { socialContentInventory } = await import("../../drizzle/schema");
    const { and, gte, isNotNull, ne, desc } = await import("drizzle-orm");
    const { getActivePolicy } = await import("./autonomyControl");
    const policy = await getActivePolicy();

    const rowsRaw = await d
      .select({ publishedAt: socialContentInventory.publishedAt, contentType: socialContentInventory.contentType })
      .from(socialContentInventory)
      .where(and(isNotNull(socialContentInventory.publishedAt), gte(socialContentInventory.publishedAt, clevelandDayStart()), ne(socialContentInventory.contentType, "story")))
      .orderBy(desc(socialContentInventory.publishedAt));
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

    /**
     * THE CAP MUST COUNT EVERY DOOR, NOT THE ONE IT WAS WRITTEN BESIDE.
     *
     * This counted only social_content_inventory.publishedAt — the Queue's own
     * publishes. Two other doors reach Instagram and never stamp that column:
     *   - the daily reel cron settles onto reel_jobs.status='posted'
     *   - the scheduled-post worker settles onto scheduled_posts.status='posted'
     *
     * So "max 2 feed posts per day" was really "max 2 posts THROUGH THE QUEUE per
     * day", and a cron reel plus a scheduled post plus two Queue publishes was
     * four posts against a cap of two — with the governor reporting no breach,
     * because it never saw the other two.
     *
     * Counted defensively: a source that cannot be read contributes 0 AND is
     * named in the log, rather than silently lowering the count. An undercount
     * here spends the operator's audience, which is the resource this cap exists
     * to protect.
     */
    let externalFeedPosts = 0;
    try {
      const { reelJobs, scheduledPosts } = await import("../../drizzle/schema");
      const { eq: eqx, and: andx, gte: gtex, inArray: inArrayx, sql: sqlx } = await import("drizzle-orm");
      const since = clevelandDayStart();
      const [reelRow] = await d
        .select({ n: sqlx<number>`COUNT(*)`.as("n") })
        .from(reelJobs)
        .where(andx(eqx(reelJobs.status, "posted"), gtex(reelJobs.updatedAt, since)));
      const [schedRow] = await d
        .select({ n: sqlx<number>`COUNT(*)`.as("n") })
        .from(scheduledPosts)
        .where(andx(inArrayx(scheduledPosts.status, ["posted"]), gtex(scheduledPosts.postedAt, since)));
      externalFeedPosts = Number(reelRow?.n ?? 0) + Number(schedRow?.n ?? 0);
    } catch (err) {
      log.warn("feed cap: could not count cron/scheduled publishes — cap is counting the Queue only", err);
    }

    if (input.format !== "story") {
      if (rows.length + externalFeedPosts >= policy.limits.maxFeedPostsPerDay) {
        throw new GovernorDenial(["PUBLISH_FEED_CAP"]);
      }
      const latest = rows[0]?.publishedAt ? new Date(rows[0].publishedAt).getTime() : 0;
      if (latest && Date.now() - latest < policy.limits.minimumFeedSpacingHours * 3600_000) {
        throw new GovernorDenial(["PUBLISH_SPACING"]);
      }
    }
  } catch (err) {
    if (err instanceof GovernorDenial) throw err;
    log.warn("publish cadence check unavailable — proceeding (kill switches + claim gates still govern)", {
      err: err instanceof Error ? err.message.slice(0, 120) : String(err),
    });
  }
}
