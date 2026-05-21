/**
 * journal-threads · ADR-0013 (Phase D · 2026-05-18)
 *
 * CRUD over JournalThread + JournalThreadEntry. Pairs with
 * journal-convergence.ts which does the detection · this is the
 * lifecycle layer (operator names a candidate → thread is born ·
 * future entries auto-join or get suggested · dormancy sweep retires
 * stale threads).
 *
 * Centroid discipline (vector-DB audit fix):
 *   - On thread creation from a candidate → compute true mean via
 *     bulkCentroid(memberVecs)
 *   - On auto/operator/seed-extra join → roll centroid via
 *     rollCentroid(old, n, newVec) · O(d) per join
 *   - On membership removal → recompute from remaining members (rare op)
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { getEmbedding } from "@/lib/ai/provider";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  bulkCentroid,
  DEFAULTS,
  decodeCentroid,
  encodeCentroid,
  ENTRY_SOURCES,
  rollCentroid,
  type EntrySource,
} from "./journal-convergence";
import { Prisma } from "@prisma/client";

const log = rootLogger.withSurface("services/journal-threads");

// ──────────────────────── Read paths ────────────────────────

export interface ThreadSummary {
  id: string;
  name: string;
  summary: string | null;
  status: string;
  coherence: number | null;
  memberCount: number;
  detectedAt: Date;
  namedAt: Date;
  lastJoinAt: Date | null;
  recentExcerpts: string[]; // up to 3 most-recent member excerpts
}

export interface ConvergenceCandidateRow {
  clusterHash: string;
  size: number;
  coherence: number;
  nameSuggestions: string[];
  detectedAt: string;
  members: Array<{
    entrySource: EntrySource;
    entryId: string;
    excerpt: string;
    createdAt: string;
  }>;
}

export interface ThreadSuggestion {
  key: string; // `${threadId}:${entrySource}:${entryId}` · for dismiss
  threadId: string;
  threadName: string;
  entrySource: EntrySource;
  entryId: string;
  excerpt: string;
  similarity: number;
  createdAt: string;
}

/**
 * For the ThreadRail · returns active (and optionally dormant)
 * threads with a small recent-excerpt preview to render.
 */
export async function listThreads(opts: {
  includeDormant?: boolean;
  limit?: number;
} = {}): Promise<ThreadSummary[]> {
  const statusFilter = opts.includeDormant
    ? { in: ["active", "dormant"] }
    : "active";
  const limit = Math.min(opts.limit ?? 50, 100);

  const threads = await prisma.journalThread.findMany({
    where: { status: statusFilter as never, deletedAt: null },
    orderBy: [{ status: "asc" }, { lastJoinAt: "desc" }, { createdAt: "desc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      summary: true,
      status: true,
      coherence: true,
      memberCount: true,
      detectedAt: true,
      namedAt: true,
      lastJoinAt: true,
      memberships: {
        orderBy: { joinedAt: "desc" },
        take: 3,
        select: { entrySource: true, entryId: true },
      },
    },
  });
  if (threads.length === 0) return [];

  // Backfill excerpts for the 3 most-recent members per thread. One
  // round-trip per source-type to keep the query count bounded.
  // Prisma returns entrySource as `string` · narrow to EntrySource
  // here · invalid rows skipped by the EntrySource filter inside
  // fetchExcerpts via the const ENTRY_SOURCES check upstream.
  const tuples = threads.flatMap((t) =>
    t.memberships
      .filter((m): m is { entrySource: EntrySource; entryId: string } =>
        (ENTRY_SOURCES as readonly string[]).includes(m.entrySource),
      )
      .map((m) => ({
        entrySource: m.entrySource,
        entryId: m.entryId,
      })),
  );
  const excerpts = await fetchExcerpts(tuples);

  return threads.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.summary,
    status: t.status,
    coherence: t.coherence,
    memberCount: t.memberCount,
    detectedAt: t.detectedAt,
    namedAt: t.namedAt,
    lastJoinAt: t.lastJoinAt,
    recentExcerpts: t.memberships
      .map((m) => excerpts.get(`${m.entrySource}:${m.entryId}`))
      .filter((x): x is string => Boolean(x)),
  }));
}

/**
 * For the ThreadRadar · returns active convergence candidates
 * (BrainMemory rows the cron wrote) the operator hasn't named yet.
 */
export async function listConvergenceCandidates(): Promise<
  ConvergenceCandidateRow[]
> {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
      deletedAt: null,
    },
    orderBy: { confidence: "desc" },
    take: 20,
    select: { key: true, confidence: true, content: true, metadata: true },
  });

  const out: ConvergenceCandidateRow[] = [];
  for (const r of rows) {
    if (!r.key) continue;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const members = Array.isArray(meta.members) ? meta.members : [];
    const nameSuggestions = Array.isArray(meta.nameSuggestions)
      ? (meta.nameSuggestions as string[])
      : [];
    out.push({
      clusterHash: r.key,
      size: typeof meta.size === "number" ? meta.size : members.length,
      coherence:
        typeof meta.coherence === "number" ? meta.coherence : r.confidence,
      nameSuggestions: nameSuggestions.slice(0, 6),
      detectedAt:
        typeof meta.detectedAt === "string"
          ? meta.detectedAt
          : new Date().toISOString(),
      members: members
        .map((m) => m as Record<string, unknown>)
        .filter((m) =>
          (ENTRY_SOURCES as readonly string[]).includes(
            String(m.entrySource),
          ),
        )
        .map((m) => ({
          entrySource: m.entrySource as EntrySource,
          entryId: String(m.entryId),
          excerpt: String(m.excerpt ?? "").slice(0, 200),
          createdAt: String(m.createdAt ?? new Date().toISOString()),
        })),
    });
  }
  return out;
}

// ──────────────────────── Write paths ────────────────────────

/**
 * Operator creates an EMPTY thread manually (no convergence candidate).
 * Useful when the operator has a theme in mind but the cron hasn't
 * detected it yet, or when they want to pre-create a thread so the
 * auto-join hook on future captures has a target.
 *
 * No seed members · no centroid yet · the first auto-join or operator
 * pin populates both. Until then the thread has memberCount=0 and is
 * inert to scoreEntryAgainstActiveThreads (which filters memberCount>0).
 */
export async function createEmptyThread(input: {
  name: string;
  summary?: string | null;
}): Promise<{ threadId: string } | { error: string }> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { error: "name must be 1-120 chars" };
  }
  // Reject obvious duplicates (case-insensitive name match on active
  // threads only · operator gets a clearer message than the upstream
  // database error would give).
  const existing = await prisma.journalThread.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      deletedAt: null,
      status: { in: ["active", "dormant"] },
    },
    select: { id: true, status: true },
  });
  if (existing) {
    return {
      error: `thread "${name}" already exists (${existing.status})`,
    };
  }

  const now = new Date();
  const thread = await prisma.journalThread.create({
    data: {
      name,
      summary: input.summary?.trim().slice(0, 400) || null,
      status: "active",
      coherence: null, // unknown until first members join
      detectedAt: now, // counts as "detected" by operator intent
      namedAt: now,
      lastJoinAt: null, // never joined yet
      centroid: null, // computed on first join via rollCentroid
      memberCount: 0,
    },
    select: { id: true },
  });

  log.info("empty_thread_created", { threadId: thread.id, name });
  return { threadId: thread.id };
}

/**
 * Operator confirms a convergence candidate → spawn a JournalThread,
 * link seed members, compute true-mean centroid, soft-delete the
 * candidate row (keeps history, prevents re-detection).
 */
export async function confirmCandidate(input: {
  clusterHash: string;
  name: string;
  summary?: string | null;
}): Promise<{ threadId: string; memberCount: number } | { error: string }> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) {
    return { error: "name must be 1-120 chars" };
  }

  const candidate = await prisma.brainMemory.findFirst({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
      key: input.clusterHash,
      deletedAt: null,
    },
  });
  if (!candidate) return { error: "candidate not found or already actioned" };

  const meta = (candidate.metadata ?? {}) as Record<string, unknown>;
  const rawMembers = Array.isArray(meta.members)
    ? (meta.members as Array<Record<string, unknown>>)
    : [];
  const members = rawMembers
    .filter((m) =>
      (ENTRY_SOURCES as readonly string[]).includes(
        String(m.entrySource),
      ),
    )
    .map((m) => ({
      entrySource: m.entrySource as EntrySource,
      entryId: String(m.entryId),
    }));
  if (members.length < DEFAULTS.minClusterSize) {
    return { error: "candidate has too few members" };
  }

  // Pull seed vectors to compute the true-mean centroid.
  const vecRows = await prisma.vectorEmbedding.findMany({
    where: {
      OR: members.map((m) => ({
        sourceType: m.entrySource,
        sourceId: m.entryId,
      })),
    },
    select: { sourceType: true, sourceId: true, embedding: true },
  });
  const vecMap = new Map<string, number[]>();
  let dim = 0;
  for (const r of vecRows) {
    try {
      const v = JSON.parse(r.embedding) as number[];
      if (!Array.isArray(v) || v.length === 0) continue;
      dim = dim || v.length;
      if (v.length !== dim) continue; // dimension mismatch · skip
      vecMap.set(`${r.sourceType}:${r.sourceId}`, v);
    } catch {
      // skip bad rows
    }
  }
  const seedVecs = members
    .map((m) => vecMap.get(`${m.entrySource}:${m.entryId}`))
    .filter((v): v is number[] => Array.isArray(v) && v.length === dim);
  const centroid = seedVecs.length > 0 ? bulkCentroid(seedVecs) : null;
  const coherence =
    typeof meta.coherence === "number" ? meta.coherence : null;

  // Atomic: spawn the thread AND retire the candidate together. Pre-fix
  // these were two separate awaits — a crash between them left the
  // candidate un-deleted, so the next convergence scan re-surfaced it
  // and a second confirm created a duplicate thread.
  const now = new Date();
  const [thread] = await prisma.$transaction([
    prisma.journalThread.create({
      data: {
        name,
        summary: input.summary?.trim().slice(0, 400) || null,
        status: "active",
        coherence,
        detectedAt:
          typeof meta.detectedAt === "string"
            ? new Date(meta.detectedAt)
            : now,
        namedAt: now,
        lastJoinAt: now,
        centroid: centroid ? encodeCentroid(centroid) : null,
        memberCount: members.length,
        memberships: {
          create: members.map((m) => ({
            entrySource: m.entrySource,
            entryId: m.entryId,
            similarity: coherence ?? 1.0, // seed members share the cluster
            joinMode: "seed",
          })),
        },
      },
      select: { id: true, memberCount: true },
    }),
    // Soft-delete the candidate so the cron + radar don't re-surface it.
    prisma.brainMemory.updateMany({
      where: { id: candidate.id },
      data: { deletedAt: now },
    }),
  ]);

  log.info("thread_created_from_candidate", {
    threadId: thread.id,
    name,
    memberCount: members.length,
    coherence,
  });
  return { threadId: thread.id, memberCount: members.length };
}

/**
 * Operator dismisses a candidate (didn't feel like a real theme) ·
 * soft-delete so it doesn't re-fire on the next scan.
 */
export async function dismissCandidate(
  clusterHash: string,
): Promise<{ dismissed: boolean }> {
  const res = await prisma.brainMemory.updateMany({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_CONVERGENCE_CANDIDATE,
      key: clusterHash,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  return { dismissed: res.count > 0 };
}

/**
 * Add an entry to a thread. Used by:
 *   - auto-join post-hook on capture (joinMode="auto")
 *   - operator pinning an entry manually (joinMode="operator")
 *   - candidate-confirm flow (joinMode="seed") · though that path
 *     uses the nested create above for atomicity
 *
 * Updates the cached centroid incrementally (O(d) per join).
 */
export async function joinThread(input: {
  threadId: string;
  entrySource: EntrySource;
  entryId: string;
  similarity: number;
  joinMode: "auto" | "operator" | "seed";
  textForEmbedding?: string; // if provided, will fetch/compute its vec
}): Promise<{ joined: boolean; error?: string }> {
  const thread = await prisma.journalThread.findFirst({
    where: { id: input.threadId, deletedAt: null },
    select: { id: true, centroid: true, memberCount: true, status: true },
  });
  if (!thread) return { joined: false, error: "thread not found" };

  // Check for existing membership · unique constraint will reject
  // anyway, but the explicit check gives a friendlier code path.
  const existing = await prisma.journalThreadEntry.findUnique({
    where: {
      threadId_entrySource_entryId: {
        threadId: input.threadId,
        entrySource: input.entrySource,
        entryId: input.entryId,
      },
    },
    select: { id: true },
  });
  if (existing) return { joined: false, error: "already a member" };

  // Resolve the entry's vector to fold into centroid · best-effort.
  let newVec: number[] | null = null;
  const existingVec = await prisma.vectorEmbedding.findFirst({
    where: {
      sourceType: input.entrySource,
      sourceId: input.entryId,
    },
    select: { embedding: true },
  });
  if (existingVec) {
    try {
      const parsed = JSON.parse(existingVec.embedding) as number[];
      if (Array.isArray(parsed) && parsed.length > 0) newVec = parsed;
    } catch {
      // skip
    }
  }
  if (!newVec && input.textForEmbedding) {
    try {
      newVec = await getEmbedding(input.textForEmbedding);
    } catch (err) {
      log.warn("join_embedding_failed", {
        threadId: input.threadId,
        entrySource: input.entrySource,
        entryId: input.entryId,
        error: sanitizeError(err),
      });
    }
  }

  // Incremental centroid update · only if dims match.
  const oldCentroid = decodeCentroid(thread.centroid);
  const updatedCentroid =
    newVec && (!oldCentroid || oldCentroid.length === newVec.length)
      ? rollCentroid(oldCentroid, thread.memberCount, newVec)
      : oldCentroid;

  const now = new Date();
  try {
    await prisma.$transaction([
      prisma.journalThreadEntry.create({
        data: {
          threadId: input.threadId,
          entrySource: input.entrySource,
          entryId: input.entryId,
          similarity: Math.max(0, Math.min(1, input.similarity)),
          joinMode: input.joinMode,
        },
      }),
      prisma.journalThread.update({
        where: { id: input.threadId },
        data: {
          lastJoinAt: now,
          memberCount: { increment: 1 },
          // Reactivate if a dormant thread caught a fresh entry.
          status: thread.status === "dormant" ? "active" : thread.status,
          centroid: updatedCentroid ? encodeCentroid(updatedCentroid) : thread.centroid,
        },
      }),
    ]);
  } catch (err) {
    // A concurrent joinThread for the same (threadId, entrySource,
    // entryId) can slip past the findUnique check above and collide on
    // the unique constraint. Treat it exactly like the membership check
    // did — a clean no-op join, not an unhandled throw. The transaction
    // rolled back fully, so memberCount stays correct.
    if ((err as { code?: string }).code === "P2002") {
      return { joined: false, error: "already a member" };
    }
    throw err;
  }

  log.info("thread_joined", {
    threadId: input.threadId,
    entrySource: input.entrySource,
    entryId: input.entryId,
    joinMode: input.joinMode,
    similarity: input.similarity,
  });
  return { joined: true };
}

/**
 * Persist a "this entry might belong to thread X" suggestion for the
 * SUGGEST band (0.65 ≤ sim < 0.80). Surfaced on next /journal visit.
 * Idempotent via the composite key.
 */
export async function persistThreadSuggestion(input: {
  threadId: string;
  entrySource: EntrySource;
  entryId: string;
  similarity: number;
}): Promise<void> {
  const key = `${input.threadId}:${input.entrySource}:${input.entryId}`;
  const metadata = {
    threadId: input.threadId,
    entrySource: input.entrySource,
    entryId: input.entryId,
    similarity: input.similarity,
  } as unknown as typeof Prisma.JsonNull | object;
  await prisma.brainMemory
    .upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION,
          key,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION,
        key,
        content: `${input.entrySource}:${input.entryId} · sim ${input.similarity.toFixed(2)}`,
        confidence: input.similarity,
        source: "capture-hook/journal-thread",
        metadata: metadata as never,
      },
      update: {
        confidence: input.similarity,
        metadata: metadata as never,
      },
    })
    .catch((err) => {
      log.warn("thread_suggestion_persist_failed", {
        key,
        error: sanitizeError(err),
      });
    });
}

/**
 * For the suggested-joins UI surface · entries that landed in the
 * SUGGEST band (0.65 ≤ sim < 0.80) and are waiting for the operator
 * to confirm/reject. Joins back to threads + source tables to render
 * thread name + entry excerpt.
 */
export async function listThreadSuggestions(): Promise<ThreadSuggestion[]> {
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION,
      deletedAt: null,
    },
    orderBy: { confidence: "desc" },
    take: 30,
    select: {
      key: true,
      confidence: true,
      createdAt: true,
      metadata: true,
    },
  });
  if (rows.length === 0) return [];

  // Parse + collect thread + entry refs to backfill names + excerpts.
  const parsed: Array<{
    key: string;
    threadId: string;
    entrySource: EntrySource;
    entryId: string;
    similarity: number;
    createdAt: Date;
  }> = [];
  for (const r of rows) {
    if (!r.key) continue;
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const threadId = String(meta.threadId ?? "");
    const entrySource = String(meta.entrySource ?? "");
    const entryId = String(meta.entryId ?? "");
    if (!threadId || !entryId) continue;
    if (!(ENTRY_SOURCES as readonly string[]).includes(entrySource)) continue;
    parsed.push({
      key: r.key,
      threadId,
      entrySource: entrySource as EntrySource,
      entryId,
      similarity: typeof meta.similarity === "number" ? meta.similarity : r.confidence,
      createdAt: r.createdAt,
    });
  }
  if (parsed.length === 0) return [];

  const [threads, excerpts] = await Promise.all([
    prisma.journalThread.findMany({
      where: { id: { in: [...new Set(parsed.map((p) => p.threadId))] } },
      select: { id: true, name: true },
    }),
    fetchExcerpts(
      parsed.map((p) => ({ entrySource: p.entrySource, entryId: p.entryId })),
    ),
  ]);
  const threadMap = new Map(threads.map((t) => [t.id, t.name] as const));

  return parsed
    .filter((p) => threadMap.has(p.threadId))
    .map((p) => ({
      key: p.key,
      threadId: p.threadId,
      threadName: threadMap.get(p.threadId)!,
      entrySource: p.entrySource,
      entryId: p.entryId,
      excerpt:
        excerpts.get(`${p.entrySource}:${p.entryId}`) ?? "(entry not found)",
      similarity: p.similarity,
      createdAt: p.createdAt.toISOString(),
    }));
}

/**
 * Operator confirms a suggested join → promotes to a real
 * JournalThreadEntry (joinMode="operator") and clears the suggestion.
 * Reuses joinThread() so the rolling centroid stays accurate.
 */
export async function acceptThreadSuggestion(
  key: string,
): Promise<{ joined: boolean; error?: string }> {
  const row = await prisma.brainMemory.findFirst({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION,
      key,
      deletedAt: null,
    },
    select: { id: true, metadata: true, confidence: true },
  });
  if (!row) return { joined: false, error: "suggestion not found" };

  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  const threadId = String(meta.threadId ?? "");
  const entrySource = String(meta.entrySource ?? "");
  const entryId = String(meta.entryId ?? "");
  if (
    !threadId ||
    !entryId ||
    !(ENTRY_SOURCES as readonly string[]).includes(entrySource)
  ) {
    return { joined: false, error: "suggestion metadata malformed" };
  }

  const result = await joinThread({
    threadId,
    entrySource: entrySource as EntrySource,
    entryId,
    similarity:
      typeof meta.similarity === "number" ? meta.similarity : row.confidence,
    joinMode: "operator",
  });
  // Always clear the suggestion · either we joined or it was already
  // a member · either way it shouldn't keep nagging the operator.
  await prisma.brainMemory.updateMany({
    where: { id: row.id },
    data: { deletedAt: new Date() },
  });
  return result;
}

/**
 * Operator dismisses a suggestion · soft-delete only · no auto-rejoin
 * for the same (thread, entry) pair until the next convergence scan
 * decides to write the suggestion again (which is rare).
 */
export async function dismissThreadSuggestion(
  key: string,
): Promise<{ dismissed: boolean }> {
  const res = await prisma.brainMemory.updateMany({
    where: {
      category: BRAIN_CATEGORIES.JOURNAL_THREAD_SUGGESTION,
      key,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });
  return { dismissed: res.count > 0 };
}

/**
 * Capture post-hook · fire-and-forget. Scores a freshly-captured
 * entry against active thread centroids and either auto-joins it
 * (sim ≥ 0.80) or records a suggestion (0.65 ≤ sim < 0.80) for the
 * operator to confirm on next /journal visit.
 *
 * Use from BrainDump.create / Reflection.write / SituationLog.create
 * / DecisionReplay.create call sites. Errors are swallowed (logged
 * only) · capture writes must never fail because the radar is down.
 *
 * Performance · uses the cached centroid · single round-trip to fetch
 * active threads + their centroids · O(M·d) cosine where M = active
 * thread count (typically <10).
 */
export async function tryJoinActiveThreads(
  entrySource: EntrySource,
  entryId: string,
  text: string,
): Promise<void> {
  try {
    const { scoreEntryAgainstActiveThreads } = await import(
      "./journal-convergence"
    );
    const score = await scoreEntryAgainstActiveThreads(
      entrySource,
      entryId,
      text,
    );
    if (score.action === "auto-join") {
      await joinThread({
        threadId: score.threadId,
        entrySource,
        entryId,
        similarity: score.similarity,
        joinMode: "auto",
        textForEmbedding: text,
      });
      log.info("auto_join_fired", {
        threadId: score.threadId,
        entrySource,
        entryId,
        similarity: score.similarity,
      });
    } else if (score.action === "suggest") {
      await persistThreadSuggestion({
        threadId: score.threadId,
        entrySource,
        entryId,
        similarity: score.similarity,
      });
      log.info("thread_suggestion_persisted", {
        threadId: score.threadId,
        entrySource,
        entryId,
        similarity: score.similarity,
      });
    }
    // action === "ignore" → silent · most captures land here · the
    // radar only fires on real signal.
  } catch (err) {
    log.warn("try_join_active_threads_failed", {
      entrySource,
      entryId,
      error: sanitizeError(err),
    });
  }
}

/**
 * Daily dormancy sweep · mark threads with no joins in
 * DEFAULTS.dormancyDays as status="dormant". Soft state · operator
 * can still see them in a collapsed section · auto-join can
 * re-activate them.
 */
export async function dormancyScan(): Promise<{
  scanned: number;
  retired: number;
  threshold: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DEFAULTS.dormancyDays);
  const candidates = await prisma.journalThread.findMany({
    where: {
      status: "active",
      deletedAt: null,
      OR: [
        { lastJoinAt: { lt: cutoff } },
        { lastJoinAt: null, namedAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
  });
  if (candidates.length === 0) {
    return {
      scanned: 0,
      retired: 0,
      threshold: DEFAULTS.dormancyDays,
    };
  }
  const res = await prisma.journalThread.updateMany({
    where: { id: { in: candidates.map((c) => c.id) } },
    data: { status: "dormant" },
  });
  log.info("dormancy_sweep", {
    scanned: candidates.length,
    retired: res.count,
    thresholdDays: DEFAULTS.dormancyDays,
  });
  return {
    scanned: candidates.length,
    retired: res.count,
    threshold: DEFAULTS.dormancyDays,
  };
}

// ──────────────────────── Helpers ────────────────────────

/**
 * Pull excerpts for a polymorphic batch of (entrySource, entryId) tuples.
 * One round-trip per source type. Used by listThreads() for the rail
 * preview and by the candidate-confirm flow for the response payload.
 */
async function fetchExcerpts(
  tuples: Array<{ entrySource: EntrySource; entryId: string }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tuples.length === 0) return map;

  const bySource = new Map<EntrySource, string[]>();
  for (const t of tuples) {
    const arr = bySource.get(t.entrySource) ?? [];
    arr.push(t.entryId);
    bySource.set(t.entrySource, arr);
  }

  const tasks: Promise<void>[] = [];

  if (bySource.get("brain_dump")?.length) {
    tasks.push(
      prisma.brainDump
        .findMany({
          where: { id: { in: bySource.get("brain_dump")! } },
          select: { id: true, summary: true, rawThoughts: true },
        })
        .then((rows) => {
          for (const r of rows) {
            map.set(
              `brain_dump:${r.id}`,
              (r.summary || r.rawThoughts).slice(0, 200),
            );
          }
        })
        .catch(() => undefined),
    );
  }
  if (bySource.get("reflection")?.length) {
    tasks.push(
      prisma.reflection
        .findMany({
          where: { id: { in: bySource.get("reflection")! } },
          select: { id: true, insight: true },
        })
        .then((rows) => {
          for (const r of rows) {
            map.set(`reflection:${r.id}`, r.insight.slice(0, 200));
          }
        })
        .catch(() => undefined),
    );
  }
  if (bySource.get("situation_log")?.length) {
    tasks.push(
      prisma.situationLog
        .findMany({
          where: { id: { in: bySource.get("situation_log")! } },
          select: { id: true, situation: true },
        })
        .then((rows) => {
          for (const r of rows) {
            map.set(`situation_log:${r.id}`, r.situation.slice(0, 200));
          }
        })
        .catch(() => undefined),
    );
  }
  if (bySource.get("decision_replay")?.length) {
    tasks.push(
      prisma.decisionReplay
        .findMany({
          where: { id: { in: bySource.get("decision_replay")! } },
          select: { id: true, title: true, context: true },
        })
        .then((rows) => {
          for (const r of rows) {
            map.set(
              `decision_replay:${r.id}`,
              (r.context ?? r.title).slice(0, 200),
            );
          }
        })
        .catch(() => undefined),
    );
  }

  await Promise.all(tasks);
  return map;
}
