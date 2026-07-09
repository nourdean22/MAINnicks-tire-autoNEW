/**
 * Contradiction Surfacer — when Nour says something that conflicts
 * with a thing he said before, catch it and surface it. Apr 19.
 *
 * The bet: Nour's biggest blind spot is saying "this time it's
 * different" without realizing he said the exact opposite three
 * weeks ago. This watches every new chat_importance row (decision
 * / preference / commitment) and checks it against prior rows via
 * semantic similarity + polarity detection. When a conflict lands,
 * we persist a contradiction row and surface it in the bottom
 * ticker so Nour sees it the same day.
 *
 * Detection rule (tight on purpose — false positives kill trust):
 *   1. New row category must be decision | preference | commitment
 *   2. Find top-5 semantic neighbors via brain_memory vector search
 *   3. A neighbor is a conflict if:
 *      a. Similarity >= 0.78 (they're clearly about the same topic)
 *      b. AND one of:
 *         - Negation signal: new contains "not" / "never" / "no longer"
 *           / "changed my mind" while old was affirmative (or vice versa)
 *         - Explicit reversal: "actually", "instead", "scratch that"
 *         - Antonym pair in the high-signal tokens
 *   4. Old row must be >= 7 days old (catch actual drift, not same-
 *      session rehashing)
 *
 * Storage: BrainMemory category="contradiction" key=sha1(newId+oldId).
 * Content is structured so the ticker can render without re-parsing.
 */

import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { semanticSearch } from "./embedding-utils";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

const NEGATION_TOKENS = [
  "not", "no longer", "never", "don't", "doesn't", "won't",
  "stop", "quit", "changed my mind", "scratch that", "actually",
  "instead", "reverse", "take back", "never mind",
];

const REVERSAL_TOKENS = [
  "changed my mind", "on second thought", "actually", "scratch that",
  "never mind", "disregard", "take that back", "i was wrong",
  "i know i said", "even though i said", "despite saying",
];

// Minimal antonym pairs; used only if tokens overlap heavily.
const ANTONYM_PAIRS: Array<[string, string]> = [
  ["buy", "sell"], ["hire", "fire"], ["start", "stop"],
  ["open", "close"], ["launch", "shutdown"], ["add", "remove"],
  ["love", "hate"], ["like", "dislike"], ["prefer", "avoid"],
  ["keep", "drop"], ["stay", "leave"], ["commit", "abandon"],
  ["invest", "cut"], ["expand", "contract"], ["hire", "let go"],
];

export type ContradictionStatus =
  | "unresolved"            // default — ticker keeps rotating it
  | "current_wins"          // Nour confirmed the new one is right; old deprecated
  | "old_wins"              // Nour said the old one still stands; new was wrong
  | "both_valid"            // context-dependent, both true; marked so ticker drops it
  | "dismissed";            // not actually a contradiction (false positive)

export interface Contradiction {
  new_memory_id: string;        // BrainMemory.id of the fresh row
  old_memory_id: string;        // BrainMemory.id of the prior row
  similarity: number;           // 0-1
  signal: "negation" | "reversal" | "antonym" | "compound";
  new_excerpt: string;
  old_excerpt: string;
  days_apart: number;
  surfaced_at: string;          // ISO
  status?: ContradictionStatus; // default "unresolved"
  resolution_note?: string | null;
  resolved_at?: string | null;
}

function buildContradictionKey(newId: string, oldId: string): string {
  return createHash("sha1").update(`${newId}::${oldId}`).digest("hex").slice(0, 16);
}

function containsAny(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

function hasAntonymClash(a: string, b: string): boolean {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  for (const [x, y] of ANTONYM_PAIRS) {
    if ((aLower.includes(x) && bLower.includes(y)) || (aLower.includes(y) && bLower.includes(x))) {
      return true;
    }
  }
  return false;
}

function detectSignal(newText: string, oldText: string): Contradiction["signal"] | null {
  const newHasNeg = containsAny(newText, NEGATION_TOKENS);
  const oldHasNeg = containsAny(oldText, NEGATION_TOKENS);
  const negationFlip = newHasNeg !== oldHasNeg; // xor

  const hasReversal = containsAny(newText, REVERSAL_TOKENS);
  const antonymClash = hasAntonymClash(newText, oldText);

  if (hasReversal && negationFlip) return "compound";
  if (hasReversal) return "reversal";
  if (negationFlip) return "negation";
  if (antonymClash) return "antonym";
  return null;
}

/**
 * Run the contradiction check for a newly-persisted chat_importance
 * OR scored brain_dump text. Called by importance-scorer + brain-
 * dump post-processing. Fire-and-forget from the caller.
 */
export async function surfaceContradictions(newBrainMemoryId: string): Promise<Contradiction[]> {
  const fresh = await prisma.brainMemory.findUnique({
    where: { id: newBrainMemoryId },
    select: { id: true, content: true, category: true, createdAt: true },
  });
  if (!fresh) return [];
  // Accept both chat_importance and brain_dump_importance categories
  const ELIGIBLE_CATEGORIES = new Set(["chat_importance", "brain_dump_importance"]);
  if (!ELIGIBLE_CATEGORIES.has(fresh.category)) return [];

  // Unwrap the stored JSON shape produced by importance-scorer
  let newExcerpt = fresh.content;
  let primaryCategory: string | undefined;
  try {
    const parsed = JSON.parse(fresh.content) as { excerpt?: string; primary?: string };
    if (parsed.excerpt) newExcerpt = parsed.excerpt;
    primaryCategory = parsed.primary;
  } catch {
    // fall through — treat content as raw text
  }

  // Only check if the new row was a decision / preference / commitment
  const eligible = new Set(["decision", "preference", "commitment"]);
  if (primaryCategory && !eligible.has(primaryCategory)) return [];

  // Semantic neighbors — leverage the brain_memory vector index
  const neighbors = await semanticSearch(newExcerpt, 8, ["brain_memory"]).catch(() => []);
  if (neighbors.length === 0) return [];

  // v10.0.38 — batch the neighbor hydration. Pre-fix: a sequential
  // findUnique per neighbor (up to 8 round-trips). Now: filter
  // qualifying neighbors first, then one findMany covers all.
  const candidates = neighbors.filter(
    (n) => n.sourceId !== fresh.id && n.similarity >= 0.78,
  );
  if (candidates.length === 0) return [];
  const neighborRows = await prisma.brainMemory
    .findMany({
      where: { id: { in: candidates.map((c) => c.sourceId) } },
      select: { id: true, content: true, category: true, createdAt: true },
    })
    .catch((): never[] => []);
  const oldById = new Map(neighborRows.map((r) => [r.id, r]));

  const conflicts: Contradiction[] = [];
  for (const n of candidates) {
    const old = oldById.get(n.sourceId);
    if (!old) continue;
    if (!ELIGIBLE_CATEGORIES.has(old.category)) continue;

    // Must be materially older
    const daysApart = (fresh.createdAt.getTime() - old.createdAt.getTime()) / 86400_000;
    if (daysApart < 7) continue;

    let oldExcerpt = old.content;
    try {
      const parsed = JSON.parse(old.content) as { excerpt?: string };
      if (parsed.excerpt) oldExcerpt = parsed.excerpt;
    } catch { /* raw */ }

    const signal = detectSignal(newExcerpt, oldExcerpt);
    if (!signal) continue;

    conflicts.push({
      new_memory_id: fresh.id,
      old_memory_id: old.id,
      similarity: n.similarity,
      signal,
      new_excerpt: newExcerpt.slice(0, 180),
      old_excerpt: oldExcerpt.slice(0, 180),
      days_apart: Math.round(daysApart),
      surfaced_at: new Date().toISOString(),
    });
  }

  if (conflicts.length === 0) return [];

  // Persist + emit brain_insight so the ticker rotates it TODAY
  for (const c of conflicts) {
    const key = buildContradictionKey(c.new_memory_id, c.old_memory_id);
    await prisma.brainMemory
      .upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.CONTRADICTION, key } },
        create: {
          category: BRAIN_CATEGORIES.CONTRADICTION,
          key,
          content: JSON.stringify(c),
          confidence: c.similarity,
          source: "contradiction_surfacer",
        },
        update: { content: JSON.stringify(c), lastSeen: new Date() },
      })
      .catch(() => {});
  }

  // One consolidated audit event per call
  const top = conflicts[0];
  await prisma.auditEvent
    .create({
      data: {
        actor: "contradiction_surfacer",
        eventType: "brain_insight",
        detail: `Contradiction: "${top.new_excerpt.slice(0, 80)}" conflicts with ${top.days_apart}d-old position (${top.signal})`,
        payload: { count: conflicts.length, top } as any,
      },
    })
    .catch(() => {});

  return conflicts;
}

export interface StoredContradiction extends Contradiction {
  key: string;
  createdAt: string;
}

/**
 * Load recent contradictions for the bottom ticker — filters out
 * resolved / dismissed by default.
 */
export async function loadRecentContradictions(
  days = 7,
  includeResolved = false,
): Promise<StoredContradiction[]> {
  const since = new Date(Date.now() - days * 86400_000);
  // v10.0.65 · soft-delete bypass fix. Pre-fix this fed Nick's
  // chat context (contradiction-surfacer is one of the sources for
  // /system/prompt anchors). Soft-deleted contradictions Nour had
  // already resolved would still surface as fresh challenges.
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.CONTRADICTION, createdAt: { gte: since }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { key: true, content: true, createdAt: true },
  });
  const out: StoredContradiction[] = [];
  let malformed = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as Contradiction;
      const status = parsed.status ?? "unresolved";
      if (!includeResolved && status !== "unresolved") continue;
      out.push({ ...parsed, status, key: r.key, createdAt: r.createdAt.toISOString() });
    } catch {
      // skip · aggregated below — this sits on hot read paths (ticker,
      // badges); contradiction rows are always JSON on write, so any
      // malformed row is a true anomaly worth one loud log per call
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.contradiction-surfacer",
      new Error(`${malformed} malformed contradiction rows skipped`),
      { fn: "loadRecentContradictions", malformed, scanned: rows.length },
      "warn",
    );
  }
  return out;
}

/**
 * Load ALL contradictions including resolved ones (for the /brain
 * dashboard history view).
 */
export async function loadAllContradictions(days = 90): Promise<StoredContradiction[]> {
  return loadRecentContradictions(days, true);
}

/**
 * Apply a resolution. When "current_wins" is chosen we mark the OLD
 * memory as deprecated (confidence floor at 0.1, source tagged) so
 * downstream retrieval doesn't keep surfacing it. When "old_wins" we
 * deprecate the new one. "both_valid" + "dismissed" just update status
 * without touching memories.
 */
export async function resolveContradiction(
  key: string,
  status: Exclude<ContradictionStatus, "unresolved">,
  note?: string,
): Promise<StoredContradiction | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.CONTRADICTION, key } },
    select: { id: true, content: true, createdAt: true },
  });
  if (!row) return null;

  let parsed: Contradiction;
  try {
    parsed = JSON.parse(row.content) as Contradiction;
  } catch {
    return null;
  }

  const resolved: Contradiction = {
    ...parsed,
    status,
    resolution_note: note ?? parsed.resolution_note ?? null,
    resolved_at: new Date().toISOString(),
  };

  await prisma.brainMemory.update({
    where: { category_key: { category: BRAIN_CATEGORIES.CONTRADICTION, key } },
    data: {
      content: JSON.stringify(resolved),
      lastSeen: new Date(),
      confidence: status === "dismissed" ? 0.2 : parsed.similarity,
    },
  });

  // Deprecate whichever memory lost
  if (status === "current_wins") {
    await prisma.brainMemory
      .update({
        where: { id: parsed.old_memory_id },
        data: {
          confidence: 0.1,
          source: "deprecated_by_resolution",
          lastSeen: new Date(),
        },
      })
      .catch(() => {});
  } else if (status === "old_wins") {
    await prisma.brainMemory
      .update({
        where: { id: parsed.new_memory_id },
        data: {
          confidence: 0.1,
          source: "deprecated_by_resolution",
          lastSeen: new Date(),
        },
      })
      .catch(() => {});
  }

  // v-truth · NICK_CONTRADICTION_CLEANUP (default-OFF) · soft-delete the
  // SUPERSEDED memory so the stale belief leaves the recall pool. Layers
  // on top of the confidence-floor above; self-gates + graceful, no-ops
  // for both_valid/dismissed (no loser). Flag off = byte-identical to today.
  const { cleanupResolvedContradiction } = await import(
    "@/lib/brain/contradiction-cleanup"
  );
  await cleanupResolvedContradiction(
    status,
    parsed.new_memory_id,
    parsed.old_memory_id,
  );

  return { ...resolved, key, createdAt: row.createdAt.toISOString() };
}

export async function countUnresolved(days = 14): Promise<number> {
  const list = await loadRecentContradictions(days, false);
  return list.length;
}
