/**
 * lib/services/anti-patterns.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The anti-pattern library (W12.4) shared service. Lifted verbatim
 * from app/api/system/anti-patterns/route.ts + .../revisit/route.ts so
 * the legacy REST endpoints AND the new `system.*` tRPC procedures call
 * the same functions · drift between consumers structurally impossible.
 *
 * Storage: BrainMemory(category="anti_pattern"). Each row is a cohesive
 * entry — key (short tag) · content (lesson text) · metadata (attempt /
 * outcome / domain / severity / revisit history / tags).
 */

import { prisma } from "@/lib/prisma";
import { softDelete } from "@/lib/db/soft-delete";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { ServiceError } from "@/lib/utils/service-error";

export type Severity = "info" | "warn" | "critical";
export type Domain =
  | "business"
  | "personal"
  | "tech"
  | "health"
  | "relationships"
  | "other";

export interface AntiPatternMeta {
  attempt: string;
  outcome: string;
  severity: Severity;
  domain: Domain;
  firstTriedAt: string;
  lastRevisitedAt: string | null;
  revisitCount: number;
  tags: string[];
}

/** Shape the create/update mutation accepts (already Zod-validated upstream). */
export interface CreateAntiPatternInput {
  key: string;
  attempt: string;
  outcome: string;
  lesson: string;
  severity: Severity;
  domain: Domain;
  tags: string[];
}

/** List every (non-deleted) anti-pattern + the domain/severity rollup. */
export async function listAntiPatterns() {
  // v8.27 · soft-delete retrofit · don't resurface deleted patterns.
  const rows = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.ANTI_PATTERN, deletedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  const byDomain: Record<Domain, number> = {
    business: 0,
    personal: 0,
    tech: 0,
    health: 0,
    relationships: 0,
    other: 0,
  };
  const bySeverity: Record<Severity, number> = {
    info: 0,
    warn: 0,
    critical: 0,
  };

  const items = rows.map((r) => {
    const meta = (r.metadata as unknown as AntiPatternMeta) ?? null;
    if (meta) {
      if (meta.domain && byDomain[meta.domain] !== undefined)
        byDomain[meta.domain]++;
      if (meta.severity && bySeverity[meta.severity] !== undefined)
        bySeverity[meta.severity]++;
    }
    return {
      key: r.key,
      lesson: r.content,
      attempt: meta?.attempt ?? "",
      outcome: meta?.outcome ?? "",
      severity: meta?.severity ?? "warn",
      domain: meta?.domain ?? "other",
      firstTriedAt: meta?.firstTriedAt ?? r.createdAt.toISOString(),
      lastRevisitedAt: meta?.lastRevisitedAt ?? null,
      revisitCount: meta?.revisitCount ?? 0,
      tags: meta?.tags ?? [],
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });

  return {
    items,
    summary: {
      total: items.length,
      byDomain,
      bySeverity,
      oldestAt:
        items.length > 0 ? items[items.length - 1].firstTriedAt : null,
    },
  };
}

/** Create a new anti-pattern, or merge into an existing one by key. */
export async function upsertAntiPattern(body: CreateAntiPatternInput) {
  const now = new Date().toISOString();
  const meta: AntiPatternMeta = {
    attempt: body.attempt,
    outcome: body.outcome,
    severity: body.severity,
    domain: body.domain,
    firstTriedAt: now,
    lastRevisitedAt: null,
    revisitCount: 0,
    tags: body.tags,
  };
  const existing = await prisma.brainMemory.findUnique({
    where: {
      category_key: {
        category: BRAIN_CATEGORIES.ANTI_PATTERN,
        key: body.key,
      },
    },
  });
  if (existing) {
    // Merge — keep original firstTriedAt + revisit history, update
    // lesson text + severity.
    const existingMeta =
      (existing.metadata as unknown as AntiPatternMeta | null) ?? meta;
    const merged: AntiPatternMeta = {
      ...existingMeta,
      severity: body.severity,
      domain: body.domain,
      tags: body.tags,
      attempt: body.attempt,
      outcome: body.outcome,
    };
    const updated = await prisma.brainMemory.update({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.ANTI_PATTERN,
          key: body.key,
        },
      },
      data: {
        content: body.lesson,
        metadata: merged as unknown as object,
        confidence: 1,
      },
    });
    return {
      item: {
        key: updated.key,
        lesson: updated.content,
        ...(merged as object),
      },
      action: "updated" as const,
    };
  }
  const created = await prisma.brainMemory.create({
    data: {
      category: BRAIN_CATEGORIES.ANTI_PATTERN,
      key: body.key,
      content: body.lesson,
      metadata: meta as unknown as object,
      confidence: 1,
      source: "anti_pattern_library",
    },
  });
  return {
    item: {
      key: created.key,
      lesson: created.content,
      ...(meta as object),
    },
    action: "created" as const,
  };
}

/** Bump revisitCount + lastRevisitedAt. Throws ServiceError(404) when missing. */
export async function revisitAntiPattern(key: string) {
  const existing = await prisma.brainMemory.findUnique({
    where: {
      category_key: { category: BRAIN_CATEGORIES.ANTI_PATTERN, key },
    },
  });
  if (!existing) {
    throw new ServiceError(`no anti-pattern: ${key}`, 404);
  }
  const meta = (existing.metadata as unknown as AntiPatternMeta | null) ?? {
    attempt: "",
    outcome: "",
    severity: "warn",
    domain: "other",
    firstTriedAt: existing.createdAt.toISOString(),
    lastRevisitedAt: null,
    revisitCount: 0,
    tags: [],
  };
  const next: AntiPatternMeta = {
    ...meta,
    lastRevisitedAt: new Date().toISOString(),
    revisitCount: (meta.revisitCount ?? 0) + 1,
  };
  await prisma.brainMemory.update({
    where: {
      category_key: { category: BRAIN_CATEGORIES.ANTI_PATTERN, key },
    },
    data: { metadata: next as unknown as object },
  });
  return { key, revisitCount: next.revisitCount };
}

/** Soft-remove an anti-pattern (recoverable from trash). */
export async function deleteAntiPattern(key: string) {
  // v7.9: soft-delete — anti-patterns are sometimes deleted by mistake;
  // soft-delete keeps them recoverable + preserves occurrence history
  // for the brain pattern miner.
  const result = await softDelete("brainMemory", {
    category_key: { category: BRAIN_CATEGORIES.ANTI_PATTERN, key },
  });
  return { key, deleted: result.ok, soft: true, noop: result.noop };
}
