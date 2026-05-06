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
 * Auto-generate GBP posts and send via Telegram for manual posting.
 *
 * 2026-05-05 upgrade: was 1 cliché-laden seasonal post once per week.
 * Now generates a FULL WEEK of 3 voice-grade posts every Sunday night
 * via the new gbpContentGenerator (4 archetypes from social-content
 * playbook + variety guard + real-data integration).
 *
 * Why Sunday batch: Nour copies all 3 posts in one Telegram thread
 * Sunday evening, then pastes them into business.google.com on Mon
 * (proof), Wed (math/anti), Fri (seasonal). Compounds local SEO via
 * GBP posting frequency without daily mental load.
 *
 * GBP Posts API was deprecated in 2024 — copy-paste is the only path.
 */
export async function generateAndNotifyGBPPost(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    // Run only on Sundays (or first run after deploy if last-run-day check is added)
    const day = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
    if (day !== "Sunday") {
      return { recordsProcessed: 0, details: `Skip — runs Sundays only (today is ${day})` };
    }

    const { generateWeeklyPostBatch } = await import("./gbpContentGenerator");
    const posts = await generateWeeklyPostBatch();

    if (posts.length === 0) {
      return { recordsProcessed: 0, details: "Generator returned 0 posts" };
    }

    const { sendTelegram } = await import("./telegram");

    // One Telegram message per post — easier to copy individually.
    // Plus a header message with the schedule.
    const today = new Date().toLocaleDateString("en-US", {
      timeZone: BUSINESS.timezone, weekday: "long", month: "short", day: "numeric",
    });
    await sendTelegram(
      `📝 GBP POSTS — Week of ${today}\n\n` +
      `${posts.length} voice-grade posts ready for the week.\n` +
      `Suggested schedule:\n` +
      `· Monday morning: Post #1 (${posts[0].archetype})\n` +
      `· Wednesday morning: Post #2 (${posts[1]?.archetype ?? "—"})\n` +
      `· Friday morning: Post #3 (${posts[2]?.archetype ?? "—"})\n\n` +
      `Each post message below has:\n` +
      `  • Copy-paste body\n` +
      `  • Suggested CTA + URL\n` +
      `  • Image hint\n\n` +
      `Paste at: business.google.com → Posts → Add update`,
    );

    let i = 1;
    for (const p of posts) {
      const archetypeLabel = p.archetype.toUpperCase();
      await sendTelegram(
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `POST #${i} · ${archetypeLabel}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `${p.text}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🔗 CTA: ${p.callToAction}\n` +
        `🔗 URL: ${p.ctaUrl}\n` +
        `📸 Image: ${p.imageHint}`,
      );
      i++;
    }

    return {
      recordsProcessed: posts.length,
      details: `Generated ${posts.length} voice-grade GBP posts (${posts.map((p) => p.archetype).join(", ")}) → Telegram batch`,
    };
  } catch (err: unknown) {
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
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
