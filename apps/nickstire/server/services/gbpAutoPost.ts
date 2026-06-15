/**
 * Google Business Profile Auto-Poster
 * Generates and queues GBP posts for specials, blog content, and seasonal promos.
 * Feature flag: gbp_auto_posting (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";
import { BUSINESS } from "@shared/business";

const log = createLogger("gbp-poster");

export interface GBPPost {
  id: string;
  type: "offer" | "update" | "event";
  text: string;
  callToAction: "BOOK" | "CALL" | "LEARN_MORE" | "ORDER";
  ctaUrl: string;
  imageUrl?: string;
  scheduledFor?: Date;
  status: "draft" | "scheduled" | "posted" | "failed";
  createdAt: Date;
}

/**
 * Tag a URL with GBP UTM params so analytics can attribute traffic
 * coming from Google Business Profile posts. Skips tagging for tel:/mailto:
 * URLs and for URLs that already have utm_source set.
 *
 * `archetype` (optional) sets utm_content so we can A/B which post type
 * (proof/anti/math/seasonal) drives conversions. Lets the playbook ratio
 * iterate from real data instead of static guesses.
 */
function gbpUrl(baseUrl: string, campaign: string, archetype?: string): string {
  if (baseUrl.startsWith("tel:") || baseUrl.startsWith("mailto:") || baseUrl.startsWith("sms:")) {
    return baseUrl;
  }
  if (baseUrl.includes("utm_source=")) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  const archetypePart = archetype ? `&utm_content=archetype-${encodeURIComponent(archetype)}` : "";
  return `${baseUrl}${sep}utm_source=gbp&utm_medium=organic&utm_campaign=${encodeURIComponent(campaign)}${archetypePart}`;
}

/** Create a GBP post draft from a special/promotion */
export function createSpecialPost(special: { title: string; description: string; expiresAt?: Date }): GBPPost {
  const text = `${special.title}\n\n${special.description}\n\n📍 ${BUSINESS.name} — ${BUSINESS.address.street}, ${BUSINESS.address.city}\n📞 ${BUSINESS.phone.display}\n⭐ ${BUSINESS.reviews.rating} stars, ${BUSINESS.reviews.countDisplay} reviews`;
  return {
    id: randomUUID(),
    type: "offer",
    text: text.slice(0, 1500),
    callToAction: "BOOK",
    ctaUrl: gbpUrl("https://nickstire.org/booking", "special"),
    status: "draft",
    createdAt: new Date(),
  };
}

/** Create a GBP post from blog content */
export function createBlogPost(blog: { title: string; excerpt: string; slug: string }): GBPPost {
  const text = `📝 New on our blog: ${blog.title}\n\n${blog.excerpt}\n\nRead more at nickstire.org/blog/${blog.slug}`;
  return {
    id: randomUUID(),
    type: "update",
    text: text.slice(0, 1500),
    callToAction: "LEARN_MORE",
    ctaUrl: gbpUrl(`https://nickstire.org/blog/${blog.slug}`, "blog"),
    status: "draft",
    createdAt: new Date(),
  };
}

/** Create a seasonal GBP post */
export function createSeasonalPost(season: { title: string; services: string[]; promoIdea: string }): GBPPost {
  const serviceList = season.services.slice(0, 3).join(", ");
  const text = `${season.title}\n\n${season.promoIdea}\n\nTop services this month: ${serviceList}\n\n📍 Walk-ins welcome 7 days a week\n📞 (216) 862-0005`;
  return {
    id: randomUUID(),
    type: "update",
    text: text.slice(0, 1500),
    callToAction: "CALL",
    ctaUrl: "tel:2168620005",
    status: "draft",
    createdAt: new Date(),
  };
}

/**
 * Auto-generate ONE voice-grade GBP post per week + ONE bigger
 * monthly recap on the first Monday of each month.
 *
 * Why Monday: GBP posts get most engagement Mon-Wed (Google + customer
 * data — people search for shops at the start of their week). Posting
 * Sunday night means it's stale by Monday traffic.
 *
 * GBP Posts API was deprecated in 2024 — copy-paste is the only path.
 * The leverage is voice quality + archetype rotation, not volume.
 *
 * Cadence:
 *   - Every Monday: 1 voice-grade post (rotates archetype per playbook ratio)
 *   - First Monday of month: ALSO a monthly summary block (specials
 *     overview + reviews snapshot)
 */
export async function generateAndNotifyGBPPost(opts?: { dryRun?: boolean; requiresReview?: boolean }): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const now = new Date();
    const day = now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
    if (day !== "Monday") {
      return { recordsProcessed: 0, details: `Skip — runs Mondays only (today is ${day})` };
    }

    const dryRun = opts?.dryRun !== false;
    const requiresReview = opts?.requiresReview !== false;

    // 24-hour cooldown check
    const { db } = await import("../lib/db-helper");
    const { gbpPostLog } = await import("../../drizzle/schema");
    const { desc } = await import("drizzle-orm");
    const d = await db();
    if (d) {
      const lastPosts = await d
        .select({ postedAt: gbpPostLog.postedAt })
        .from(gbpPostLog)
        .orderBy(desc(gbpPostLog.postedAt))
        .limit(1);
      if (lastPosts.length > 0) {
        const lastPostTime = new Date(lastPosts[0].postedAt).getTime();
        const diffMs = now.getTime() - lastPostTime;
        if (diffMs < 24 * 60 * 60 * 1000) {
          return { recordsProcessed: 0, details: `Skip — post generated within last 24 hours` };
        }
      }
    }

    const { generateGBPPost, logPostToDb } = await import("./gbpContentGenerator");
    const post = await generateGBPPost();

    // Provenance validation
    if (!post.provenance || !["real-review", "real-service-catalog", "real-offer", "generic-educational"].includes(post.provenance)) {
      throw new Error(`Invalid or missing provenance: ${post.provenance}`);
    }

    // Durable log so variety guard survives deploys + admin can review history.
    if (!dryRun) {
      await logPostToDb(post, "cron");
    }

    const { sendTelegram } = await import("./telegram");
    const today = now.toLocaleDateString("en-US", {
      timeZone: BUSINESS.timezone, weekday: "long", month: "short", day: "numeric",
    });

    const isDry = dryRun || requiresReview;
    const dryIndicator = isDry ? " (Requires Review - Dry Run)" : " (DRAFT - Requires Review)";

    await sendTelegram(
      `📝 GBP POST — Week of ${today}${dryIndicator}\n\n` +
      `Archetype: ${post.archetype.toUpperCase()}\n` +
      `Provenance: ${post.provenance}\n` +
      `Paste at: business.google.com → Posts → Add update\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${post.text}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔗 CTA: ${post.callToAction}\n` +
      `🔗 URL: ${post.ctaUrl}\n` +
      `📸 Image: ${post.imageHint}`,
    );

    let extras = "";
    const dom = now.getDate();
    // First-Monday-of-month recap. (Date 1-7 is the first occurrence of each weekday.)
    if (dom <= 7) {
      const recap = await buildMonthlyRecap();
      if (recap) {
        await sendTelegram(recap);
        extras += " + monthly recap";
      }
    }
    // Second-Monday-of-month photo nudge. (Date 8-14 is the 2nd occurrence.)
    // GBP rewards fresh photos as a ranking + engagement signal. Without
    // a structured nudge, photos go stale fast.
    if (dom >= 8 && dom <= 14) {
      const photoNudge = buildPhotoNudge();
      await sendTelegram(photoNudge);
      extras += " + photo nudge";
    }

    return {
      recordsProcessed: 1,
      details: `GBP weekly post (${post.archetype})${extras} → Telegram`,
    };
  } catch (err: unknown) {
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}

/**
 * Photo cadence nudge — fires the 2nd Monday of every month.
 *
 * Why monthly photos: GBP listings with fresh photos in the last 30 days
 * get more views + engagement than stale listings. Most shops upload 5
 * photos at launch and never refresh — easy ranking edge if you stay on
 * a calendar.
 *
 * The nudge rotates 4 photo themes through the year so the listing
 * doesn't end up with 12 storefront shots in a row.
 */
function buildPhotoNudge(): string {
  const month = new Date().getMonth(); // 0=Jan
  // wave-116 — was a silent fallback to themes[0] (January) if `month`
  // was somehow out-of-range (NaN, undefined, >11). 3×4=12 covers all
  // valid months exactly once, so the fallback was dead code masking
  // a serverless cold-start bug if it ever occurred. Assert + log so
  // the operator gets a signal instead of mysterious January-themed
  // posts year-round.
  if (!Number.isInteger(month) || month < 0 || month > 11) {
    throw new Error(`buildPhotoNudge: invalid month ${String(month)} from new Date().getMonth() — should be 0–11`);
  }
  const themes = [
    { months: [0, 4, 8],  topic: "the team",       shots: ["technician at work on a lifted car", "team photo in front of the storefront sign", "tech holding the part they replaced"] },
    { months: [1, 5, 9],  topic: "before/after",   shots: ["worn brake pad next to new pad", "rusted muffler next to fresh exhaust", "balding tire next to new tread"] },
    { months: [2, 6, 10], topic: "the storefront", shots: ["building exterior with sign at golden hour", "service-bay doors open with cars on lifts", "waiting area interior with the brand colors"] },
    { months: [3, 7, 11], topic: "the work",       shots: ["alignment rack with a car on it", "scan tool hooked to OBD-II", "tire-mounting machine mid-cycle"] },
  ];
  const theme = themes.find((t) => t.months.includes(month));
  // 3×4=12 covers every month — the find() should never miss. If it
  // does, that's a programmer error, not data drift.
  if (!theme) {
    throw new Error(`buildPhotoNudge: no theme found for month ${month} (themes incomplete)`);
  }
  const shotList = theme.shots.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
  return `📸 GBP PHOTO NUDGE — ${theme.topic.toUpperCase()}\n\n` +
    `GBP rewards listings that stay fresh. Suggested shots this month:\n\n` +
    `${shotList}\n\n` +
    `Upload at: business.google.com → Photos → Add (mobile or desktop)\n` +
    `3-5 new photos = strong signal. Quick phone shots are fine — authentic beats polished.`;
}

/**
 * Monthly recap — fires on the first Monday of each month alongside
 * the regular weekly post. Includes:
 *   - Last month's review count + average rating
 *   - Active specials (so Nour can surface them in GBP)
 *   - Suggested "month theme" for the upcoming 4 posts
 *
 * Uses real shop data — google-reviews + specials table.
 */
async function buildMonthlyRecap(): Promise<string | null> {
  try {
    const monthName = new Date().toLocaleString("en-US", {
      timeZone: BUSINESS.timezone, month: "long", year: "numeric",
    });

    // Reviews snapshot
    let reviewLine = "Reviews: data unavailable";
    try {
      const { getGoogleReviews } = await import("../google-reviews");
      const data = await getGoogleReviews();
      if (data) {
        reviewLine = `Reviews: ${data.totalReviews ?? "?"} total · ${data.rating ?? "?"}★ avg`;
      }
    } catch { /* non-critical — skip review line */ }

    // Specials snapshot
    let specialsLine = "Active specials: none right now";
    try {
      const { db } = await import("../lib/db-helper");
      const { specials } = await import("../../drizzle/schema");
      const { sql, eq, and } = await import("drizzle-orm");
      const d = await db();
      if (d) {
        const rows = await d
          .select({ title: specials.title, code: specials.couponCode })
          .from(specials)
          .where(
            and(
              eq(specials.isActive, true),
              eq(specials.displayOnWebsite, true),
              sql`(${specials.expiresAt} IS NULL OR ${specials.expiresAt} > NOW())`,
            ),
          )
          .limit(5);
        if (rows.length > 0) {
          specialsLine = `Active specials (${rows.length}):\n` +
            rows.map((r: { title: string; code: string | null }) => `  · ${r.title}${r.code ? ` (${r.code})` : ""}`).join("\n");
        }
      }
    } catch { /* non-critical */ }

    return `📊 MONTHLY GBP RECAP — ${monthName}\n\n` +
      `${reviewLine}\n\n` +
      `${specialsLine}\n\n` +
      `Suggested theme this month: rotate through the 4 archetypes (Proof, Anti, Math, Seasonal). The voice-compliance test guards against cliché creep — anything that ships will be voice-graded automatically.\n\n` +
      `Reminder: post weekly at business.google.com → Posts → Add update`;
  } catch {
    return null;
  }
}

/**
 * Manual one-off post generator — admin-triggered.
 * Returns the post text + Telegram-ready payload without auto-sending.
 * Used by admin "Generate GBP Post" button.
 */
export async function generateOneOffGBPPost(
  forceArchetype?: "proof" | "anti" | "math" | "seasonal",
  opts?: { dryRun?: boolean; requiresReview?: boolean }
): Promise<{
  archetype: string;
  text: string;
  callToAction: string;
  ctaUrl: string;
  imageHint: string;
  provenance: string;
}> {
  const dryRun = opts?.dryRun !== false;
  const { generateGBPPost, logPostToDb } = await import("./gbpContentGenerator");
  const post = await generateGBPPost(forceArchetype);

  // Provenance validation
  if (!post.provenance || !["real-review", "real-service-catalog", "real-offer", "generic-educational"].includes(post.provenance)) {
    throw new Error(`Invalid or missing provenance: ${post.provenance}`);
  }

  // Log admin-triggered posts too — counts toward variety guard so we don't
  // generate same archetype/topic via cron right after.
  if (!dryRun) {
    await logPostToDb(post, "admin");
  }
  return {
    archetype: post.archetype,
    text: post.text,
    callToAction: post.callToAction,
    ctaUrl: post.ctaUrl,
    imageHint: post.imageHint,
    provenance: post.provenance,
  };
}

log.info("GBP auto-poster loaded");
