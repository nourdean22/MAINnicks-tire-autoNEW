/**
 * saveToBrain · May 02 · v10.0.143
 *
 * User-triggered ingest. Mirrors the importance-scorer's auto-persist
 * but lets Nour explicitly save content via `/save <text>` (or other
 * surfaces). No LLM call — heuristic-only auto-categorization keeps
 * it fast (<50ms). For full AI parsing of brain dumps, the existing
 * `/api/brain/parse` + journal-ingest path stays the heavyweight option.
 *
 * Categories (heuristic order — first match wins):
 *   1. decision        — "I decided", "decision:", "going with X"
 *   2. belief          — "I believe", "I think", "my view is"
 *   3. strategy        — "strategy:", "playbook", "approach"
 *   4. brand_marketing — "brand", "voice", "tone", "style", "blueprint",
 *                        "Instagram", "marketing"
 *   5. pattern         — "pattern", "always X", "every time", "rule:"
 *   6. user_save       — fallback; raw content with timestamp key
 *
 * Returns the saved BrainMemory id + the inferred category + a short
 * summary line for the confirmation message. Caller decides whether to
 * surface that summary in chat / a toast / nowhere.
 */

import { prisma } from "@/lib/prisma";

export type SaveCategory =
  | "decision"
  | "belief"
  | "strategy"
  | "brand_marketing"
  | "pattern"
  | "user_save";

export interface SaveToBrainInput {
  content: string;
  /**
   * Optional override for the auto-categorizer. When the caller already
   * knows the category (e.g. a UI button labeled "Save as belief"),
   * pass it through and skip the heuristic.
   */
  category?: SaveCategory;
  /** Optional human-readable label for the BrainMemory.key field. */
  keyHint?: string;
  /** Confidence value persisted to the row. Default 0.85. */
  confidence?: number;
  /** Optional source label — defaults to "user_save". */
  source?: string;
  /** Optional metadata blob persisted alongside the content. */
  metadata?: Record<string, unknown>;
}

export interface SaveToBrainOutput {
  id: string;
  category: SaveCategory;
  key: string;
  summary: string;
}

/**
 * Pure function — testable without DB. Picks the category for content.
 */
export function categorizeForSave(content: string): SaveCategory {
  const lower = content.toLowerCase();
  if (
    /\b(decided|decision|going with|chose|choosing|i'?ll go|i will go|locked in|committed to)\b/i.test(content) ||
    /^\s*decision\s*[:.]/i.test(content)
  ) {
    return "decision";
  }
  if (
    /\b(i\s+(believe|think|feel|reckon|hold)\b|my\s+(view|take|stance|opinion)\s+is\b|in\s+my\s+experience\b)/i.test(
      content,
    )
  ) {
    return "belief";
  }
  if (
    /\b(strategy|playbook|approach|game\s*plan|tactic|tactics|north\s*star|operating\s+system)\b/i.test(
      content,
    ) ||
    /^\s*strategy\s*[:.]/i.test(content)
  ) {
    return "strategy";
  }
  if (
    /\b(brand|voice|tone|style|blueprint|messaging|positioning|marketing|copy|content\s+strategy|captions?|hashtags?)\b/i.test(
      lower,
    ) ||
    /\b(instagram|tiktok|reels?|short\s*form|creator|engagement)\b/i.test(lower)
  ) {
    return "brand_marketing";
  }
  if (
    /\b(pattern|every\s+time|always\b|rule\s*[:.]|principle\s*[:.]|when\s+x\s+then)\b/i.test(
      content,
    )
  ) {
    return "pattern";
  }
  return "user_save";
}

/**
 * Build a stable, sortable key for the BrainMemory row.
 *   user_save_<category>_<unix-ms>
 */
function buildKey(category: SaveCategory, hint?: string): string {
  const slug = (hint ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const stamp = Date.now();
  return slug ? `${category}_${slug}_${stamp}` : `${category}_${stamp}`;
}

export async function saveToBrain(input: SaveToBrainInput): Promise<SaveToBrainOutput> {
  const trimmed = input.content.trim();
  if (trimmed.length < 3) {
    throw new Error("Content too short to save (min 3 chars).");
  }
  const category: SaveCategory = input.category ?? categorizeForSave(trimmed);
  const key = buildKey(category, input.keyHint);
  const confidence = typeof input.confidence === "number" ? input.confidence : 0.85;
  const source = input.source ?? "user_save";

  const row = await prisma.brainMemory.create({
    data: {
      category,
      key,
      content: trimmed,
      confidence,
      source,
      metadata: (input.metadata ?? null) as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
    },
    select: { id: true },
  });

  // Build a short summary line for the caller to display.
  const previewLength = 120;
  const preview =
    trimmed.length > previewLength ? `${trimmed.slice(0, previewLength)}…` : trimmed;
  const summary = `Saved as ${category} · ${preview}`;

  return {
    id: row.id,
    category,
    key,
    summary,
  };
}
