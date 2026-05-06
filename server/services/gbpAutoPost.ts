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
 */
function gbpUrl(baseUrl: string, campaign: string): string {
  if (baseUrl.startsWith("tel:") || baseUrl.startsWith("mailto:") || baseUrl.startsWith("sms:")) {
    return baseUrl;
  }
  if (baseUrl.includes("utm_source=")) return baseUrl;
  const sep = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${sep}utm_source=gbp&utm_medium=organic&utm_campaign=${encodeURIComponent(campaign)}`;
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
export async function generateAndNotifyGBPPost(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const now = new Date();
    const day = now.toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
    if (day !== "Monday") {
      return { recordsProcessed: 0, details: `Skip — runs Mondays only (today is ${day})` };
    }

    const { generateGBPPost } = await import("./gbpContentGenerator");
    const post = await generateGBPPost();
    const { sendTelegram } = await import("./telegram");
    const today = now.toLocaleDateString("en-US", {
      timeZone: BUSINESS.timezone, weekday: "long", month: "short", day: "numeric",
    });

    await sendTelegram(
      `📝 GBP POST — Week of ${today}\n\n` +
      `Archetype: ${post.archetype.toUpperCase()}\n` +
      `Paste at: business.google.com → Posts → Add update\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${post.text}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `🔗 CTA: ${post.callToAction}\n` +
      `🔗 URL: ${post.ctaUrl}\n` +
      `📸 Image: ${post.imageHint}`,
    );

    let monthlyDetails = "";
    // First-Monday-of-month recap. (Date 1-7 is the first occurrence of each weekday.)
    if (now.getDate() <= 7) {
      const recap = await buildMonthlyRecap();
      if (recap) {
        await sendTelegram(recap);
        monthlyDetails = " + monthly recap";
      }
    }

    return {
      recordsProcessed: 1,
      details: `GBP weekly post (${post.archetype})${monthlyDetails} → Telegram`,
    };
  } catch (err: unknown) {
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
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
export async function generateOneOffGBPPost(forceArchetype?: "proof" | "anti" | "math" | "seasonal"): Promise<{
  archetype: string;
  text: string;
  callToAction: string;
  ctaUrl: string;
  imageHint: string;
}> {
  const { generateGBPPost } = await import("./gbpContentGenerator");
  const post = await generateGBPPost(forceArchetype);
  return {
    archetype: post.archetype,
    text: post.text,
    callToAction: post.callToAction,
    ctaUrl: post.ctaUrl,
    imageHint: post.imageHint,
  };
}

log.info("GBP auto-poster loaded");
