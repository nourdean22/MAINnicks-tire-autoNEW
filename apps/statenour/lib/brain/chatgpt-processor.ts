/**
 * ChatGPT Conversation Processor
 *
 * Reads Nour's 463 ChatGPT conversation exports, categorizes them,
 * extracts decisions, patterns, preferences, and lessons, then
 * stores them as brain memories for Nick to reference.
 *
 * This is a one-time bulk import + ongoing reference system.
 *
 * Data sources:
 * - conversation-index.json (463 entries with id, title, timestamps)
 * - transcripts/ directory (463 .md files with full conversation text)
 *
 * Categories:
 * - business: shop operations, marketing, customers, revenue
 * - personal_development: mindset, habits, self-improvement, philosophy
 * - health: workouts, supplements, ADHD, sleep, body
 * - strategy: planning, investing, competitive, growth
 * - marketing: social media, content, branding, SEO
 * - food: nutrition, recipes, calories
 * - tech: coding, tools, software, hardware
 * - relationships: social skills, marriage, family
 * - random: quick lookups, trivia, one-off questions
 *
 * Extraction targets:
 * - DECISIONS: choices Nour made with reasoning
 * - PREFERENCES: things Nour likes/dislikes (coding style, food, brand voice)
 * - PATTERNS: recurring themes across conversations
 * - RESEARCH: topics Nour investigated deeply (shows interest areas)
 * - LESSONS: explicit learning moments
 */

import { brainMemory } from "@/lib/brain/memory-manager";
import { prisma } from "@/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ── Category classification keywords ──

const CATEGORY_RULES: { category: string; keywords: string[]; priority: number }[] = [
  {
    category: BRAIN_CATEGORIES.BUSINESS,
    keywords: [
      "tire", "shop", "nick", "nicks", "auto", "mechanic", "invoice", "estimate",
      "customer", "review", "booking", "appointment", "work order", "bay", "tech",
      "oil change", "brake", "alignment", "diagnostic", "emission", "warranty",
      "fleet", "dispatch", "callback", "follow-up", "drop-off", "pit stop",
      "staffing", "euclid", "revenue", "sales", "pricing", "upsell", "financing",
      "payment", "cash flow",
    ],
    priority: 10,
  },
  {
    category: BRAIN_CATEGORIES.MARKETING,
    keywords: [
      "instagram", "post", "caption", "content", "social media", "marketing",
      "seo", "google ads", "ads", "campaign", "brand", "rebrand", "logo",
      "design", "flyer", "promo", "special", "coupon", "referral", "review request",
    ],
    priority: 9,
  },
  {
    category: BRAIN_CATEGORIES.STRATEGY,
    keywords: [
      "strategy", "plan", "goal", "mission", "roadmap", "vision", "growth",
      "expand", "second location", "competitor", "market", "invest", "investing",
      "stock", "trading", "passive income", "turo", "rental", "empire",
      "48 laws", "greene", "seduction", "power", "mastery", "domination",
    ],
    priority: 8,
  },
  {
    category: BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT,
    keywords: [
      "mindset", "discipline", "focus", "overthinking", "motivation", "habit",
      "routine", "morning", "stoic", "philosophy", "self-improvement", "confidence",
      "charisma", "autopilot", "shallow", "deep work", "book", "read",
      "skill", "master", "mental", "breaking", "drift", "ego", "humble",
      "opinion", "judgment", "let go",
    ],
    priority: 7,
  },
  {
    category: BRAIN_CATEGORIES.HEALTH,
    keywords: [
      "workout", "gym", "boxing", "weight", "diet", "calorie", "supplement",
      "protein", "creatine", "adderall", "adhd", "sleep", "energy", "fitness",
      "jiu jitsu", "bjj", "stretch", "recovery", "caffeine", "melatonin",
      "breathing", "ag1", "multivitamin", "skincare", "dark circles",
      "hydroquinone", "eye cream",
    ],
    priority: 6,
  },
  {
    category: BRAIN_CATEGORIES.TECH,
    keywords: [
      "code", "coding", "api", "database", "deploy", "server", "react",
      "typescript", "javascript", "python", "ai", "model", "chatgpt",
      "ollama", "vercel", "railway", "github", "docker", "linux",
      "vpn", "tailscale", "apk", "app", "software", "hardware",
    ],
    priority: 5,
  },
  {
    category: BRAIN_CATEGORIES.RELATIONSHIPS,
    keywords: [
      "wife", "dania", "marriage", "family", "mother", "friend",
      "social", "approaching", "dating", "relationship", "trust",
      "communication", "love", "respect",
    ],
    priority: 4,
  },
  {
    category: BRAIN_CATEGORIES.FOOD,
    keywords: [
      "calorie", "recipe", "cook", "meal", "restaurant", "food",
      "chili", "steak", "chicken", "pork", "halal", "ingredient",
      "nutrition", "eating", "diet", "fast", "fasting", "watermelon",
    ],
    priority: 3,
  },
  {
    category: BRAIN_CATEGORIES.RANDOM,
    keywords: [],
    priority: 0,
  },
];

export interface ConversationEntry {
  id: string;
  title: string;
  create_time: string;
  update_time: string;
}

export interface ProcessedConversation {
  id: string;
  title: string;
  category: string;
  subcategories: string[];
  date: string;
  relevanceScore: number; // 0-100: how relevant to Nour's growth
}

export interface ProcessingReport {
  total: number;
  categorized: Record<string, number>;
  highRelevance: number; // conversations with score >= 60
  memoriesCreated: number;
  topThemes: { theme: string; count: number }[];
}

/**
 * Classify a conversation by its title using keyword matching.
 */
export function classifyConversation(title: string): { category: string; subcategories: string[]; relevanceScore: number } {
  const lower = title.toLowerCase();
  const matches: { category: string; hits: number; priority: number }[] = [];

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.length === 0) continue;
    const hits = rule.keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > 0) {
      matches.push({ category: rule.category, hits, priority: rule.priority });
    }
  }

  if (matches.length === 0) {
    return { category: BRAIN_CATEGORIES.RANDOM, subcategories: [], relevanceScore: 10 };
  }

  // Sort by hits * priority (most relevant first)
  matches.sort((a, b) => (b.hits * b.priority) - (a.hits * a.priority));

  const primary = matches[0];
  const subcategories = matches.slice(1, 3).map((m) => m.category);

  // Relevance score based on category priority and keyword density
  const relevanceScore = Math.min(100, primary.priority * 10 + primary.hits * 5);

  return { category: primary.category, subcategories, relevanceScore };
}

/**
 * Read the conversation index file.
 */
export function loadConversationIndex(): ConversationEntry[] {
  const indexPath = path.join(
    process.cwd(),
    "..",
    "..",
    "..",
    "knowledge",
    "ai-exports",
    "ChatGPT",
    "Exports",
    "conversation-index.json"
  );

  // Try multiple paths (local dev vs production)
  const paths = [
    indexPath,
    "C:\\Users\\nourd\\NOUR-OS\\knowledge\\ai-exports\\ChatGPT\\Exports\\conversation-index.json",
    "/app/knowledge/ai-exports/ChatGPT/Exports/conversation-index.json",
  ];

  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      return JSON.parse(raw) as ConversationEntry[];
    } catch {
      continue;
    }
  }

  return [];
}

/**
 * Read a specific conversation transcript.
 */
export function loadTranscript(title: string, id: string): string | null {
  // Transcript files are named: title [id].md
  // But title may have special chars, so we search by id
  const transcriptsDir = "C:\\Users\\nourd\\NOUR-OS\\knowledge\\ai-exports\\ChatGPT\\Exports\\transcripts";

  try {
    const files = fs.readdirSync(transcriptsDir);
    const match = files.find((f) => f.includes(id));
    if (match) {
      return fs.readFileSync(path.join(transcriptsDir, match), "utf-8");
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Extract key insights from a conversation transcript.
 * Uses keyword detection (no AI call) for speed.
 */
export function extractInsights(transcript: string, category: string): {
  decisions: string[];
  preferences: string[];
  lessons: string[];
  themes: string[];
} {
  const lines = transcript.split("\n").filter((l) => l.trim().length > 20);
  const decisions: string[] = [];
  const preferences: string[] = [];
  const lessons: string[] = [];
  const themes: string[] = [];

  // Decision markers
  const decisionWords = ["decided", "going to", "i'll do", "chose", "picking", "going with", "let's go with"];
  // Preference markers
  const prefWords = ["i prefer", "i like", "i want", "i need", "always do", "never do", "i hate", "i love"];
  // Lesson markers
  const lessonWords = ["learned", "realized", "now i know", "the key is", "the trick is", "important to", "mistake was"];

  for (const line of lines) {
    const lower = line.toLowerCase();

    // Only process user messages (lines that look like user input)
    if (lower.startsWith("**user**") || lower.startsWith("user:") || lower.startsWith("> ")) {
      const text = line.replace(/^\*\*user\*\*:?\s*/i, "").replace(/^user:\s*/i, "").replace(/^>\s*/, "").trim();
      if (text.length < 10) continue;

      if (decisionWords.some((w) => lower.includes(w))) {
        decisions.push(text.slice(0, 200));
      }
      if (prefWords.some((w) => lower.includes(w))) {
        preferences.push(text.slice(0, 200));
      }
      if (lessonWords.some((w) => lower.includes(w))) {
        lessons.push(text.slice(0, 200));
      }
    }
  }

  // Theme extraction from category
  if (category === "business") themes.push("shop_operations");
  if (category === "marketing") themes.push("brand_marketing");
  if (category === "strategy") themes.push("strategic_planning");
  if (category === "personal_development") themes.push("personal_growth");
  if (category === "health") themes.push("health_fitness");
  if (category === "relationships") themes.push("relationships");

  return { decisions, preferences, lessons, themes };
}

/**
 * Process all 463 conversations.
 * Categorizes, extracts insights, stores as brain memories.
 *
 * @param batchSize How many to process per run (for cron chunking)
 * @param offset Start position (for resumable processing)
 */
export async function processConversations(
  batchSize: number = 50,
  offset: number = 0
): Promise<ProcessingReport> {
  const index = loadConversationIndex();

  if (index.length === 0) {
    return { total: 0, categorized: {}, highRelevance: 0, memoriesCreated: 0, topThemes: [] };
  }

  // Check what's already processed
  // v10.0.65 · soft-delete bypass fix. Pre-fix a soft-deleted row's
  // key was still in the processed-set, so the conversation would
  // be marked as "already done" and skipped on the next run — even
  // though Nour had pruned it explicitly. Now: only see live rows.
  const processed = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.CHATGPT_CONVERSATION, deletedAt: null },
    select: { key: true },
  }).catch(() => []);
  const processedKeys = new Set(processed.map((p) => p.key));

  // Filter to unprocessed conversations
  const remaining = index.filter((c) => !processedKeys.has(`chatgpt_${c.id}`));
  const batch = remaining.slice(offset, offset + batchSize);

  const categorized: Record<string, number> = {};
  let memoriesCreated = 0;
  let highRelevance = 0;
  const themeCount: Record<string, number> = {};

  for (const conv of batch) {
    const { category, subcategories, relevanceScore } = classifyConversation(conv.title);
    categorized[category] = (categorized[category] ?? 0) + 1;
    if (relevanceScore >= 60) highRelevance++;

    // Store the conversation classification as a memory
    await brainMemory.remember(
      "chatgpt_conversation",
      `chatgpt_${conv.id}`,
      `ChatGPT conversation "${conv.title}" [${category}${subcategories.length > 0 ? `, ${subcategories.join(", ")}` : ""}] — ${new Date(conv.create_time).toISOString().slice(0, 10)}. Relevance: ${relevanceScore}/100.`,
      "chatgpt-processor",
      {
        category,
        subcategories,
        relevanceScore,
        date: conv.create_time,
        title: conv.title,
        chatgptId: conv.id,
      }
    ).catch(() => {});
    memoriesCreated++;

    // For high-relevance conversations, read transcript and extract deeper insights
    if (relevanceScore >= 50 && category !== "random" && category !== "food") {
      const transcript = loadTranscript(conv.title, conv.id);
      if (transcript && transcript.length > 100) {
        const insights = extractInsights(transcript, category);

        // Store decisions
        for (const decision of insights.decisions.slice(0, 2)) {
          await brainMemory.remember(
            "chatgpt_decision",
            `chatgpt_dec_${conv.id}_${memoriesCreated}`,
            `DECISION from ChatGPT [${category}]: ${decision}`,
            "chatgpt-processor",
            { source: conv.title, category }
          ).catch(() => {});
          memoriesCreated++;
        }

        // Store preferences
        for (const pref of insights.preferences.slice(0, 2)) {
          await brainMemory.remember(
            "chatgpt_preference",
            `chatgpt_pref_${conv.id}_${memoriesCreated}`,
            `PREFERENCE from ChatGPT: ${pref}`,
            "chatgpt-processor",
            { source: conv.title, category }
          ).catch(() => {});
          memoriesCreated++;
        }

        // Store lessons
        for (const lesson of insights.lessons.slice(0, 2)) {
          await brainMemory.remember(
            "chatgpt_lesson",
            `chatgpt_lesson_${conv.id}_${memoriesCreated}`,
            `LESSON from ChatGPT [${category}]: ${lesson}`,
            "chatgpt-processor",
            { source: conv.title, category }
          ).catch(() => {});
          memoriesCreated++;
        }

        // Track themes
        for (const theme of insights.themes) {
          themeCount[theme] = (themeCount[theme] ?? 0) + 1;
        }
      }
    }
  }

  // Store a summary of themes as brain memory
  const topThemes = Object.entries(themeCount)
    .map(([theme, count]) => ({ theme, count }))
    .sort((a, b) => b.count - a.count);

  if (topThemes.length > 0) {
    await brainMemory.remember(
      "chatgpt_summary",
      `chatgpt_batch_${Date.now()}`,
      `Processed ${batch.length} ChatGPT conversations. Categories: ${JSON.stringify(categorized)}. Top themes: ${topThemes.slice(0, 5).map((t) => `${t.theme}(${t.count})`).join(", ")}. High-relevance: ${highRelevance}/${batch.length}.`,
      "chatgpt-processor",
      { batchSize: batch.length, offset, totalRemaining: remaining.length - batch.length }
    ).catch(() => {});
  }

  return {
    total: index.length,
    categorized,
    highRelevance,
    memoriesCreated,
    topThemes,
  };
}

/**
 * Get ChatGPT processing context for system prompt.
 * Shows what Nick knows about Nour's ChatGPT history.
 */
export async function getChatGPTContext(): Promise<string> {
  try {
    const [summary, decisions, preferences] = await Promise.all([
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.CHATGPT_SUMMARY, deletedAt: null }, // v10.0.66 · system-prompt feeder
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      }),
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.CHATGPT_DECISION, deletedAt: null }, // v10.0.66 · system-prompt feeder
        orderBy: { confidence: "desc" },
        take: 5,
        select: { content: true },
      }),
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.CHATGPT_PREFERENCE, deletedAt: null }, // v10.0.66 · system-prompt feeder
        orderBy: { confidence: "desc" },
        take: 5,
        select: { content: true },
      }),
    ]);

    if (summary.length === 0 && decisions.length === 0) return "";

    const lines: string[] = [`── CHATGPT CONVERSATION INSIGHTS ──`];

    if (summary.length > 0) {
      lines.push(summary[0].content.slice(0, 300));
    }

    if (decisions.length > 0) {
      lines.push(`Key decisions from past conversations:`);
      for (const d of decisions) lines.push(`• ${d.content.slice(0, 150)}`);
    }

    if (preferences.length > 0) {
      lines.push(`Expressed preferences:`);
      for (const p of preferences) lines.push(`• ${p.content.slice(0, 150)}`);
    }

    return lines.join("\n");
  } catch {
    return "";
  }
}
