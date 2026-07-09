/**
 * Belief Harvester — proactive persistence nudge. Apr 19.
 *
 * Nour asked for the system to "nudge itself to persist knowledge."
 * The importance scorer is reactive — it saves what Nour writes in
 * the moment. This runs in the background: it finds repeated themes
 * across chat_importance rows (last 30d) and suggests them as
 * durable beliefs. A belief is a named, curated value statement that
 * survives session churn and can be referenced / overridden explicitly.
 *
 * Flow:
 *   1. Pull chat_importance rows for category preference / decision
 *   2. Cluster by keyword overlap (cheap, deterministic)
 *   3. Clusters with ≥3 rows in the last 30d become `belief_candidate`
 *      rows in BrainMemory
 *   4. Nour promotes candidates → `belief` (similar to skill flow)
 *   5. Active beliefs inject into system prompt every turn
 *
 * Storage:
 *   category="belief_candidate" key=sha1(normalized theme)
 *   category="belief" key=sha1(normalized theme)
 *
 * Content shape:
 *   { statement: string, evidence_ids: string[], category: string,
 *     confidence: number, promoted: boolean, overridden: string|null }
 */

import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export interface Belief {
  statement: string;               // human-readable belief
  theme_tokens: string[];          // the tokens that clustered
  // Phase BB · type-position carve-out · inline string matches
  // BRAIN_CATEGORIES.PREFERENCE value · cannot use the namespace
  // reference in type-union context.
  category: "preference" | "decision" | "commitment";
  evidence_ids: string[];          // BrainMemory ids
  evidence_count: number;
  confidence: number;              // 0-1 — climbs with evidence count
  promoted: boolean;               // true = active belief, false = candidate
  overridden: string | null;       // if Nour rewrote it, the final text
  created_at: string;
  updated_at: string;
}

export interface StoredBelief extends Belief {
  dbId: string;
  key: string;
}

function buildBeliefKey(tokens: string[]): string {
  return createHash("sha1")
    .update(tokens.slice().sort().join("|"))
    .digest("hex")
    .slice(0, 16);
}

const STOP = new Set([
  "the","a","an","and","or","but","for","of","to","in","on","at","by","with","from","as",
  "is","are","was","be","been","being","my","our","i","we","you","me","it","this","that",
  "these","those","just","about","some","any","need","get","make","do","done","did","will",
  "would","should","can","could","might","may","also","too","very","really","only","much",
  "more","most","less","least","one","two","three","what","how","why","when","where","who",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
}

/**
 * Score cluster strength — higher = more coherent theme.
 */
function clusterTightness(members: Array<{ tokens: string[] }>): number {
  if (members.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const m of members) {
    const seen = new Set<string>();
    for (const t of m.tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  // Shared tokens must appear in ≥2 members, and we count how "dense"
  // the cluster is.
  const shared = Array.from(counts.values()).filter((n) => n >= 2).length;
  return shared / Math.max(1, members.length);
}

/**
 * Scan chat_importance rows for repeated themes. Writes belief_candidate
 * rows for clusters with ≥3 members that share ≥2 high-signal tokens.
 */
export async function harvestBeliefs(): Promise<{
  clustersFound: number;
  candidatesWritten: number;
  newCandidates: number;
}> {
  const since = new Date(Date.now() - 30 * 86400_000);
  const rows = await prisma.brainMemory.findMany({
    where: {
      // v9.1.18 · soft-delete sweep continuation.
      deletedAt: null,
      category: BRAIN_CATEGORIES.CHAT_IMPORTANCE,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, content: true, createdAt: true },
  });

  if (rows.length < 3) return { clustersFound: 0, candidatesWritten: 0, newCandidates: 0 };

  interface Parsed {
    id: string;
    excerpt: string;
    primary: "preference" | "decision" | "commitment" | null;
    tokens: string[];
    createdAt: Date;
  }
  const parsed: Parsed[] = [];
  let malformed = 0;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.content) as { excerpt?: string; primary?: string };
      const excerpt = p.excerpt ?? "";
      const primary = p.primary === "preference" || p.primary === "decision" || p.primary === "commitment"
        ? p.primary
        : null;
      if (!primary) continue;
      if (!excerpt) continue;
      parsed.push({
        id: r.id,
        excerpt,
        primary,
        tokens: tokens(excerpt),
        createdAt: r.createdAt,
      });
    } catch {
      // skip · aggregated below — malformed rows persist across the 30d
      // window, so per-row logging would re-log them every harvest run
      malformed++;
    }
  }
  if (malformed > 0) {
    logError(
      "brain.belief-harvester",
      new Error(`${malformed} malformed importance rows skipped`),
      { fn: "harvestBeliefs", malformed, scanned: rows.length },
      "warn",
    );
  }

  if (parsed.length < 3) return { clustersFound: 0, candidatesWritten: 0, newCandidates: 0 };

  // Cluster by token overlap — greedy O(n²) is fine at this scale (≤500).
  // Apr 19 tuning: loosened from overlap≥3 to overlap≥2 so smaller but
  // still-coherent themes surface. The tightness check filters noise.
  const clusters: Array<{ tokens: Set<string>; members: Parsed[] }> = [];
  for (const p of parsed) {
    let best: { idx: number; overlap: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const c = clusters[i];
      let overlap = 0;
      for (const t of p.tokens) if (c.tokens.has(t)) overlap++;
      if (overlap >= 2 && (!best || overlap > best.overlap)) {
        best = { idx: i, overlap };
      }
    }
    if (best) {
      clusters[best.idx].members.push(p);
      for (const t of p.tokens.slice(0, 8)) clusters[best.idx].tokens.add(t);
    } else {
      clusters.push({ tokens: new Set(p.tokens.slice(0, 8)), members: [p] });
    }
  }

  let written = 0;
  let newOnes = 0;
  let clusterCount = 0;

  for (const c of clusters) {
    // Apr 19 tuning: allow ≥2 members in clusters of high tightness
    // so brand-new themes aren't silenced. Still ≥3 for medium/low.
    const tightness = clusterTightness(c.members);
    const minMembers = tightness >= 0.5 ? 2 : 3;
    if (c.members.length < minMembers) continue;
    if (tightness < 0.25) continue;
    clusterCount++;

    // Derive a theme phrase — the 3 most-shared tokens
    const tokenCounts = new Map<string, number>();
    for (const m of c.members) {
      for (const t of m.tokens) tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
    }
    const topTokens = Array.from(tokenCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([t]) => t);
    const key = buildBeliefKey(topTokens);

    // Skip if promoted belief with same key already exists
    const promoted = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.BELIEF, key } },
        select: { id: true },
      })
      .catch(() => null);
    if (promoted) continue;

    // Pick the most recent eloquent row as the statement proposal
    const sample = [...c.members].sort((a, b) => b.excerpt.length - a.excerpt.length)[0];
    const statementProposal = sample.excerpt.slice(0, 200);

    const modePrimary: Belief["category"] = (() => {
      const counts: Record<string, number> = {};
      for (const m of c.members) if (m.primary) counts[m.primary] = (counts[m.primary] ?? 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return (top?.[0] ?? "preference") as Belief["category"];
    })();

    const belief: Belief = {
      statement: statementProposal,
      theme_tokens: topTokens,
      category: modePrimary,
      evidence_ids: c.members.slice(0, 12).map((m) => m.id),
      evidence_count: c.members.length,
      confidence: Math.min(0.75, 0.35 + c.members.length * 0.05),
      promoted: false,
      overridden: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const existing = await prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.BELIEF_CANDIDATE, key } },
        select: { id: true, content: true },
      })
      .catch(() => null);

    if (existing) {
      try {
        const prev = JSON.parse(existing.content) as Belief;
        const merged: Belief = {
          ...prev,
          evidence_ids: belief.evidence_ids,
          evidence_count: belief.evidence_count,
          confidence: belief.confidence,
          theme_tokens: belief.theme_tokens,
          updated_at: belief.updated_at,
        };
        await prisma.brainMemory.update({
          where: { category_key: { category: BRAIN_CATEGORIES.BELIEF_CANDIDATE, key } },
          data: {
            content: JSON.stringify(merged),
            lastSeen: new Date(),
            seenCount: { increment: 1 },
          },
        });
        written++;
      } catch (err) {
        // skip
        logError("brain.belief-harvester", err, { fn: "harvestBeliefs", key, candidateId: existing.id }, "warn");
      }
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.BELIEF_CANDIDATE,
          key,
          content: JSON.stringify(belief),
          confidence: belief.confidence,
          source: "belief_harvester",
        },
      });
      written++;
      newOnes++;
    }
  }

  return {
    clustersFound: clusterCount,
    candidatesWritten: written,
    newCandidates: newOnes,
  };
}

async function loadCategory(cat: "belief" | "belief_candidate"): Promise<StoredBelief[]> {
  const rows = await prisma.brainMemory.findMany({
    where: { deletedAt: null, category: cat }, // v9.1.18 · soft-delete sweep
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, key: true, content: true },
  });
  const out: StoredBelief[] = [];
  let malformed = 0;
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as Belief;
      out.push({ ...parsed, dbId: r.id, key: r.key });
    } catch {
      malformed++; // aggregated below — up to 100 rows per load
    }
  }
  if (malformed > 0) {
    logError(
      "brain.belief-harvester",
      new Error(`${malformed} malformed ${cat} rows skipped`),
      { fn: "loadCategory", cat, malformed, scanned: rows.length },
      "warn",
    );
  }
  return out;
}

export async function loadActiveBeliefs(): Promise<StoredBelief[]> {
  return loadCategory("belief");
}
export async function loadBeliefCandidates(): Promise<StoredBelief[]> {
  return loadCategory("belief_candidate");
}

export async function promoteBelief(key: string, overrideStatement?: string): Promise<StoredBelief | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: BRAIN_CATEGORIES.BELIEF_CANDIDATE, key } },
    select: { content: true },
  });
  if (!row) return null;
  let belief: Belief;
  try {
    belief = JSON.parse(row.content);
  } catch {
    return null;
  }
  const promoted: Belief = {
    ...belief,
    promoted: true,
    overridden: overrideStatement ? overrideStatement.trim() : belief.overridden,
    updated_at: new Date().toISOString(),
  };
  const created = await prisma.brainMemory.upsert({
    where: { category_key: { category: BRAIN_CATEGORIES.BELIEF, key } },
    create: {
      category: BRAIN_CATEGORIES.BELIEF,
      key,
      content: JSON.stringify(promoted),
      confidence: 0.8,
      source: "belief_curator",
    },
    update: { content: JSON.stringify(promoted), confidence: 0.8, lastSeen: new Date() },
    select: { id: true, key: true },
  });
  await prisma.brainMemory
    .delete({ where: { category_key: { category: BRAIN_CATEGORIES.BELIEF_CANDIDATE, key } } })
    .catch(() => {});
  return { ...promoted, dbId: created.id, key: created.key };
}

export async function dropBelief(
  key: string,
  kind: "belief" | "belief_candidate" = "belief_candidate",
): Promise<boolean> {
  const deleted = await prisma.brainMemory
    .delete({ where: { category_key: { category: kind, key } } })
    .catch(() => null);
  return !!deleted;
}

export async function editBelief(
  key: string,
  kind: "belief" | "belief_candidate",
  statement: string,
): Promise<StoredBelief | null> {
  const row = await prisma.brainMemory.findUnique({
    where: { category_key: { category: kind, key } },
    select: { id: true, content: true },
  });
  if (!row) return null;
  try {
    const prev = JSON.parse(row.content) as Belief;
    const next: Belief = {
      ...prev,
      overridden: statement.trim(),
      updated_at: new Date().toISOString(),
    };
    await prisma.brainMemory.update({
      where: { category_key: { category: kind, key } },
      data: { content: JSON.stringify(next), lastSeen: new Date() },
    });
    return { ...next, dbId: row.id, key };
  } catch {
    return null;
  }
}

/**
 * Chat-turn block — surfaces Nour's promoted beliefs so Nick can
 * anchor replies in his stated values (not model-generic advice).
 */
export async function buildBeliefsContextBlock(): Promise<string> {
  const beliefs = await loadActiveBeliefs();
  if (beliefs.length === 0) return "";
  const lines: string[] = ["## Nour's stated beliefs"];
  for (const b of beliefs.slice(0, 10)) {
    const text = b.overridden ?? b.statement;
    lines.push(`- ${text}`);
  }
  return lines.join("\n");
}
