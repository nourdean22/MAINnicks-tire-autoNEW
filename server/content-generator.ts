/**
 * AI Content Generation Engine for Nick's Tire & Auto
 *
 * Generates SEO-optimized blog articles, notification messages, and tips
 * following the brand's content structure:
 * Problem Hook → Simple Explanation → Diagnostic Authority → Solution → Local Trust → CTA
 */

import { invokeLLM } from "./_core/llm";
import { getDb } from "./db";
import { dynamicArticles, notificationMessages, contentGenerationLog } from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

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

const SYSTEM_PROMPT = `You are a content writer for Nick's Tire & Auto, a high-volume independent auto repair and tire shop in Cleveland, Ohio (17625 Euclid Ave, Cleveland, OH 44112).

VOICE RULES:
- Direct, calm, confident, professional, knowledgeable
- Speak like a knowledgeable mechanic explaining a repair to a customer
- Never use hype marketing language, exaggerated claims, gimmicks, slang, or emojis
- Use plain language, not overly technical jargon

CONTENT STRUCTURE (every piece must follow this):
1. PROBLEM HOOK — Open with a real driver problem
2. SIMPLE EXPLANATION — Explain the issue in plain language
3. DIAGNOSTIC AUTHORITY — Position the shop as experts
4. SOLUTION — Explain how the shop repairs the problem
5. LOCAL TRUST — Reinforce Cleveland/Euclid/Northeast Ohio connection
6. CALL TO ACTION — Invite the customer to visit or call (216) 862-0005

SEO KEYWORDS to naturally include:
Cleveland auto repair, check engine light repair, Ohio E-Check repair, emissions repair Cleveland, tire shop Cleveland, OBD-II diagnostics, brake repair Cleveland, suspension repair Cleveland

BUSINESS DETAILS:
- Hours: Mon-Sat 8AM-6PM, Sunday 9AM-4PM
- Phone: (216) 862-0005
- Address: 17625 Euclid Ave, Cleveland, OH 44112
- Services: Tires, Brakes, Diagnostics, Emissions/E-Check, Oil Change, General Repair
- Areas served: Cleveland, Euclid, East Cleveland, South Euclid, Richmond Heights, Northeast Ohio`;

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

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\n\nRespond with valid JSON only. No markdown, no code blocks, just raw JSON." },
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
- sections (array): 4-6 sections, each with "heading" (string) and "content" (string, 80-200 words)
- relatedServices (array of strings): 2-4 related service routes like /tires, /brakes, /brake-repair-cleveland, etc.
- tags (array of strings): 4-8 SEO tags

Respond with valid JSON only. No markdown, no code blocks, just raw JSON.`,
      },
    ],
  });

  const rawContent = response.choices[0]?.message?.content;
  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("LLM returned empty or non-string content");
  }

  let article: GeneratedArticle;
  try {
    article = JSON.parse(rawContent);
  } catch {
    // Try to extract JSON from the response (LLM may wrap in markdown code blocks)
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) throw new Error("LLM returned invalid JSON for article");
    try {
      article = JSON.parse(jsonMatch);
    } catch {
      throw new Error("LLM returned invalid JSON for article");
    }
  }

  // Validate and sanitize
  if (!article.slug || !article.title || !article.sections?.length) {
    throw new Error("Generated article missing required fields");
  }

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

  const response = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT + "\n\nRespond with valid JSON only. No markdown, no code blocks, just raw JSON." },
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
- "Winter tires save lives on Cleveland roads. Book your tire swap today"
- "Failed your Ohio E-Check? We diagnose and fix emissions problems every day"

Return a JSON object with a "notifications" array. Each notification has:
- message (string): under 80 chars
- ctaText (string): e.g. Call Now, Book Online, Learn More
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
  } catch {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) throw new Error("LLM returned invalid JSON for notifications");
    try {
      parsed = JSON.parse(jsonMatch);
    } catch {
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
      status: "published",
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
    }).catch(() => {});

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
        isActive: 1,
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
      }).catch(() => {});
    }
  }
}

// ─── QUERY HELPERS ─────────────────────────────────────

export async function getPublishedArticles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dynamicArticles)
    .where(eq(dynamicArticles.status, "published"))
    .orderBy(desc(dynamicArticles.createdAt))
    .limit(200);
}

export async function getAllDynamicArticles() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dynamicArticles)
    .orderBy(desc(dynamicArticles.createdAt))
    .limit(500);
}

export async function getDynamicArticleBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const results = await db.select().from(dynamicArticles)
    .where(eq(dynamicArticles.slug, slug))
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
  } catch (err: any) {
    errors.push(`Article generation failed: ${err.message}`);
  }

  // Generate 3 notification messages
  try {
    notifications = await generateNotifications(3);
    await saveGeneratedNotifications(notifications);
  } catch (err: any) {
    errors.push(`Notification generation failed: ${err.message}`);
  }

  return { article, notifications, errors };
}
