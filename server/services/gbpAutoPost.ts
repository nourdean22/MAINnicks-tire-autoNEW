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
 * Auto-generate a GBP post and send via Telegram for manual posting.
 * Until we have GBP API access, this gives Nour copy-paste content weekly.
 */
export async function generateAndNotifyGBPPost(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    // Only generate weekly (check day — run on Mondays)
    const day = new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, weekday: "long" });
    if (day !== "Monday") return { recordsProcessed: 0, details: "Not Monday — skipping GBP post" };

    const month = new Date().getMonth();
    const isWinter = month >= 10 || month <= 2;
    const isSummer = month >= 5 && month <= 7;

    let post: GBPPost;
    if (isWinter) {
      post = createSeasonalPost({
        title: "Winter Prep at Nick's Tire & Auto",
        services: ["Battery Test (FREE)", "Tire Check", "Coolant Flush", "Wiper Blades"],
        promoIdea: "Cleveland winters are brutal. Get your car ready before the first snow. Walk-ins welcome!",
      });
    } else if (isSummer) {
      post = createSeasonalPost({
        title: "Summer Road Trip Ready?",
        services: ["A/C Check", "Tire Rotation", "Brake Inspection", "Oil Change"],
        promoIdea: "Planning a road trip? Make sure your vehicle is ready. Free multi-point inspection this month!",
      });
    } else {
      post = createSeasonalPost({
        title: "Your Car Deserves Honest Repair",
        services: ["Full Diagnosis", "Brakes", "Tires", "Maintenance"],
        promoIdea: "Family-owned shop in Euclid. Honest pricing, quality work. Walk-ins welcome 7 days a week.",
      });
    }

    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `📝 WEEKLY GBP POST — Copy & paste to Google Business Profile:\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n` +
      `${post.text}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Type: ${post.type} | CTA: ${post.callToAction}\n` +
      `Post at: business.google.com → Posts → Add update`
    );

    return { recordsProcessed: 1, details: "GBP post sent to Telegram" };
  } catch (err: unknown) {
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}

log.info("GBP auto-poster loaded");
