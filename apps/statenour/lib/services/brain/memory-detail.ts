/**
 * getMemoryDetail · one memory, everything the inspector shows · 2026-09-15.
 *
 * The first by-id read of a BrainMemory the UI has ever had: every other
 * procedure lists (memories, wisdom, pinned) or aggregates. It carries the
 * PROOF fields the recall path already honours (evidence class from the
 * commit-gateway ladder, trust tier, validity interval, supersession chain)
 * so the inspector shows the same truth Nick reasons with.
 *
 * Soft-delete filtered via `activeOnly()` — 35% of brain_memories rows are
 * soft-deleted (scripts/audit-soft-delete-filters.ts header); a deleted
 * memory reads as "not found", never as a live fact. Dates are serialised to
 * ISO strings at the boundary so the client never depends on a transformer.
 */

import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { evidenceClassForSource, type MemoryEvidenceClass } from "@/lib/brain/memory-commit-gateway";

export interface MemoryLink {
  id: string;
  content: string;
  createdAt: string;
}

export interface MemoryDetail {
  id: string;
  category: string;
  key: string;
  content: string;
  source: string;
  evidence: MemoryEvidenceClass;
  trustTier: string | null;
  confidence: number;
  seenCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastSeen: string;
  expiresAt: string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastVerifiedAt: string | null;
  /** The newer memory that replaced this one, if any. */
  supersededBy: MemoryLink | null;
  /** Older memories this one replaced (newest first, at most 5). */
  supersedes: MemoryLink[];
  discoveryVerdict: string | null;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}

export async function getMemoryDetail(id: string): Promise<MemoryDetail | null> {
  const row = await prisma.brainMemory.findFirst({
    where: activeOnly({ id }),
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      source: true,
      trustTier: true,
      confidence: true,
      seenCount: true,
      createdBy: true,
      createdAt: true,
      updatedAt: true,
      lastSeen: true,
      expiresAt: true,
      validFrom: true,
      validUntil: true,
      lastVerifiedAt: true,
      discoveryVerdict: true,
      // To-one relations take no `where`; the deleted check is below.
      supersededBy: { select: { id: true, content: true, createdAt: true, deletedAt: true } },
      supersedes: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, content: true, createdAt: true },
      },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    key: row.key,
    content: row.content,
    source: row.source,
    evidence: evidenceClassForSource(row.source ?? ""),
    trustTier: row.trustTier ?? null,
    confidence: row.confidence,
    seenCount: row.seenCount,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
    expiresAt: iso(row.expiresAt),
    validFrom: iso(row.validFrom),
    validUntil: iso(row.validUntil),
    lastVerifiedAt: iso(row.lastVerifiedAt),
    supersededBy: row.supersededBy && !row.supersededBy.deletedAt
      ? { id: row.supersededBy.id, content: snippet(row.supersededBy.content), createdAt: row.supersededBy.createdAt.toISOString() }
      : null,
    supersedes: row.supersedes.map((m) => ({ id: m.id, content: snippet(m.content), createdAt: m.createdAt.toISOString() })),
    discoveryVerdict: row.discoveryVerdict ?? null,
  };
}
