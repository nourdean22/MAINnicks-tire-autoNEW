/**
 * GBP Content Generator — voice-grade post generation for Google Business Profile.
 *
 * Implements the 4 post archetypes from `docs/social-content-playbook.md`:
 *   1. THE PROOF POST       — Real customer + real result (50% of posts)
 *   2. THE ANTI-POST        — Industry honesty / anti-promises (15%)
 *   3. THE FIRST-PRINCIPLES — Math-as-argument (15%)
 *   4. THE SEASONAL POST    — Cleveland-specific timing (20%)
 *
 * Pulls from REAL shop data — recent reviews, active specials, current weather,
 * actual seasonal context — not stock seasonal templates.
 *
 * Variety guard: tracks the last 14 archetypes/topics fired so we don't post
 * 3× the same template in a row. Stored in-memory (resets on deploy — fine
 * because the worst case is a single repeat after deploy).
 *
 * VOICE.md compliance:
 * - 0 cliché kill-list violations (no "trusted", "expert", "quality" labels)
 * - Concrete numbers + addresses + named services
 * - Anti-promises and footnote asterisks where the playbook calls for them
 *
 * Why no GBP API push: Google deprecated the GBP Posts API in v4 (2024).
 * Posts must be created via the Google Business Profile web UI. This
 * generator outputs Telegram-friendly copy-paste blocks that Nour pastes
 * into business.google.com once a week (or 3× via cadence).
 */

import { BUSINESS } from "@shared/business";
import { OIL_PRICE, BRAKE_PRICE, SERVICE_PRICE } from "@shared/pricing";
import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import type { GoogleReview } from "../google-reviews";
import { specials, gbpPostLog, reviewPipeline } from "../../drizzle/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";

const log = createLogger("gbp-content-generator");

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type GBPArchetype = "proof" | "anti" | "math" | "seasonal";
export type GBPCallToAction = "BOOK" | "CALL" | "LEARN_MORE" | "ORDER";
export type GBPProvenance = "real-review" | "real-service-catalog" | "real-offer" | "generic-educational";

export interface GeneratedGBPPost {
  archetype: GBPArchetype;
  text: string;                 // 800-1500 chars (GBP limit is 1500)
  callToAction: GBPCallToAction;
  ctaUrl: string;
  imageHint: string;            // suggested photo for the post
  topicHash: string;            // for variety guard
  provenance: GBPProvenance;
}

// Variety guard. Hybrid: DB (durable, survives deploys) + in-memory cache
// (fast, avoids re-querying for every attempt). DB is source of truth on
// startup; cache is hydrated from DB once per server lifetime, then mutated
// in-process.
//
// Why hybrid: the generator runs synchronously inside a single request
// (admin button) or cron tick. We don't want to round-trip the DB 4× during
// the variety-retry loop. So we hydrate once, then dedup against memory.
const RECENT_LIMIT = 14;
let RECENT_TOPICS: string[] = [];
let HYDRATED_AT: number | null = null;
const HYDRATE_TTL_MS = 5 * 60 * 1000; // re-hydrate every 5 min

async function hydrateRecentTopicsFromDb(): Promise<void> {
  // Re-hydrate if first call OR cache stale (>5 min old).
  if (HYDRATED_AT && Date.now() - HYDRATED_AT < HYDRATE_TTL_MS) return;
  try {
    const d = await db();
    if (!d) return; // DB down — fall through to in-memory only
    const rows = await d
      .select({ topicHash: gbpPostLog.topicHash })
      .from(gbpPostLog)
      .orderBy(desc(gbpPostLog.postedAt))
      .limit(RECENT_LIMIT);
    RECENT_TOPICS = rows.map((r: { topicHash: string }) => r.topicHash);
    HYDRATED_AT = Date.now();
  } catch (err) {
    log.warn("hydrate failed, falling back to memory-only variety guard", { err: err instanceof Error ? err.message : String(err) });
  }
}

function recordTopic(hash: string) {
  RECENT_TOPICS.unshift(hash);
  if (RECENT_TOPICS.length > RECENT_LIMIT) RECENT_TOPICS.length = RECENT_LIMIT;
}

function isRecentTopic(hash: string): boolean {
  return RECENT_TOPICS.includes(hash);
}

/**
 * Insert a row into gbp_post_log. Fire-and-forget — failure to log
 * shouldn't block the post generation. Cron + admin both call this.
 */
export async function logPostToDb(post: GeneratedGBPPost, source: "cron" | "admin"): Promise<void> {
  try {
    const d = await db();
    if (!d) return;
    await d.insert(gbpPostLog).values({
      archetype: post.archetype,
      topicHash: post.topicHash,
      postBody: post.text.slice(0, 1500),
      ctaType: post.callToAction,
      ctaUrl: post.ctaUrl.slice(0, 500),
      imageHint: post.imageHint,
      source,
    });
  } catch (err) {
    log.warn("gbpPostLog insert failed (non-critical)", { err: err instanceof Error ? err.message : String(err) });
  }
}

// ─────────────────────────────────────────────────────────
// HELPERS & VALIDATION
// ─────────────────────────────────────────────────────────

function weekSeed(): string {
  const d = new Date();
  const onejan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${d.getFullYear()}-w${week}`;
}

function formatAuthorName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (/^[A-Za-z]+$/.test(last)) {
      return `${first} ${last[0]}.`;
    }
    return `${first} ${last}`;
  }
  return name;
}

function assertNoFabrication(text: string): void {
  const forbidden = [
    "1,200",
    "487",
    "grinding brakes",
    "dealer quote",
    "dealer trying to upsell",
    "PROOF_SCENARIOS",
    "Marcus L.",
    "Tina B.",
    "Greg M.",
    "Amber S.",
    "Diane H.",
  ];
  const lower = text.toLowerCase();
  for (const item of forbidden) {
    if (lower.includes(item.toLowerCase())) {
      throw new Error(`Fabrication guard triggered: text contains forbidden placeholder/mock artifact "${item}"`);
    }
  }
}

function getWords(str: string): Set<string> {
  const words = str.toLowerCase().match(/\b\w+\b/g) || [];
  return new Set(words);
}

export function jaccardSimilarity(str1: string, str2: string): number {
  const words1 = getWords(str1);
  const words2 = getWords(str2);
  if (words1.size === 0 && words2.size === 0) return 1;
  
  let intersectionSize = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersectionSize++;
    }
  }
  const unionSize = words1.size + words2.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

function validateNoUnsourcedCustomerIdentity(text: string, archetype: GBPArchetype): void {
  if (archetype === "proof") return;
  
  const lower = text.toLowerCase();
  if (
    lower.includes("customer said") || 
    lower.includes("client said") || 
    lower.includes("customer mentioned") || 
    lower.includes("he said") || 
    lower.includes("she said")
  ) {
    throw new Error(`Fabrication guard triggered: non-proof archetype contains unsourced customer quote/attribution.`);
  }
  
  // Match Name LastInitial pattern (e.g. John D. or John D)
  const nameInitialRegex = /\b[A-Z][a-z]+\s+[A-Z]\b\.?/g;
  if (nameInitialRegex.test(text)) {
    throw new Error(`Fabrication guard triggered: non-proof archetype contains name with last initial pattern.`);
  }
}

// ─────────────────────────────────────────────────────────
// ARCHETYPE 1 — PROOF POST
// Real customer review text from Google Reviews cache
// ─────────────────────────────────────────────────────────

async function getRealReviewsFromDb(): Promise<GoogleReview[]> {
  try {
    const d = await db();
    if (!d) return [];

    const rows = await d
      .select({
        authorName: reviewPipeline.authorName,
        rating: reviewPipeline.rating,
        reviewText: reviewPipeline.reviewText,
        reviewTime: reviewPipeline.reviewTime,
        relativeTime: reviewPipeline.relativeTime,
      })
      .from(reviewPipeline)
      .where(gte(reviewPipeline.rating, 4));

    return rows
      .filter((r: any) => r.reviewText && r.reviewText.trim().length >= 10)
      .map((r: any) => ({
        authorName: r.authorName,
        rating: r.rating,
        text: r.reviewText || "",
        relativeTime: r.relativeTime || "recently",
        time: r.reviewTime || Math.floor(Date.now() / 1000),
      }));
  } catch (err) {
    log.warn("getRealReviewsFromDb failed", { err: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

async function buildProofPost(): Promise<GeneratedGBPPost> {
  const qualifyingReviews = await getRealReviewsFromDb();

  if (qualifyingReviews.length === 0) {
    throw new Error("No qualifying Google reviews (rating >= 4 with text) found in Database");
  }

  const seed = weekSeed() + "-proof";
  const review = qualifyingReviews[Math.abs(hashStr(seed)) % qualifyingReviews.length];
  
  const author = formatAuthorName(review.authorName);
  const excerpt = review.text.length > 200 ? review.text.slice(0, 200) + "..." : review.text;
  
  const text = `${author} shared their experience with ${BUSINESS.name}:

"${excerpt}"

Drop in any day, walk-ins welcome.
${BUSINESS.address.full} · ${BUSINESS.phone.display}`;

  return {
    archetype: "proof",
    text,
    callToAction: "CALL",
    ctaUrl: BUSINESS.phone.href,
    imageHint: "photo of our service bays or a happy customer's car",
    topicHash: `proof-${review.authorName.slice(0, 10)}-${review.time}`,
    provenance: "real-review",
  };
}

// ─────────────────────────────────────────────────────────
// ARCHETYPE 2 — ANTI-POST
// "We won't replace pads that pass the check."
// ─────────────────────────────────────────────────────────

const ANTI_PROMISE_SETS = [
  {
    promises: [
      "We won't replace pads that pass the check.",
      "We won't quote a fix without showing you the broken part.",
      "We won't add a fee at pickup that wasn't on the written estimate.",
    ],
    closer: "Cleveland deserves a shop that earns the bill instead of inflating it.",
    imageHint: "the storefront sign at golden hour — brand-sign.webp",
  },
  {
    promises: [
      "We won't bury \"shop fees\" in the fine print.",
      "We won't tell you it's urgent without the photo to prove it.",
      "We won't push synthetic on a car that runs fine on conventional.",
    ],
    closer: "Honest doesn't have to be a marketing word — it can be a way of writing the invoice.",
    imageHint: "a receipt with every line itemized, no add-ons",
  },
  {
    promises: [
      "We won't replace 4 tires when 1 has a fixable nail.",
      "We won't recommend a service your manual doesn't.",
      "We won't disappear after the work — every repair carries a 12-month / 12,000-mile warranty.",
    ],
    closer: "The yellow's a little louder in person. So is the math.",
    imageHint: "the workshop bay with two cars on lifts mid-service",
  },
];

function buildAntiPost(): GeneratedGBPPost {
  const seed = weekSeed() + "-anti";
  const set = ANTI_PROMISE_SETS[Math.abs(hashStr(seed)) % ANTI_PROMISE_SETS.length];
  const text = `${set.promises.join("\n")}

${set.closer}

${BUSINESS.phone.display} · open 7 days · ${BUSINESS.address.full}`;
  return {
    archetype: "anti",
    text,
    callToAction: "CALL",
    ctaUrl: BUSINESS.phone.href,
    imageHint: set.imageHint,
    topicHash: `anti-${set.promises[0].slice(0, 25)}`,
    provenance: "generic-educational",
  };
}

// ─────────────────────────────────────────────────────────
// ARCHETYPE 3 — FIRST-PRINCIPLES (math-as-argument)
// "$299 brake pads today. $950 caliper and rotor replacement in 30 days."
// ─────────────────────────────────────────────────────────

const MATH_ARGUMENTS = [
  {
    today: { amount: `$${BRAKE_PRICE.padsMax}`, thing: "brake pads on one axle" },
    later: { amount: `$${BRAKE_PRICE.caliperAndRotorReplacementEstimate}`, thing: "caliper and rotor replacement if worn to the metal" },
    explanation: "Cleveland salt eats brake hardware faster than dry-state cars. Catching it early IS the maintenance.",
    paymentProgram: "Payment Programs: Acima · Snap · Koalafi · $10 down today · pay it down monthly",
    imageHint: `side-by-side: worn pad ($${BRAKE_PRICE.padsMax}) and chewed-up rotor ($${BRAKE_PRICE.caliperAndRotorReplacementEstimate}) with prices overlaid in brand yellow`,
  },
  {
    today: { amount: `$${SERVICE_PRICE.eCheckFixStarting}`, thing: "E-Check fix today" },
    later: { amount: "$0 — but a $150 ticket and impound risk", thing: "in 30 days when registration expires" },
    explanation: "Failed E-Check has a 30-day deadline. Day 31, you're parked. Most failures are exhaust-related and fixable in an afternoon.",
    paymentProgram: "Payment programs: $10 down · pay over time · pass promise/assistance or we keep working",
    imageHint: "the actual E-Check repair certificate next to a state-issued failed-test letter",
  },
  {
    today: { amount: `$${OIL_PRICE.fullSynthetic}`, thing: "synthetic oil change today" },
    later: { amount: "$4,000+", thing: "engine rebuild in 60K miles if you skip oil changes" },
    explanation: "Sludge from old oil destroys engines. The math is brutal but the maintenance is cheap.",
    paymentProgram: "Walk in any day. 30 minutes. Free 27-point check while you wait.",
    imageHint: "drained black oil pan vs clean new oil — same engine, 90 days apart",
  },
  {
    today: { amount: `$${SERVICE_PRICE.tirePatch}`, thing: "tire patch today" },
    later: { amount: "$1,000+", thing: "for 4 new tires the dealer says you need" },
    explanation: "Most flats are repairable. Most dealers won't tell you that. We will.",
    paymentProgram: "25 minutes. Walk in. We show you the nail before we plug it.",
    imageHint: `a roofing nail on the floor next to a tire — caption: '$${SERVICE_PRICE.tirePatch}'`,
  },
];

function buildMathPost(): GeneratedGBPPost {
  const seed = weekSeed() + "-math";
  const m = MATH_ARGUMENTS[Math.abs(hashStr(seed)) % MATH_ARGUMENTS.length];
  const text = `${m.today.amount} ${m.today.thing}.
${m.later.amount} ${m.later.thing}.

${m.explanation}

${m.paymentProgram}.
${BUSINESS.phone.display}`;
  return {
    archetype: "math",
    text,
    callToAction: "LEARN_MORE",
    // utm_content=archetype lets analytics A/B which post type drives
    // conversions. Lets the playbook ratio iterate from real data.
    ctaUrl: `${BUSINESS.urls.website}/financing?utm_source=gbp&utm_medium=organic&utm_campaign=math-post&utm_content=archetype-math`,
    imageHint: m.imageHint,
    topicHash: `math-${m.today.amount}-vs-${m.later.amount}`,
    provenance: "real-service-catalog",
  };
}

// ─────────────────────────────────────────────────────────
// ARCHETYPE 4 — SEASONAL POST
// Cleveland-specific timing
// ─────────────────────────────────────────────────────────

interface SeasonalContext {
  title: string;
  consequence: string;
  service: string;
  imageHint: string;
}

function pickSeasonalContext(): SeasonalContext {
  const month = new Date().getMonth(); // 0=Jan
  const day = new Date().getDate();

  // Pothole season — March/April after first thaw
  if (month === 2 || month === 3) {
    return {
      title: "Salt-truck season is over. The roads are scarred.",
      consequence: "What it does to your car: bent control arms, knocked-out alignment, slow tire-tread cupping you'll feel on I-90.",
      service: "Free alignment check while you wait — 20 minutes.",
      imageHint: "actual Cleveland pothole on a recognizable East Side street",
    };
  }
  // Summer AC season
  if (month >= 5 && month <= 7) {
    return {
      title: "First 90° day means AC season started.",
      consequence: "What we see on the bay: refrigerant leaks from winter-cracked O-rings, blower motor failure, moldy cabin filters that 3 hot days will reveal.",
      service: "Free AC check — pressure test, leak check, vent temperature reading. Walk in.",
      imageHint: "AC service technician with refrigerant gauges hooked up",
    };
  }
  // Late summer / road trip
  if (month === 7 || month === 8) {
    return {
      title: "Labor Day road-trip prep.",
      consequence: "Cleveland to Pittsburgh is 130 miles. Cleveland to Detroit is 170. Cleveland to NYC is 460. Each one is a long ride to find out your tires are bald or your battery is dying.",
      service: "Free pre-trip check: tires, brakes, battery, fluids, lights. 20 minutes. Walk in.",
      imageHint: "a Cleveland-plated car heading down I-90 with the lake on the right",
    };
  }
  // Fall winter prep
  if (month === 9 || month === 10) {
    return {
      title: "First frost is 4-6 weeks out. Cars don't care, but they should.",
      consequence: "Battery failure rate triples below 32°F. Wiper blades crack in cold. Antifreeze freezes if it's old. Tire pressure drops 1 PSI per 10° drop.",
      service: "Free 27-point winter inspection: battery test, tire pressure, antifreeze concentration check. While you wait.",
      imageHint: "battery tester hooked up showing voltage reading",
    };
  }
  // Deep winter
  if (month >= 11 || month === 0 || month === 1) {
    return {
      title: "Cleveland salt is doing its work right now.",
      consequence: "Brake lines corrode. Frame rust accelerates. Tire pressure tanks. The salt brine that keeps roads safe is also what kills brake hardware.",
      service: "Free underbody check: brake lines, exhaust, frame. We'll show you what's rotting before it strands you.",
      imageHint: "underbody photo showing salt-pitted brake lines",
    };
  }
  // Default mid-season
  return {
    title: "Routine maintenance is cheaper than emergencies.",
    consequence: `The $${SERVICE_PRICE.beltReplacementStarting} belt prevents a $500 tow. The $${OIL_PRICE.conventional} oil change prevents a $4,000 engine. Cleveland weather doesn't care about your schedule.`,
    service: "Free 27-point check on any visit. No appointment needed.",
    imageHint: "the workshop bay floor with multi-bay activity",
  };
}

function buildSeasonalPost(): GeneratedGBPPost {
  const ctx = pickSeasonalContext();
  const text = `${ctx.title}

${ctx.consequence}

${ctx.service}

Open 7 days · ${BUSINESS.address.full} · ${BUSINESS.phone.display}`;
  return {
    archetype: "seasonal",
    text,
    callToAction: "CALL",
    ctaUrl: BUSINESS.phone.href,
    imageHint: ctx.imageHint,
    topicHash: `seasonal-${ctx.title.slice(0, 25)}`,
    provenance: "generic-educational",
  };
}

// ─────────────────────────────────────────────────────────
// ARCHETYPE PICKER (with variety guard)
// ─────────────────────────────────────────────────────────

const PLAYBOOK_RATIO: Array<{ archetype: GBPArchetype; weight: number }> = [
  { archetype: "proof", weight: 50 },     // playbook says ~50%
  { archetype: "seasonal", weight: 20 },  // ~20%
  { archetype: "anti", weight: 15 },      // ~15%
  { archetype: "math", weight: 15 },      // ~15%
];

function pickArchetype(): GBPArchetype {
  const total = PLAYBOOK_RATIO.reduce((s, x) => s + x.weight, 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const opt of PLAYBOOK_RATIO) {
    acc += opt.weight;
    if (r < acc) return opt.archetype;
  }
  return "proof";
}

/**
 * Generate a single voice-grade GBP post. Pulls real data, picks archetype
 * by playbook ratio, and respects the variety guard (won't return the same
 * topic hash within RECENT_LIMIT calls).
 */
export async function generateGBPPost(forceArchetype?: GBPArchetype): Promise<GeneratedGBPPost> {
  // Pull recent topics from DB once per generation cycle (cached 5 min).
  await hydrateRecentTopicsFromDb();

  // Fetch last 5 post bodies to check similarity
  let last5PostBodies: string[] = [];
  try {
    const d = await db();
    if (d) {
      const rows = await d
        .select({ postBody: gbpPostLog.postBody })
        .from(gbpPostLog)
        .orderBy(desc(gbpPostLog.postedAt))
        .limit(5);
      last5PostBodies = rows.map((r: { postBody: string }) => r.postBody);
    }
  } catch (err) {
    log.warn("Failed to fetch last 5 posts for Jaccard check", { err });
  }

  // If a special is active, prefer to feature it (highest signal/conversion),
  // but only if it's not too similar to recent postings.
  const featuredSpecial = await getFeaturedActiveSpecial();
  if (featuredSpecial && !forceArchetype) {
    const text = `${featuredSpecial.title}

${featuredSpecial.description ?? ""}

Walk in 7 days · ${BUSINESS.address.full}
${BUSINESS.phone.display} · code ${featuredSpecial.couponCode ?? "—"}`;

    let tooSimilar = false;
    for (const oldBody of last5PostBodies) {
      if (jaccardSimilarity(text, oldBody) > 0.75) {
        tooSimilar = true;
        break;
      }
    }

    if (!tooSimilar) {
      const post: GeneratedGBPPost = {
        archetype: "math",
        text: text.slice(0, 1500),
        callToAction: "BOOK",
        ctaUrl: `${BUSINESS.urls.website}/specials?utm_source=gbp&utm_medium=organic&utm_campaign=special-${featuredSpecial.couponCode ?? "active"}&utm_content=archetype-special`,
        imageHint: "the actual special — service-specific photo",
        topicHash: `special-${featuredSpecial.id}`,
        provenance: "real-offer",
      };
      validateNoUnsourcedCustomerIdentity(post.text, post.archetype);
      assertNoFabrication(post.text);
      return post;
    } else {
      log.info(`Active special "${featuredSpecial.title}" is too similar to recent posts (Jaccard > 0.75), falling back to other archetypes.`);
    }
  }

  // Pick archetype, retry up to 4× if the topic was recent or similarity is too high.
  let currentForceArchetype = forceArchetype;
  for (let attempt = 0; attempt < 4; attempt++) {
    const archetype = currentForceArchetype ?? pickArchetype();
    try {
      const post = await buildPost(archetype);
      if (isRecentTopic(post.topicHash)) continue;

      // Check Jaccard similarity against last 5 posts
      let tooSimilar = false;
      for (const oldBody of last5PostBodies) {
        if (jaccardSimilarity(post.text, oldBody) > 0.75) {
          tooSimilar = true;
          break;
        }
      }
      if (tooSimilar) {
        log.info(`Post too similar to recent post (Jaccard > 0.75), retrying archetype ${archetype}`);
        continue;
      }

      validateNoUnsourcedCustomerIdentity(post.text, post.archetype);
      recordTopic(post.topicHash);
      assertNoFabrication(post.text);
      return post;
    } catch (err) {
      log.warn(`Failed to build post for archetype ${archetype}, retrying...`, { err: err instanceof Error ? err.message : String(err) });
      // If forced archetype failed (e.g. proof fails because Places API is down/empty),
      // clear it so we can try fallback archetypes on subsequent attempts.
      currentForceArchetype = undefined;
    }
  }

  // Variety guard exhausted — return whatever we got. Better one repeat
  // than infinite loop. If the chosen/forced archetype fails here, fall back
  // to a guaranteed-safe archetype (like anti or seasonal).
  try {
    const fallback = await buildPost(currentForceArchetype ?? "proof");
    validateNoUnsourcedCustomerIdentity(fallback.text, fallback.archetype);
    recordTopic(fallback.topicHash);
    assertNoFabrication(fallback.text);
    return fallback;
  } catch (err) {
    log.warn(`Ultimate fallback failed, trying guaranteed safe anti-post`, { err: err instanceof Error ? err.message : String(err) });
    const fallback = await buildPost("anti");
    validateNoUnsourcedCustomerIdentity(fallback.text, fallback.archetype);
    recordTopic(fallback.topicHash);
    assertNoFabrication(fallback.text);
    return fallback;
  }
}

async function buildPost(archetype: GBPArchetype): Promise<GeneratedGBPPost> {
  switch (archetype) {
    case "proof":    return await buildProofPost();
    case "anti":     return buildAntiPost();
    case "math":     return buildMathPost();
    case "seasonal": return buildSeasonalPost();
  }
}

/**
 * Generate a full week of posts (3 — Mon/Wed/Fri cadence per playbook),
 * respecting the playbook ratio and variety guard.
 */
export async function generateWeeklyPostBatch(): Promise<GeneratedGBPPost[]> {
  const out: GeneratedGBPPost[] = [];
  // First post: always a proof if we have one (highest engagement)
  out.push(await generateGBPPost("proof"));
  // Second post: respect ratio, no force
  out.push(await generateGBPPost());
  // Third post: prefer seasonal or anti for contrast
  const third = Math.random() < 0.5 ? "seasonal" : "anti";
  out.push(await generateGBPPost(third));
  return out;
}

// ─────────────────────────────────────────────────────────
// REAL-DATA FETCHERS
// ─────────────────────────────────────────────────────────

async function getFeaturedActiveSpecial(): Promise<typeof specials.$inferSelect | null> {
  try {
    const d = await db();
    if (!d) return null;
    const now = new Date();
    const rows = await d
      .select()
      .from(specials)
      .where(
        and(
          eq(specials.isActive, true),
          eq(specials.displayOnWebsite, true),
          sql`(${specials.expiresAt} IS NULL OR ${specials.expiresAt} > ${now})`,
          gte(specials.startsAt, sql`DATE_SUB(NOW(), INTERVAL 90 DAY)`),
        ),
      )
      .orderBy(sql`${specials.startsAt} DESC`)
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    log.warn("getFeaturedActiveSpecial failed:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}

log.info("GBP content generator loaded");
