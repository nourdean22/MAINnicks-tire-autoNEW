/**
 * CONTENT FEEDBACK — capture + recall recent in-session feedback.
 *
 * v6 · Apr 28 · Confidence-layer feature #6. Two halves:
 *
 * 1. CAPTURE — pattern-detect when Nour reacts to content (positive,
 *    negative, "make it different") and persist to brain_memory under
 *    category="content_feedback". Different from feedback_*.md
 *    permanent files — these are recent, in-session, content-specific.
 *
 * 2. RECALL — pull last N feedback entries scoped to content gen and
 *    inject as a "Nour-said-recently" block in the content-mode prompt.
 *
 * The model reads the recent feedback BEFORE generating, so it learns:
 *   · "shorter" → trim 30%
 *   · "too generic" → add specificity (numbers, names)
 *   · "love this hook" → reuse the pattern
 *   · "winter angle felt forced" → avoid that lens for this customer
 *
 * Compounding: each shipped post + feedback pair tightens Nick's voice.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";

// ─────────────────────────────────────────────────────────────────────
// CAPTURE — detect feedback shape in user message
// ─────────────────────────────────────────────────────────────────────

interface FeedbackPattern {
  /** Regex that fires on the feedback shape */
  pattern: RegExp;
  /** Polarity (-1 to 1) */
  polarity: number;
  /** Stable key prefix for dedup */
  category: "love" | "hate" | "fix" | "iterate" | "wrong";
  /** Short description for the brain memory content field */
  label: string;
}

const PATTERNS: FeedbackPattern[] = [
  // ── LOVE — strong positive ──
  { pattern: /\b(love (this|that|it)|nailed (it|that)|ship (it|that))\b/i, polarity: 1.0, category: "love", label: "loved" },
  { pattern: /\b(perfect|exactly|that'?s (great|it|the one))\b/i, polarity: 0.9, category: "love", label: "perfect/exactly" },
  { pattern: /\b(this is (great|fire|gold|🔥)|🔥)\b/i, polarity: 1.0, category: "love", label: "fire" },
  { pattern: /\b(yes\s*[.!]|that works|good (one|call))\b/i, polarity: 0.7, category: "love", label: "yes/good" },

  // ── HATE — strong negative ──
  { pattern: /\b(hate (this|that|it)|terrible|garbage|trash)\b/i, polarity: -1.0, category: "hate", label: "hated" },
  { pattern: /\b(no\s*[,.!]+\s*(this|that|nope))/i, polarity: -0.8, category: "hate", label: "rejected" },
  { pattern: /\b(corporate(\s|-)speak|too\s+corporate|sounds\s+(corporate|like\s+a\s+marketer))\b/i, polarity: -0.8, category: "hate", label: "too corporate" },
  { pattern: /\b(generic|cliche|cliché|boring|cheesy|cringe|flat)\b/i, polarity: -0.7, category: "hate", label: "generic/cliche" },

  // ── FIX — specific change request ──
  { pattern: /\b(too long|shorter|cut (it|the))/i, polarity: -0.3, category: "fix", label: "make shorter" },
  { pattern: /\b(too short|longer|expand)/i, polarity: -0.3, category: "fix", label: "make longer" },
  { pattern: /\b(more specific|add (numbers|details|specifics))/i, polarity: -0.3, category: "fix", label: "more specific" },
  { pattern: /\b(more punchy|punchier|tighter|sharper)/i, polarity: -0.3, category: "fix", label: "more punchy" },
  { pattern: /\b(too aggressive|softer|tone (down|it down))/i, polarity: -0.3, category: "fix", label: "tone down" },
  { pattern: /\b(too soft|stronger|more aggressive|hit harder)/i, polarity: -0.3, category: "fix", label: "hit harder" },
  { pattern: /\b(add (cta|call to action)|stronger cta)/i, polarity: -0.2, category: "fix", label: "stronger CTA" },
  { pattern: /\b(remove (cta|hashtag)|drop (the|those))/i, polarity: -0.2, category: "fix", label: "remove element" },
  { pattern: /\b(change\s+the\s+(angle|hook|tone))/i, polarity: -0.4, category: "fix", label: "change angle" },

  // ── ITERATE — neutral redirect ──
  { pattern: /\b(try again|redo|another (try|version)|do it differently)\b/i, polarity: -0.1, category: "iterate", label: "regen" },
  { pattern: /\b(swap|switch|flip)\s+(the|it)/i, polarity: -0.1, category: "iterate", label: "swap" },

  // ── WRONG — fact-check failure ──
  { pattern: /\b(that'?s wrong|incorrect|not right|made (it|that)\s+up)\b/i, polarity: -0.9, category: "wrong", label: "fact wrong" },
  { pattern: /\b(we don'?t (do|sell|offer)|(we|i|nick'?s)\s+(don'?t|never|aren'?t))/i, polarity: -0.7, category: "wrong", label: "factual contradiction" },
];

export interface DetectedFeedback {
  detected: boolean;
  polarity: number;       // -1 to 1
  category: "love" | "hate" | "fix" | "iterate" | "wrong";
  label: string;
  rawText: string;        // original user message (capped at 500c)
  matches: string[];      // labels of all patterns that fired
}

/**
 * Detect content feedback shape in a user message. Returns the strongest
 * (highest |polarity|) pattern hit. Caller persists if detected=true AND
 * the previous assistant turn was content (≥3 hashtags or has caption marker).
 */
export function detectContentFeedback(message: string): DetectedFeedback | null {
  if (!message) return null;

  const matches: Array<FeedbackPattern> = [];
  for (const p of PATTERNS) {
    if (p.pattern.test(message)) matches.push(p);
  }
  if (matches.length === 0) return null;

  // Pick the strongest by absolute polarity
  const strongest = matches.reduce((a, b) =>
    Math.abs(a.polarity) >= Math.abs(b.polarity) ? a : b,
  );

  return {
    detected: true,
    polarity: strongest.polarity,
    category: strongest.category,
    label: strongest.label,
    rawText: message.slice(0, 500),
    matches: matches.map((m) => m.label),
  };
}

// ─────────────────────────────────────────────────────────────────────
// PERSIST — write to brain_memory category=content_feedback
// ─────────────────────────────────────────────────────────────────────

interface PersistArgs {
  feedback: DetectedFeedback;
  /** Last assistant message — captures what the feedback is ABOUT */
  previousAssistantText?: string;
  /** Conversation id for traceability */
  conversationId?: string;
}

export async function persistContentFeedback(args: PersistArgs): Promise<void> {
  try {
    const { feedback, previousAssistantText, conversationId } = args;
    // Stable key: timestamp + label slug. Avoids collisions, doesn't dedupe.
    const slug = feedback.label.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    const key = `cf:${slug}-${Date.now()}`;
    const captionPreview = previousAssistantText?.slice(0, 300);

    await prisma.brainMemory.create({
      data: {
        category: "content_feedback",
        key,
        source: "chat_user_message",
        content: `[${feedback.category}] ${feedback.label}: "${feedback.rawText.slice(0, 200)}"${captionPreview ? ` · about: "${captionPreview.slice(0, 150)}..."` : ""}`,
        confidence: Math.min(0.95, 0.5 + Math.abs(feedback.polarity) * 0.45),
        metadata: {
          polarity: feedback.polarity,
          category: feedback.category,
          label: feedback.label,
          matches: feedback.matches,
          captionPreview,
          conversationId,
          capturedAt: new Date().toISOString(),
        } as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    logError("ai.content-feedback", err, { fn: "persistContentFeedback" });
  }
}

// ─────────────────────────────────────────────────────────────────────
// RECALL — pull recent feedback for the content-mode prompt
// ─────────────────────────────────────────────────────────────────────

export interface RecallArgs {
  limit?: number;
  daysBack?: number;
}

export interface RecalledFeedback {
  date: string;
  category: string;
  label: string;
  polarity: number;
  rawText: string;
  captionPreview?: string;
}

export async function recallRecentContentFeedback(
  args: RecallArgs = {},
): Promise<RecalledFeedback[]> {
  const limit = args.limit ?? 10;
  const daysBack = args.daysBack ?? 14;
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: "content_feedback",
        createdAt: { gte: since },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { content: true, metadata: true, createdAt: true },
    })
    .catch((err) => {
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.content-feedback", err, { fn: "recallRecentContentFeedback" })).catch((e) => console.error(e));
      return [] as Array<{ content: string; metadata: unknown; createdAt: Date }>;
    });

  return rows.map((r) => {
    const meta = (r.metadata as {
      polarity?: number;
      category?: string;
      label?: string;
      captionPreview?: string;
    } | null) ?? {};
    return {
      date: r.createdAt.toISOString().split("T")[0],
      category: meta.category ?? "unknown",
      label: meta.label ?? "feedback",
      polarity: meta.polarity ?? 0,
      rawText: r.content,
      captionPreview: meta.captionPreview,
    };
  });
}

/**
 * Format recall results as a system-prompt block. Loaded into the
 * content-mode prompt so the model reads "what Nour just said" before
 * generating new content.
 */
export function buildFeedbackPromptBlock(items: RecalledFeedback[]): string {
  if (items.length === 0) return "";
  const lines = items.map((f) => {
    const polarityIcon = f.polarity >= 0.7 ? "✓" : f.polarity >= 0.3 ? "+" : f.polarity <= -0.7 ? "✗" : f.polarity <= -0.3 ? "−" : "·";
    return `  ${polarityIcon} ${f.date} · [${f.category}/${f.label}]${f.captionPreview ? ` (about: "${f.captionPreview.slice(0, 80)}")` : ""}`;
  });
  return `
═══ NOUR-SAID-RECENTLY (in-session content feedback — HONOR THIS) ═══
Last ${items.length} content reactions (newest first):
${lines.join("\n")}

Rules:
  · Repeat patterns Nour ✓'d. Avoid patterns Nour ✗'d.
  · "make shorter" / "too long" → cut 30% next try.
  · "generic" / "cliche" → swap for specific numbers/names/dates.
  · "too corporate" → drop "elevate / leverage / synergy / utilize".
  · "fact wrong" → never repeat that fact pattern; flag uncertainty next time.
  · If Nour ✓'d a hook in the last 14 days, reuse it on similar content (with variation).
`.trim();
}
