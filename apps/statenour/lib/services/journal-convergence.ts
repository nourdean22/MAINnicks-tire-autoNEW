/**
 * journal-convergence · ADR-0013 (Phase D · 2026-05-18)
 *
 * Detects emerging themes across the 4 journal sources (BrainDump ·
 * Reflection · SituationLog · DecisionReplay) and surfaces them as
 * "convergence candidates" the operator can name into JournalThreads.
 *
 * Pipeline:
 *   1. gatherJournalEntries(daysBack) · pull from 4 source tables,
 *      normalize to common JournalEntryUnit shape
 *   2. ensureEmbeddings(entries) · upsert into VectorEmbedding for
 *      any entry without one (uses existing getEmbedding fallback chain)
 *   3. detectConvergence(entries, opts) · greedy cosine clustering ·
 *      filter clusters by cohesion + size · return candidates
 *   4. pruneClustersForExistingThreads(candidates) · remove members
 *      already in active threads (don't re-detect what's named)
 *   5. suggestNames(candidate) · one-shot aiChat call returns 3 short
 *      noun-phrases · operator picks one or types own
 *   6. persistCandidates(candidates) · upsert to BrainMemory
 *      (category="journal_convergence_candidate", key=clusterHash)
 *
 * Thresholds tunable via env (see DEFAULTS below).
 *
 * Scope decisions (per ADR-0013):
 *   - Only CONVERGENCE pattern · no contradiction / stagnation /
 *     avoidance detection
 *   - Polymorphic entry refs · (entrySource, entryId) over 4 join tables
 *   - In-process cosine over ~200 entries · sub-100ms · zero new infra
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import {
  cosineSimilarity,
  vectorCentroid,
} from "@/lib/brain/embedding-utils";
import { getEmbedding, type AiMessage } from "@/lib/ai/provider";
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
import { Prisma } from "@prisma/client";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// wave-AO follow-up · audit #438 · was bare aiChat (bypassed budget cap).
// Factory pattern · drop-in: existing call signature unchanged at use sites.
const aiChat = makeTracedAiChat("journal-convergence", "journal");

const log = rootLogger.withSurface("services/journal-convergence");

// ───────────────────────────── Constants ─────────────────────────────

export const ENTRY_SOURCES = [
  "brain_dump",
  "reflection",
  "situation_log",
  "decision_replay",
] as const;
export type EntrySource = (typeof ENTRY_SOURCES)[number];

export const DEFAULTS = {
  daysBack: Number(process.env.JOURNAL_CONVERGENCE_DAYS) || 14,
  cohesionThreshold:
    Number(process.env.JOURNAL_CONVERGENCE_COHESION) || 0.75,
  minClusterSize: Number(process.env.JOURNAL_CONVERGENCE_MIN_SIZE) || 3,
  autoJoinSimilarity:
    Number(process.env.JOURNAL_THREAD_AUTOJOIN) || 0.8,
  suggestSimilarity:
    Number(process.env.JOURNAL_THREAD_SUGGEST) || 0.65,
  dormancyDays: Number(process.env.JOURNAL_THREAD_DORMANCY_DAYS) || 30,
  nameSuggestionCount:
    Number(process.env.JOURNAL_NAME_SUGGESTIONS) || 3,
} as const;

// ───────────────────────────── Types ─────────────────────────────

/**
 * Common shape for any entry across the 4 sources. Mirrors the
 * normalization the existing /api/journal route does in-memory.
 */
export interface JournalEntryUnit {
  entrySource: EntrySource;
  entryId: string;
  text: string; // body the embedding is computed against
  excerpt: string; // <120 chars for UI preview
  createdAt: Date;
}

export interface ConvergenceCandidate {
  clusterHash: string; // stable id derived from sorted member ids
  size: number;
  coherence: number; // avg pairwise cosine (0-1)
  members: JournalEntryUnit[];
  nameSuggestions: string[]; // 3 Nick-suggested short noun phrases
  detectedAt: Date;
}

// ──────────────────────── Step 1 · gather ─────────────────────────

/**
 * Pull all 4 sources into a single normalized list. Mirrors the
 * /api/journal merge but returns the embedding-friendly shape.
 */
export async function gatherJournalEntries(
  daysBack: number = DEFAULTS.daysBack,
): Promise<JournalEntryUnit[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Convergence-safety (audit 2026-07-15) · bounded takes. These four
  // queries had NO take — the whole window materialized in memory and
  // fed the O(n²) clustering. 400/source keeps the docstring's "~200
  // entries" regime honest even for a heavy fortnight while capping the
  // worst case.
  const GATHER_CAP = 400;
  const [dumps, reflections, situations, decisions] = await Promise.all([
    prisma.brainDump
      .findMany({
        where: { date: { gte: cutoffStr }, deletedAt: null },
        select: {
          id: true,
          rawThoughts: true,
          summary: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: GATHER_CAP,
      })
      .catch((): never[] => []),
    prisma.reflection
      .findMany({
        where: { date: { gte: cutoffStr }, deletedAt: null },
        select: {
          id: true,
          insight: true,
          evidence: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: GATHER_CAP,
      })
      .catch((): never[] => []),
    prisma.situationLog
      .findMany({
        where: { createdAt: { gte: cutoff } },
        select: {
          id: true,
          situation: true,
          aiAnalysis: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: GATHER_CAP,
      })
      .catch((): never[] => []),
    prisma.decisionReplay
      .findMany({
        where: { createdAt: { gte: cutoff } },
        select: {
          id: true,
          title: true,
          context: true,
          reasoning: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: GATHER_CAP,
      })
      .catch((): never[] => []),
  ]);

  const out: JournalEntryUnit[] = [];

  for (const d of dumps) {
    const text = `${d.summary ?? ""}\n${d.rawThoughts}`.trim();
    if (!text) continue;
    out.push({
      entrySource: "brain_dump",
      entryId: d.id,
      text,
      excerpt: (d.summary || d.rawThoughts).slice(0, 120),
      createdAt: d.createdAt,
    });
  }
  for (const r of reflections) {
    const text = `${r.insight}\n${r.evidence}`.trim();
    if (!text) continue;
    out.push({
      entrySource: "reflection",
      entryId: r.id,
      text,
      excerpt: r.insight.slice(0, 120),
      createdAt: r.createdAt,
    });
  }
  for (const s of situations) {
    const text = `${s.situation}\n${s.aiAnalysis ?? ""}`.trim();
    if (!text) continue;
    out.push({
      entrySource: "situation_log",
      entryId: s.id,
      text,
      excerpt: s.situation.slice(0, 120),
      createdAt: s.createdAt,
    });
  }
  for (const d of decisions) {
    const parts = [d.title, d.context ?? "", d.reasoning ?? ""];
    const text = parts.filter(Boolean).join("\n").trim();
    if (!text) continue;
    out.push({
      entrySource: "decision_replay",
      entryId: d.id,
      text,
      excerpt: d.title.slice(0, 120),
      createdAt: d.createdAt,
    });
  }

  return out;
}

// ──────────────────────── Step 2 · embeddings ────────────────────────

/**
 * Returns a Map<entryKey, vec> for the given entries. Pulls existing
 * VectorEmbedding rows in one query (keyed by sourceType + sourceId)
 * and computes + persists missing ones via getEmbedding().
 *
 * entryKey = `${entrySource}:${entryId}` — stable cross-source key.
 */
export async function ensureEmbeddings(
  entries: JournalEntryUnit[],
): Promise<Map<string, number[]>> {
  if (entries.length === 0) return new Map();

  // Pre-fetch any existing embeddings in one round-trip.
  const sourceIds = entries.map((e) => e.entryId);
  const sourceTypes = [...new Set(entries.map((e) => e.entrySource))];

  const existing = await prisma.vectorEmbedding.findMany({
    where: {
      sourceType: { in: sourceTypes as string[] },
      sourceId: { in: sourceIds },
    },
    select: { sourceType: true, sourceId: true, embedding: true },
  });

  const map = new Map<string, number[]>();
  for (const row of existing) {
    try {
      const vec = JSON.parse(row.embedding) as number[];
      if (Array.isArray(vec) && vec.length > 0) {
        map.set(`${row.sourceType}:${row.sourceId}`, vec);
      }
    } catch {
      // bad JSON · ignore · will be recomputed below
    }
  }

  // Fill the gaps · convergence-safety (audit 2026-07-15): chunked
  // parallel instead of strictly sequential. A cold scan (many
  // un-embedded entries) used to serialize N provider round-trips
  // inside the route's 90s budget; chunks of 5 keep provider pressure
  // bounded while cutting wall-clock ~5x. Per-entry error handling is
  // unchanged — one bad entry never fails the batch.
  const missing = entries.filter((e) => !map.has(`${e.entrySource}:${e.entryId}`));
  const CHUNK = 5;
  for (let i = 0; i < missing.length; i += CHUNK) {
    await Promise.all(
      missing.slice(i, i + CHUNK).map(async (e) => {
        const key = `${e.entrySource}:${e.entryId}`;
        try {
          const vec = await getEmbedding(e.text);
          if (!Array.isArray(vec) || vec.length === 0) return;
          map.set(key, vec);
          // Best-effort persist · failure is non-fatal (we already have
          // the in-memory vec for clustering).
          await prisma.vectorEmbedding
            .create({
              data: {
                sourceType: e.entrySource,
                sourceId: e.entryId,
                content: e.text.slice(0, 4000),
                embedding: JSON.stringify(vec),
              },
            })
            .catch((err) => {
              log.warn("vector_embedding_persist_failed", {
                entrySource: e.entrySource,
                entryId: e.entryId,
                error: sanitizeError(err),
              });
            });
        } catch (err) {
          log.warn("embedding_compute_failed", {
            entrySource: e.entrySource,
            entryId: e.entryId,
            error: sanitizeError(err),
          });
        }
      }),
    );
  }

  return map;
}

// ──────────────────────── Step 3 · cluster ────────────────────────

/**
 * Greedy clustering — mirrors the pattern in clusterMemories() but
 * runs over the polymorphic journal entry set and uses cohesion (avg
 * pairwise cosine) rather than seed-centric similarity for the
 * accept/reject filter at the end.
 */
export function detectConvergence(
  entries: JournalEntryUnit[],
  vecs: Map<string, number[]>,
  opts: {
    cohesionThreshold?: number;
    minClusterSize?: number;
    joinThreshold?: number;
  } = {},
): Omit<ConvergenceCandidate, "nameSuggestions">[] {
  const cohesionThreshold =
    opts.cohesionThreshold ?? DEFAULTS.cohesionThreshold;
  const minClusterSize = opts.minClusterSize ?? DEFAULTS.minClusterSize;
  // Join threshold ≤ cohesion threshold by design · cluster GROWTH
  // uses the looser bar, then we re-check tight cohesion at the end.
  const joinThreshold = opts.joinThreshold ?? cohesionThreshold - 0.05;

  type ParsedEntry = JournalEntryUnit & { vec: number[]; key: string };
  const parsed: ParsedEntry[] = [];
  for (const e of entries) {
    const key = `${e.entrySource}:${e.entryId}`;
    const vec = vecs.get(key);
    if (!vec) continue;
    parsed.push({ ...e, vec, key });
  }
  if (parsed.length < minClusterSize) return [];

  const clusters: { centroid: number[]; members: ParsedEntry[] }[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < parsed.length; i++) {
    if (assigned.has(parsed[i].key)) continue;
    const cluster = {
      centroid: [...parsed[i].vec],
      members: [parsed[i]],
    };
    assigned.add(parsed[i].key);

    for (let j = i + 1; j < parsed.length; j++) {
      const cand = parsed[j];
      if (assigned.has(cand.key)) continue;
      if (cand.vec.length !== cluster.centroid.length) continue;
      const sim = cosineSimilarity(cluster.centroid, cand.vec);
      if (sim >= joinThreshold) {
        cluster.members.push(cand);
        assigned.add(cand.key);
        cluster.centroid = vectorCentroid(
          cluster.members.map((m) => m.vec),
        );
      }
    }

    clusters.push(cluster);
  }

  const out: Omit<ConvergenceCandidate, "nameSuggestions">[] = [];
  for (const c of clusters) {
    if (c.members.length < minClusterSize) continue;
    // Average pairwise cosine = true cohesion measure.
    let sumSim = 0;
    let pairs = 0;
    for (let a = 0; a < c.members.length; a++) {
      for (let b = a + 1; b < c.members.length; b++) {
        sumSim += cosineSimilarity(c.members[a].vec, c.members[b].vec);
        pairs += 1;
      }
    }
    const coherence = pairs > 0 ? sumSim / pairs : 0;
    if (coherence < cohesionThreshold) continue;

    const clusterHash = hashCluster(c.members.map((m) => m.key));
    out.push({
      clusterHash,
      size: c.members.length,
      coherence: Math.round(coherence * 1000) / 1000,
      members: c.members.map(
        ({ vec: _v, key: _k, ...rest }) => rest,
      ),
      detectedAt: new Date(),
    });
  }

  return out.sort((a, b) => b.coherence - a.coherence);
}

function hashCluster(keys: string[]): string {
  // Stable hash · sort keys, fnv1a · keeps the same cluster from
  // producing different candidate rows on re-scan.
  const sorted = [...keys].sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < sorted.length; i++) {
    h ^= sorted.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ────────────── Step 4 · prune for existing threads ──────────────

/**
 * Remove members that already belong to an active thread, and drop
 * candidates that fall below minClusterSize after the prune.
 */
export async function pruneCandidatesForExistingThreads(
  candidates: Omit<ConvergenceCandidate, "nameSuggestions">[],
): Promise<Omit<ConvergenceCandidate, "nameSuggestions">[]> {
  if (candidates.length === 0) return [];

  // Gather all (entrySource, entryId) tuples across candidates.
  const tuples = candidates.flatMap((c) =>
    c.members.map((m) => ({
      entrySource: m.entrySource,
      entryId: m.entryId,
    })),
  );
  if (tuples.length === 0) return candidates;

  const memberships = await prisma.journalThreadEntry.findMany({
    where: {
      OR: tuples.map((t) => ({
        entrySource: t.entrySource,
        entryId: t.entryId,
      })),
      thread: { status: "active", deletedAt: null },
    },
    select: { entrySource: true, entryId: true },
  });
  const claimed = new Set(
    memberships.map((m) => `${m.entrySource}:${m.entryId}`),
  );

  const out: Omit<ConvergenceCandidate, "nameSuggestions">[] = [];
  for (const c of candidates) {
    const fresh = c.members.filter(
      (m) => !claimed.has(`${m.entrySource}:${m.entryId}`),
    );
    if (fresh.length < DEFAULTS.minClusterSize) continue;
    // clusterHash is kept as the RAW cluster's hash (carried by
    // `...c`), NOT recomputed from the pruned set. Recomputing minted
    // a fresh BrainMemory key every time a member got claimed by a
    // thread between scans, so persistCandidates upserted a NEW row
    // and orphaned the prior one — stale candidates piled up in the
    // radar. The raw hash is the cluster's stable identity; the pruned
    // member list lives in metadata. Two raw clusters can never
    // collide on it: greedy clustering assigns each entry to exactly
    // one cluster, so no two clusters share members to prune down to.
    out.push({
      ...c,
      members: fresh,
      size: fresh.length,
    });
  }
  return out;
}

// ──────────────────────── Step 5 · name ────────────────────────

/**
 * One-shot aiChat call to generate N short noun-phrase candidates.
 * Falls back to top-word heuristic if AI is unavailable so the cron
 * never silently produces nameless candidates.
 */
export async function suggestNames(
  candidate: Omit<ConvergenceCandidate, "nameSuggestions">,
  count: number = DEFAULTS.nameSuggestionCount,
): Promise<string[]> {
  const excerpts = candidate.members
    .slice(0, 8)
    .map((m, i) => `${i + 1}. ${m.excerpt}`)
    .join("\n");
  const messages: AiMessage[] = [
    {
      role: "system",
      content:
        "You name emerging themes in a personal journal. Output ONLY a JSON array of strings · " +
        `${count} short noun phrases · 2-5 words each · no punctuation · no quotes. ` +
        "Concrete over abstract. Specific over generic.",
    },
    {
      role: "user",
      content: `These ${candidate.size} journal entries are converging on a single theme:\n\n${excerpts}\n\nName the theme · ${count} suggestions.`,
    },
  ];

  try {
    const res = await aiChat(messages, "summary");
    const txt = (res.content ?? "").trim();
    // Try strict JSON first.
    try {
      const arr = JSON.parse(txt);
      if (Array.isArray(arr)) {
        const names = arr
          .map((s) => String(s).trim())
          .filter((s) => s.length > 0 && s.length <= 60)
          .slice(0, count);
        if (names.length > 0) return names;
      }
    } catch {
      // Fall through to line parse below.
    }
    // Line-by-line fallback (model sometimes returns bullets).
    const lines = txt
      .split(/\r?\n/)
      .map((l: string) =>
        l
          .replace(/^[-*\d.)\s"'`]+/, "")
          .replace(/["'`]+$/, "")
          .trim(),
      )
      .filter((l: string) => l.length > 0 && l.length <= 60)
      .slice(0, count);
    if (lines.length > 0) return lines;
  } catch (err) {
    log.warn("name_suggestion_ai_failed", {
      clusterHash: candidate.clusterHash,
      error: sanitizeError(err),
    });
  }

  // Heuristic fallback · top words across cluster bodies, dressed up.
  return heuristicNames(candidate, count);
}

function heuristicNames(
  candidate: Omit<ConvergenceCandidate, "nameSuggestions">,
  count: number,
): string[] {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "have",
    "from",
    "what",
    "when",
    "where",
    "about",
    "could",
    "would",
    "should",
    "their",
    "there",
    "would",
    "still",
    "going",
    "really",
    "needs",
    "want",
    "thing",
    "things",
    "just",
  ]);
  const counts: Record<string, number> = {};
  for (const m of candidate.members) {
    for (const w of m.text.toLowerCase().split(/\s+/)) {
      const clean = w.replace(/[^a-z0-9]/g, "");
      if (clean.length <= 4 || stop.has(clean)) continue;
      counts[clean] = (counts[clean] ?? 0) + 1;
    }
  }
  const top = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([w]) => w);
  // Pad to `count` so the UI doesn't see an empty array.
  while (top.length < count) top.push(`theme ${top.length + 1}`);
  return top;
}

// ──────────────────── Step 6 · persist candidates ────────────────────

/**
 * Upsert each candidate to BrainMemory(category="journal_convergence_candidate")
 * keyed by clusterHash. Re-running the scan over the same window
 * idempotently refreshes the same row.
 */
export async function persistCandidates(
  candidates: ConvergenceCandidate[],
): Promise<void> {
  for (const c of candidates) {
    const metadata = {
      size: c.size,
      coherence: c.coherence,
      detectedAt: c.detectedAt.toISOString(),
      nameSuggestions: c.nameSuggestions,
      members: c.members.map((m) => ({
        entrySource: m.entrySource,
        entryId: m.entryId,
        excerpt: m.excerpt,
        createdAt: m.createdAt.toISOString(),
      })),
    } as unknown as typeof Prisma.JsonNull | object;

    const content =
      `${c.size} entries converging · coherence ${c.coherence.toFixed(2)} · ` +
      `${c.nameSuggestions[0] ?? "unnamed"}`;

    await prisma.brainMemory
      .upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
            key: c.clusterHash,
          },
        },
        create: {
          category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
          key: c.clusterHash,
          content,
          confidence: c.coherence,
          source: "inngest/journal-convergence",
          metadata: metadata as never,
        },
        update: { content, confidence: c.coherence, metadata: metadata as never },
      })
      .catch((err) => {
        log.warn("candidate_persist_failed", {
          clusterHash: c.clusterHash,
          error: sanitizeError(err),
        });
      });
  }
}

// ──────────────────── Step 7 · sweep stale candidates ────────────────

/**
 * Mark-and-sweep · soft-delete journal_convergence_candidate rows that
 * no scan has refreshed within the TTL window.
 *
 * persistCandidates upserts every live candidate on each scan, and the
 * upsert's update path bumps BrainMemory.updatedAt (@updatedAt). A row
 * whose updatedAt has gone stale is a cluster that no longer
 * re-detects — its entries aged out of the daysBack window, or the
 * cluster dissolved. The clusterHash-stability fix stopped prune from
 * orphaning rows mid-scan; this closes the other leak — clusters that
 * legitimately stop converging across scans. Pre-sweep, those phantom
 * candidates lingered in the radar indefinitely.
 *
 * TTL = 3 nightly scans, so a candidate survives two consecutive failed
 * cron runs before it ages out — one transient bad scan never sweeps a
 * still-valid candidate. Operator-confirmed / dismissed candidates are
 * already soft-deleted by confirmCandidate / dismissCandidate, so the
 * `deletedAt: null` filter skips them.
 */
const STALE_CANDIDATE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export async function sweepStaleCandidates(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CANDIDATE_TTL_MS);
  const result = await prisma.brainMemory
    .updateMany({
      where: {
        category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
        deletedAt: null,
        updatedAt: { lt: cutoff },
      },
      data: { deletedAt: new Date() },
    })
    .catch((err) => {
      log.warn("stale_candidate_sweep_failed", { error: sanitizeError(err) });
      return { count: 0 };
    });
  if (result.count > 0) {
    log.info("stale_candidates_swept", { count: result.count });
  }
  return result.count;
}

// ──────────────────── Orchestrator (cron entry) ────────────────────

/**
 * End-to-end scan · returns the persisted candidates for telemetry.
 * Wraps all 6 steps in a single call so the Inngest function stays slim.
 */
export async function runConvergenceScan(opts: {
  daysBack?: number;
  cohesionThreshold?: number;
  minClusterSize?: number;
} = {}): Promise<{
  scannedEntries: number;
  candidatesFound: number;
  candidatesAfterPrune: number;
  staleSwept: number;
  thresholds: typeof DEFAULTS;
}> {
  const entries = await gatherJournalEntries(opts.daysBack);
  if (entries.length < DEFAULTS.minClusterSize) {
    return {
      scannedEntries: entries.length,
      candidatesFound: 0,
      candidatesAfterPrune: 0,
      staleSwept: 0,
      thresholds: DEFAULTS,
    };
  }

  const vecs = await ensureEmbeddings(entries);
  const raw = detectConvergence(entries, vecs, opts);
  const pruned = await pruneCandidatesForExistingThreads(raw);

  // Name + persist sequentially · keeps load on the AI provider light
  // and avoids racing on the same BrainMemory key.
  const withNames: ConvergenceCandidate[] = [];
  for (const c of pruned) {
    const names = await suggestNames(c);
    withNames.push({ ...c, nameSuggestions: names });
  }
  await persistCandidates(withNames);

  // Sweep AFTER persist · this scan's candidates just had their
  // updatedAt bumped, so the TTL filter won't touch them — only
  // clusters absent from recent scans age out.
  const staleSwept = await sweepStaleCandidates();

  return {
    scannedEntries: entries.length,
    candidatesFound: raw.length,
    candidatesAfterPrune: pruned.length,
    staleSwept,
    thresholds: DEFAULTS,
  };
}

// ──────────────────── Centroid cache helpers ────────────────────

/**
 * Encode/decode the cached centroid vector. JSON over @db.Text is
 * symmetric with the existing VectorEmbedding pattern · same
 * resilience properties (survives if pgvector ever drops · same
 * size profile · zero new code paths).
 */
export function encodeCentroid(vec: number[]): string {
  return JSON.stringify(vec);
}

export function decodeCentroid(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as number[];
    return Array.isArray(v) && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Incrementally update a cached centroid when a new member joins.
 * `(old·n + new)/(n+1)` · no full recompute · O(d) per join where
 * d is the embedding dim. Pre-fix the scorer rebuilt the centroid
 * by re-fetching ALL member vecs on every capture write — caught by
 * the vector-database-engineer audit.
 */
export function rollCentroid(
  oldCentroid: number[] | null,
  oldCount: number,
  newVec: number[],
): number[] {
  if (!oldCentroid || oldCount === 0 || oldCentroid.length !== newVec.length) {
    return [...newVec];
  }
  const n = oldCount;
  const out = new Array<number>(newVec.length);
  for (let i = 0; i < newVec.length; i++) {
    out[i] = (oldCentroid[i] * n + newVec[i]) / (n + 1);
  }
  return out;
}

/**
 * Bulk recompute · used for SEED-time centroid (initial thread
 * creation from a candidate) where we have the seed member vecs
 * in-hand and want the true mean, not an incremental fold.
 */
export function bulkCentroid(vecs: number[][]): number[] {
  return vectorCentroid(vecs);
}

// ──────────────────── Auto-join scorer ────────────────────

/**
 * Called from capture-write hooks (BrainDump create, etc.) to score a
 * fresh entry against all active threads.
 *
 * Returns:
 *   { action: "auto-join", threadId, similarity }      sim ≥ AUTOJOIN
 *   { action: "suggest", threadId, similarity }        SUGGEST ≤ sim < AUTOJOIN
 *   { action: "ignore" }                               sim < SUGGEST
 *
 * The caller decides what to do · for AUTO it writes the membership
 * directly · for SUGGEST it writes to
 * BrainMemory(category="journal_thread_suggestion") for next page-visit.
 *
 * Performance · post vector-database-engineer audit · reads the
 * cached `centroid` column on JournalThread instead of re-fetching
 * member vecs from VectorEmbedding. One round-trip, no N×M fan-out.
 */
export async function scoreEntryAgainstActiveThreads(
  _entrySource: EntrySource,
  _entryId: string,
  text: string,
): Promise<
  | { action: "auto-join"; threadId: string; similarity: number }
  | { action: "suggest"; threadId: string; similarity: number }
  | { action: "ignore" }
> {
  if (!text || text.trim().length < 10) return { action: "ignore" };

  const threads = await prisma.journalThread.findMany({
    where: {
      status: "active",
      deletedAt: null,
      centroid: { not: null },
      memberCount: { gt: 0 },
    },
    select: { id: true, centroid: true },
  });
  if (threads.length === 0) return { action: "ignore" };

  const newVec = await getEmbedding(text).catch(() => [] as number[]);
  if (newVec.length === 0) return { action: "ignore" };

  let best: { threadId: string; sim: number } | null = null;
  for (const t of threads) {
    const c = decodeCentroid(t.centroid);
    if (!c || c.length !== newVec.length) continue;
    const sim = cosineSimilarity(c, newVec);
    if (best === null || sim > best.sim) {
      best = { threadId: t.id, sim };
    }
  }
  if (best === null) return { action: "ignore" };

  if (best.sim >= DEFAULTS.autoJoinSimilarity) {
    return {
      action: "auto-join",
      threadId: best.threadId,
      similarity: Math.round(best.sim * 1000) / 1000,
    };
  }
  if (best.sim >= DEFAULTS.suggestSimilarity) {
    return {
      action: "suggest",
      threadId: best.threadId,
      similarity: Math.round(best.sim * 1000) / 1000,
    };
  }
  return { action: "ignore" };
}
