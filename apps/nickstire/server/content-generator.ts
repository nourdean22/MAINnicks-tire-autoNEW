/**
 * AI Content Generation Engine for Nick's Tire & Auto
 *
 * Generates SEO-optimized blog articles, notification messages, and tips
 * following the brand's content structure:
 * Problem Hook → Simple Explanation → Diagnostic Authority → Solution → Local Trust → CTA
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { dynamicArticles, notificationMessages, contentGenerationLog, type DynamicArticle } from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

import { createLogger } from "./lib/logger";
import { getReviewCopy, type ReviewCopy } from "./lib/reviewCopy";
import { ALL_ROUTES } from "@shared/routes";
import { isRedirectedPath } from "./_core/redirects";
import { compileBrandTruth, renderBrandTruthBlock } from "./services/brandTruth";

const log = createLogger("content-generator");
// ─── SEASONAL CONTEXT ──────────────────────────────────

export type Season = "spring" | "summer" | "fall" | "winter";

export function getCurrentSeason(): Season {
  const month = new Date().getMonth(); // 0-11
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

const SEASONAL_TOPICS: Record<Season, string[]> = {
  winter: [
    "Winter tire safety and when to switch to snow tires",
    "Battery failure in cold weather and how to prevent it",
    "Antifreeze and coolant system checks before winter",
    "How salt and road brine damage your vehicle undercarriage",
    "Windshield wiper replacement for winter visibility",
    "Heating system problems and cabin air filter replacement",
    "Why your check engine light comes on more in winter",
    "Ice damage to tires and wheel alignment problems",
  ],
  spring: [
    "Post-winter vehicle inspection checklist",
    "Pothole damage to tires, wheels, and suspension",
    "Spring brake inspection after winter driving",
    "AC system check before summer heat arrives",
    "Wheel alignment after winter pothole season",
    "Switching from winter tires to all-season tires",
    "Spring cleaning your engine bay and undercarriage",
    "Cabin air filter replacement for allergy season",
  ],
  summer: [
    "Preventing overheating in summer traffic",
    "AC not blowing cold — common causes and fixes",
    "Tire blowout prevention in hot weather",
    "Road trip preparation checklist for Cleveland drivers",
    "Brake fade in hot weather and how to prevent it",
    "Coolant system maintenance for summer driving",
    "How heat affects your car battery life",
    "Summer fuel efficiency tips for Cleveland commuters",
  ],
  fall: [
    "Preparing your vehicle for Ohio winter driving",
    "Fall brake inspection before winter conditions",
    "Tire tread depth check before snow season",
    "Ohio E-Check preparation and common failures",
    "Headlight restoration for shorter fall days",
    "Wiper blade replacement before winter storms",
    "Fall oil change — switching to winter-weight oil",
    "Exhaust system inspection before cold weather",
  ],
};

// ─── ARTICLE HERO IMAGES (by category) ─────────────────

const HERO_IMAGES: Record<string, string> = {
  tires: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-tires-AWxeiFZmv6FQocUMfiJvWb.webp",
  brakes: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-brakes-nKAKuxmW2WAmNrbCFRD9zL.webp",
  diagnostics: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-diagnostics-AN7H3iz5Tow2ab2METgner.webp",
  general: "https://d2xsxph8kpxj0f.cloudfront.net/310519663423717611/FqYRztyCVa3fHbrFjU6jAV/hero-main-DE7GKwfCThaBL66r78QWkU.webp",
};

function getHeroImage(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes("tire")) return HERO_IMAGES.tires;
  if (lower.includes("brake")) return HERO_IMAGES.brakes;
  if (lower.includes("diagnostic") || lower.includes("engine") || lower.includes("emission")) return HERO_IMAGES.diagnostics;
  return HERO_IMAGES.general;
}

// ─── SYSTEM PROMPT ─────────────────────────────────────
//
// 2026-05-06 · Upgraded with the "Useful Absurdity" framework from
// the idea-darwin + sam-altman skill synthesis. Same framework is
// documented in shared/blog.ts header for human-authored content.
//
// Net change: generated blog posts now sound like a real Cleveland
// mechanic talking to a peer, not a templated SaaS tone document.

// A FUNCTION, not a const: the review line below is resolved live per
// generation (getReviewCopy — admin override > Google > static floor). A
// module-level template literal is evaluated at import time and could only
// ever carry a hardcoded count, which is how "1,700+" outlived the real number.
const buildSystemPrompt = ({ rating, countDisplay }: ReviewCopy) => `You are a senior mechanic at Nick's Tire & Auto in Cleveland (17625 Euclid Ave). You write like you talk: working-class, specific, slightly absurd, and never marketing-flavored.

═══ THE 5 EVOLUTION OPERATORS ═══
Every article you write must apply at least 2 of these 5. Lead with the one that best fits the topic's actual differentiator.

1. SPECIFICITY INFLATION
   Replace generic claims with absurdly specific numbers, parts, or measurements.
   Bad: "We do a thorough brake inspection"
   Good: "We measure rotor thickness with a digital micrometer to .001 inch"

2. CONCESSION-FIRST PERSUASION
   Lead with the limitation, then the strength. Lower defenses, higher trust.
   Bad: "We're the best brake shop in Cleveland"
   Good: "We're not the cheapest brake shop. We're the one that returns your call."

3. USEFUL ABSURD COMPARISON
   Map a boring service to a vivid sensory anchor.
   Bad: "Same-day brake repair"
   Good: "Brake job done before your delivery driver finds parking"
   Bad: "Walk-ins 7 days a week"
   Good: "Open every day we're awake. Yes, even Sunday."

4. ANTI-PATTERN NAMING
   Specifically call out the chains' / dealers' bait. Don't lecture — name and move on.
   Bad: "Honest pricing"
   Good: "The chain advertises a tire price. They don't advertise the $266 they tack on at the register for mount, balance, valve stems, TPMS reset, alignment check, and disposal."

5. INSIDER VOCABULARY
   Use mechanic-shop slang that signals you're a peer not a marketer.
   "Code pull" not "diagnostic scan". "Walk-around" not "multi-point inspection". "Voltage drop test" not "electrical diagnosis."

═══ HARD RULES ═══
- No marketing clichés. Banned: "trusted", "premier", "top-rated", "world-class", "passionate", "best-in-class", "your one-stop shop"
- No emojis (we're a working-class shop, not a Slack channel)
- No exclamation points except where a real mechanic would actually shout
- No "we pride ourselves" or "we strive" language
- Use real numbers when you have them: "287 ft of added stopping distance" not "longer stopping distance"
- Concede before persuading: "We're not the cheapest" before "We're the most honest"
- Plain language over jargon, EXCEPT use insider vocab where it signals authentic peer talk
- Cleveland-specific anchors: pothole season, lake-effect, Browns Sunday, Euclid Ave, Edgewater, Slavic Village, Tower City
- meta titles ≤ 60 chars, meta descriptions ≤ 170 chars (HARD LIMIT — auto-tested)

═══ CONTENT STRUCTURE ═══
Every article follows:
1. PROBLEM HOOK — A real driver problem in the first sentence ("Squeal on left turn?")
2. PLAIN-ENGLISH EXPLANATION — Translate the symptom to the actual mechanical cause
3. DIAGNOSTIC AUTHORITY — How a real mechanic figures out which root cause it is (this is where insider vocab earns its keep)
4. SOLUTION — What the repair actually involves and what the driver decides. Numbers ONLY when they come from the business facts below or a named public source (NHTSA, a manufacturer spec); if you do not have a verified figure, say what the figure depends on ("rotor thickness vs the stamped minimum") — never invent a cost range, time, or mileage
5. LOCAL TRUST — A Cleveland-specific reference (street, weather, neighborhood, season)
6. CALL TO ACTION — "Pull up to Nick's on Euclid Ave" or "Call (216) 862-0005" — never "Contact us today"

═══ BUSINESS FACTS (compiled from the SSOT — the only facts you may state) ═══
${renderBrandTruthBlock(compileBrandTruth(), "article")}
- Live review line for this article: ${rating}★ from ${countDisplay} Google reviews
- Services: Tires (new + used), Brakes, Diagnostics, Emissions/E-Check, Oil Change, AC, Transmission, Electrical, Battery, Exhaust, Cooling, Pre-purchase Inspection
- Service area: Cleveland, Euclid, Lakewood, Parma, East Cleveland, Cleveland Heights, Shaker Heights, South Euclid, Richmond Heights, Mentor, Strongsville
- Differentiators: written estimate before any wrench moves; we walk you under your car on a lift

═══ LENGTH ═══
There is no word count. Answer the topic completely, accurately and economically — the shortest complete answer that deserves to exist. A section earns its place by answering one question the driver actually has; cut any section that restates another. Google states it has no preferred word count; padding is the failure mode, not brevity.

═══ SEO KEYWORDS (work in naturally — never stuff) ═══
Cleveland auto repair · check engine light repair · Ohio E-Check · emissions repair Cleveland · tire shop Cleveland · OBD-II code pull · brake repair Cleveland · suspension repair Cleveland · alignment Cleveland`;

// ─── RELATED-SERVICE ROUTE RESOLUTION ───────────────────

/** Registry groups an article may link to as a "related service". */
const LINKABLE_GROUPS = new Set(["service", "seo-service", "problem", "seasonal", "comparison"]);

const LINKABLE_ROUTES = new Map<string, string>();
for (const r of ALL_ROUTES) {
  if (!LINKABLE_GROUPS.has(r.group) || r.path === "/") continue;
  LINKABLE_ROUTES.set(r.path, r.path);
  LINKABLE_ROUTES.set(r.path.replace(/^\//, ""), r.path);
}

/** Topic words the model tends to use → the canonical route. Extend here, never in the prompt. */
const TOPIC_ALIASES: Record<string, string> = {
  tire: "/tires", tires: "/tires", "used tires": "/tires", "new tires": "/tires",
  brake: "/brakes", brakes: "/brakes", "brake repair": "/brakes", rotors: "/brakes", pads: "/brakes",
  alignment: "/alignment", "wheel alignment": "/alignment",
  diagnostic: "/diagnostics", diagnostics: "/diagnostics", "check engine": "/diagnostics", "check engine light": "/diagnostics",
  emissions: "/emissions", "e-check": "/emissions", echeck: "/emissions",
  oil: "/oil-change", "oil change": "/oil-change",
};

/**
 * Map whatever the model returned (topic words, slugs, or URLs — including
 * ones that 301 or never existed) onto 2-4 canonical, non-redirected
 * registry routes. Unknowns are dropped, never guessed. Exported for tests.
 */
export function resolveRelatedServiceRoutes(candidates: unknown, max = 4): string[] {
  const out: string[] = [];
  const list = Array.isArray(candidates) ? candidates : [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toLowerCase().replace(/\/+$/, "");
    const direct = LINKABLE_ROUTES.get(key) ?? TOPIC_ALIASES[key] ?? TOPIC_ALIASES[key.replace(/^\//, "").replace(/-/g, " ")];
    if (!direct) continue;
    if (isRedirectedPath(direct)) continue;
    if (!LINKABLE_ROUTES.has(direct)) continue;
    if (!out.includes(direct)) out.push(direct);
    if (out.length >= max) break;
  }
  return out;
}

// ─── GENERATE ARTICLE ──────────────────────────────────

export interface GeneratedArticle {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  category: string;
  readTime: string;
  excerpt: string;
  sections: { heading: string; content: string }[];
  relatedServices: string[];
  tags: string[];
}

export async function generateArticle(topic?: string): Promise<GeneratedArticle> {
  const season = getCurrentSeason();
  const topics = SEASONAL_TOPICS[season];

  // Pick a random seasonal topic if none provided
  const selectedTopic = topic || topics[Math.floor(Math.random() * topics.length)];

  const systemPrompt = buildSystemPrompt(await getReviewCopy());

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt + "\n\nRespond with valid JSON only. No markdown, no code blocks, just raw JSON." },
      {
        role: "user",
        content: `Write a complete blog article about: "${selectedTopic}"

The article should be helpful, educational, and position Nick's Tire & Auto as the trusted expert.

Return your response as a JSON object with these exact fields:
- slug (string): URL-friendly slug, lowercase with hyphens, e.g. winter-tire-safety-guide
- title (string): Article title, clear and descriptive, under 80 chars
- metaTitle (string): SEO meta title ending with | Nick's Tire & Auto Cleveland, under 70 chars
- metaDescription (string): SEO meta description, under 155 chars, includes Cleveland keyword
- category (string): One of: Brake Repair, Diagnostics, Emissions, Tires, Seasonal Tips, Oil Change, General Repair
- readTime (string): Estimated read time, e.g. 4 min read
- excerpt (string): 1-2 sentence summary for the blog listing card, under 200 chars
- sections (array): as many sections as the topic needs (typically 3-7), each with "heading" (string) and "content" (string — exactly as long as it takes to answer that heading; no padding, no filler transitions). The set should answer: what the driver is experiencing · what it could mean · what it does NOT automatically mean · what they can safely check · when inspection is the right call · what diagnosis involves · the common misconception · the Cleveland-specific angle
- relatedServices (array of strings): 2-4 related SERVICE TOPICS as plain words (e.g. "brakes", "alignment", "tires", "diagnostics") — the server maps them to real routes; do not write URLs
- tags (array of strings): 4-8 SEO tags

Respond with valid JSON only. No markdown, no code blocks, just raw JSON.`,
      },
    ],
    // A whole article as JSON, plus whatever the lane spends reasoning first.
    // The 4096 default left no room for both: content-auto-gen came back empty
    // on every observed production run (2026-09-30, 10-03, 10-07).
    maxTokens: 12288,
  });

  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  // Some lanes return text parts rather than one string; the article is the
  // concatenated text either way.
  const rawContent = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((p) => (p && typeof p === "object" && "text" in p && typeof p.text === "string" ? p.text : "")).join("")
      : "";
  if (!rawContent.trim()) {
    // Name the cause in the error itself: cron_log and Telegram only ever see
    // this message, and "empty content" alone left three failures undiagnosable.
    throw new Error(
      `LLM returned no article text (model=${response.model ?? "unknown"}, ` +
      `finish_reason=${choice?.finish_reason ?? "unknown"}, ` +
      `completion_tokens=${response.usage?.completion_tokens ?? "unknown"})`,
    );
  }

  let article: GeneratedArticle;
  try {
    article = JSON.parse(rawContent);
  } catch (e) {
    log.warn("[content-generator] operation failed:", e);
    // Try to extract JSON from the response (LLM may wrap in markdown code blocks)
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) throw new Error("LLM returned invalid JSON for article");
    try {
      article = JSON.parse(jsonMatch);
    } catch (e) {
      throw new Error("LLM returned invalid JSON for article");
    }
  }

  // Validate and sanitize
  if (!article.slug || !article.title || !article.sections?.length) {
    throw new Error("Generated article missing required fields");
  }

  // The model names TOPICS; the route registry decides URLs. Before 2026-10-01
  // the prompt asked the LLM for "service routes like /brake-repair-cleveland"
  // (a 301 since the 2026-07-04 audit) and the raw strings were stored and
  // rendered as links — an LLM is not a source of truth for URL structure.
  article.relatedServices = resolveRelatedServiceRoutes(article.relatedServices);

  // Ensure meta description is under 160 chars
  if (article.metaDescription.length > 160) {
    article.metaDescription = article.metaDescription.substring(0, 157) + "...";
  }

  return article;
}

// ─── GENERATE NOTIFICATION MESSAGE ─────────────────────

export interface GeneratedNotification {
  message: string;
  ctaText: string;
  ctaHref: string;
  icon: string;
  season: Season | "all";
}

export async function generateNotifications(count: number = 3): Promise<GeneratedNotification[]> {
  const season = getCurrentSeason();
  const systemPrompt = buildSystemPrompt(await getReviewCopy());

  const response = await invokeLLM({
    messages: [
      { role: "system", content: systemPrompt + "\n\nRespond with valid JSON only. No markdown, no code blocks, just raw JSON." },
      {
        role: "user",
        content: `Generate ${count} notification bar messages for the website. These appear at the top of the page as a rotating banner.

Current season: ${season}

Each message should:
- Be concise (under 80 characters)
- Address a real driver concern or seasonal issue
- Feel urgent but not pushy
- Include a relevant CTA

Examples of good messages:
- "Check engine light on? Do not wait — small problems become expensive ones fast"
- "Winter tires save lives on Cleveland roads. Drop yours off for the swap today"
- "Failed your Ohio E-Check? We diagnose and fix emissions problems every day"

Return a JSON object with a "notifications" array. Each notification has:
- message (string): under 80 chars
- ctaText (string): e.g. Call Now, Schedule Drop-Off, Learn More
- ctaHref (string): e.g. tel:2168620005, /brakes, /blog/article-slug
- icon (string): one of wrench, alert_triangle, snowflake, thermometer, shield, gauge, phone
- season (string): spring, summer, fall, winter, or all

Respond with valid JSON only. No markdown, no code blocks, just raw JSON.`,
      },
    ],
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("LLM returned empty content for notifications");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawContent);
  } catch (e) {
    log.warn("[content-generator] operation failed:", e);
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) throw new Error("LLM returned invalid JSON for notifications");
    try {
      parsed = JSON.parse(jsonMatch);
    } catch (e) {
      throw new Error("LLM returned invalid JSON for notifications");
    }
  }
  return parsed.notifications;
}

// ─── DATABASE OPERATIONS ───────────────────────────────

export async function saveGeneratedArticle(article: GeneratedArticle): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;

  const today = new Date().toISOString().split("T")[0];

  try {
    const result = await db.insert(dynamicArticles).values({
      slug: article.slug,
      title: article.title,
      metaTitle: article.metaTitle,
      metaDescription: article.metaDescription,
      category: article.category,
      readTime: article.readTime,
      heroImage: getHeroImage(article.category),
      excerpt: article.excerpt,
      sectionsJson: JSON.stringify(article.sections),
      relatedServicesJson: JSON.stringify(article.relatedServices),
      tagsJson: JSON.stringify(article.tags),
      // DRAFT, not published.
      //
      // This wrote "published", overriding the column's own
      // .default("draft") (drizzle/schema.ts) — so every AI-generated article
      // went LIVE on nickstire.org/blog and into the sitemap the moment it was
      // generated, while the admin told the operator it had a draft to review.
      // ContentManager renders a "Drafts" counter, a draft filter and an
      // approve control for exactly this workflow; the writer skipped all three,
      // so the counter could never be anything but zero for AI articles.
      //
      // Neither caller wants immediate publication: generateArticle is an admin
      // mutation that RETURNS the article, and runContentGeneration is a batch
      // generator. Publishing is one click away in the UI and now requires it.
      status: "draft",
      generatedBy: "ai",
      publishDate: today,
    });

    // Log the generation
    await db.insert(contentGenerationLog).values({
      contentType: "article",
      prompt: `Topic: ${article.title}`,
      status: "success",
    });

    return result[0]?.insertId ?? null;
  } catch (error: any) {
    // Log failure
    await db.insert(contentGenerationLog).values({
      contentType: "article",
      status: "failed",
      errorMessage: error.message,
    }).catch((e: unknown) => { log.warn("[content-generator] fire-and-forget failed:", e); });

    throw error;
  }
}

export async function saveGeneratedNotifications(notifications: GeneratedNotification[]): Promise<void> {
  const db = await getDb();
  if (!db) return;

  for (const notif of notifications) {
    try {
      await db.insert(notificationMessages).values({
        message: notif.message,
        ctaText: notif.ctaText,
        ctaHref: notif.ctaHref,
        icon: notif.icon,
        season: notif.season as any,
        // Same defect on the ticker: generated notifications went live on the
        // PUBLIC NotificationBar immediately. ContentManager already renders an
        // ACTIVE/INACTIVE badge and an activate toggle per row — this now starts
        // inactive so that control means something.
        isActive: 0,
        generatedBy: "ai",
        priority: 0,
      });

      await db.insert(contentGenerationLog).values({
        contentType: "notification",
        prompt: notif.message,
        status: "success",
      });
    } catch (error: any) {
      await db.insert(contentGenerationLog).values({
        contentType: "notification",
        status: "failed",
        errorMessage: error.message,
      }).catch((e: unknown) => { log.warn("[content-generator] fire-and-forget failed:", e); });
    }
  }
}

// ─── QUERY HELPERS ─────────────────────────────────────

export async function getPublishedArticles() {
  const db = await getDb();
  if (!db) return [];
  const rows: DynamicArticle[] = await db.select().from(dynamicArticles)
    .where(eq(dynamicArticles.status, "published"))
    .orderBy(desc(dynamicArticles.createdAt))
    .limit(200);
  // A slug server/_core/redirects.ts 301s is withdrawn, not just moved. The
  // 301 fires only on a full page load, so while this returned it, /blog and
  // /site-map linked it and the SPA rendered it in-app, and the prerenderer
  // kept it (2026-10-01: a DB article with payment-program claims the
  // providers contradict).
  return rows.filter((a) => !isRedirectedPath(`/blog/${a.slug}`));
}

export async function getAllDynamicArticles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dynamicArticles)
    .orderBy(desc(dynamicArticles.createdAt))
    .limit(500);
}

/**
 * PUBLISHED only — this feeds a PUBLIC route.
 *
 * The status filter was missing, so this returned a row for any slug regardless
 * of status while its sibling `getPublishedArticles` (the listing) filtered to
 * published. That asymmetry was harmless only because the AI generator wrote
 * every article as "published" on creation. Gating the generator to "draft"
 * turned it into a real hole: an unreviewed AI article stayed unlisted and out of
 * the sitemap, yet was fully readable at its guessable slug URL — so the review
 * step it now waits for could be bypassed by knowing the title. A `rejected`
 * article was equally readable.
 *
 * Caught by self-audit, which correctly refuted the claim that drafts are "not on
 * the public blog until approved". Only consumer is client BlogPost.tsx (the
 * public page), which already renders null for a missing row, so a draft now
 * behaves exactly like a nonexistent one.
 */
export async function getDynamicArticleBySlug(slug: string) {
  // Withdrawn by a redirect (see getPublishedArticles): read as absent.
  if (isRedirectedPath(`/blog/${slug}`)) return null;
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(dynamicArticles)
    .where(and(eq(dynamicArticles.slug, slug), eq(dynamicArticles.status, "published")))
    .limit(1);
  return results[0] ?? null;
}

export async function updateArticleStatus(id: number, status: "draft" | "published" | "rejected") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(dynamicArticles).set({ status }).where(eq(dynamicArticles.id, id));
  return { success: true };
}

export async function updateArticleContent(id: number, updates: {
  title?: string;
  excerpt?: string;
  metaDescription?: string;
  sectionsJson?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(dynamicArticles).set(updates).where(eq(dynamicArticles.id, id));
  return { success: true };
}

export async function getActiveNotifications() {
  const db = await getDb();
  if (!db) return [];

  const season = getCurrentSeason();
  const now = new Date();

  const results = await db.select().from(notificationMessages)
    .where(
      and(
        eq(notificationMessages.isActive, 1),
        sql`(${notificationMessages.season} = 'all' OR ${notificationMessages.season} = ${season})`,
        sql`(${notificationMessages.startsAt} IS NULL OR ${notificationMessages.startsAt} <= ${now})`,
        sql`(${notificationMessages.expiresAt} IS NULL OR ${notificationMessages.expiresAt} > ${now})`,
      )
    )
    .orderBy(desc(notificationMessages.priority), desc(notificationMessages.createdAt));

  return results;
}

export async function getAllNotifications() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notificationMessages)
    .orderBy(desc(notificationMessages.createdAt))
    .limit(500);
}

export async function updateNotificationStatus(id: number, isActive: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notificationMessages).set({ isActive }).where(eq(notificationMessages.id, id));
  return { success: true };
}

export async function deleteNotification(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(notificationMessages).where(eq(notificationMessages.id, id));
  return { success: true };
}

export async function getGenerationLog(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contentGenerationLog)
    .orderBy(desc(contentGenerationLog.createdAt))
    .limit(limit);
}

// ─── FULL GENERATION RUN ───────────────────────────────

export async function runContentGeneration(): Promise<{
  article: GeneratedArticle | null;
  notifications: GeneratedNotification[];
  errors: string[];
}> {
  const errors: string[] = [];
  let article: GeneratedArticle | null = null;
  let notifications: GeneratedNotification[] = [];

  // Generate 1 article
  try {
    article = await generateArticle();
    await saveGeneratedArticle(article);
  } catch (err: unknown) {
    errors.push(`Article generation failed: ${(err as Error).message}`);
  }

  // Generate 3 notification messages
  try {
    notifications = await generateNotifications(3);
    await saveGeneratedNotifications(notifications);
  } catch (err: unknown) {
    errors.push(`Notification generation failed: ${(err as Error).message}`);
  }

  return { article, notifications, errors };
}
