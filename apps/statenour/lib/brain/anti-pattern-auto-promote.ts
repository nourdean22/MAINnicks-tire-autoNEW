/**
 * Auto-promote D/F graded decisions to anti-pattern drafts (W12.4 compound loop).
 *
 * Runs inside the nightly `/api/cron/auto-calibrate` pass. For every
 * MasteryDecision graded D or F in the last 24h, create (or update) a
 * BrainMemory(anti_pattern) row keyed on the decision slug + date.
 *
 * Drafts are tagged with `severity: "warn"` + `tags: ["auto-draft"]`
 * so Nour can distinguish them from hand-entered lessons in
 * /system/anti-patterns. Promoting a draft to canonical is a no-op —
 * the row is the same shape.
 *
 * Idempotent: upserts by key, so repeat runs refresh the row without
 * creating duplicates. Bumps `revisitCount` if the same decision
 * re-grades to D/F after a review update.
 */

import { prisma } from "@/lib/prisma";
import type { AntiPatternMeta } from "@/lib/brain/memory-metadata-types";

const GRADE_TO_NUM: Record<string, number> = {
  A: 4, "A+": 4, "A-": 3.7,
  B: 3, "B+": 3.3, "B-": 2.7,
  C: 2, "C+": 2.3, "C-": 1.7,
  D: 1, "D+": 1.3, "D-": 0.7,
  F: 0,
};
function gradeToNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = GRADE_TO_NUM[g.toUpperCase()];
  return typeof n === "number" ? n : null;
}

/** Map decision.domain string into anti-pattern domain enum. */
function mapDomain(d: string | null): AntiPatternMeta["domain"] {
  if (!d) return "other";
  const x = d.toLowerCase();
  if (x.includes("business") || x.includes("shop") || x.includes("money")) return "business";
  if (x.includes("health") || x.includes("body") || x.includes("sleep")) return "health";
  if (x.includes("tech") || x.includes("system") || x.includes("code")) return "tech";
  if (x.includes("family") || x.includes("relationship") || x.includes("dania")) return "relationships";
  if (x.includes("personal") || x.includes("mastery") || x.includes("identity")) return "personal";
  return "other";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface AutoPromoteResult {
  examined: number;
  promoted: string[];
  updated: string[];
  skipped: string[];
}

export async function autoPromoteFailedDecisions(
  sinceMs = 24 * 3600_000,
): Promise<AutoPromoteResult> {
  const since = new Date(Date.now() - sinceMs);
  const recent = await prisma.masteryDecision.findMany({
    where: {
      updatedAt: { gte: since },
      grade: { not: null },
      actualOutcome: { not: null },
      deletedAt: null,
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  const result: AutoPromoteResult = { examined: recent.length, promoted: [], updated: [], skipped: [] };

  for (const d of recent) {
    const gn = gradeToNum(d.grade);
    if (gn === null || gn > 1) {
      result.skipped.push(`${d.id}:grade-not-fail`);
      continue;
    }

    const key = `auto-${d.id}-${slugify(d.title || "decision")}`;
    const now = new Date().toISOString();
    const meta: AntiPatternMeta = {
      attempt: `Decided: "${d.chosen ?? d.title}" (stakes: ${d.stakes ?? "—"})`,
      outcome: d.actualOutcome ?? "(unreviewed)",
      severity: "warn",
      domain: mapDomain(d.domain),
      firstTriedAt: d.createdAt.toISOString(),
      lastRevisitedAt: null,
      revisitCount: 0,
      tags: ["auto-draft", `grade-${d.grade?.toLowerCase() ?? "low"}`, ...(d.domain ? [d.domain.toLowerCase().slice(0, 20)] : [])],
    };
    const content = `[auto-draft from ${d.grade}-graded decision] ${d.title}. ${d.chosen ? `You chose: ${d.chosen}.` : ""} Lesson: review this before taking a similar decision.`;

    const existing = await prisma.brainMemory.findUnique({
      where: { category_key: { category: "anti_pattern", key } },
    });
    if (existing) {
      const existingMeta = (existing.metadata as Partial<AntiPatternMeta> | null) ?? {};
      const mergedMeta: AntiPatternMeta = {
        ...meta,
        firstTriedAt: existingMeta.firstTriedAt ?? meta.firstTriedAt,
        lastRevisitedAt: now,
        revisitCount: (existingMeta.revisitCount ?? 0) + 1,
      };
      await prisma.brainMemory.update({
        where: { category_key: { category: "anti_pattern", key } },
        data: {
          content,
          metadata: mergedMeta as unknown as object,
          lastSeen: new Date(),
        },
      });
      result.updated.push(key);
    } else {
      await prisma.brainMemory.create({
        data: {
          category: "anti_pattern",
          key,
          content,
          metadata: meta as unknown as object,
          confidence: 0.8,
          source: "auto-promote",
        },
      });
      result.promoted.push(key);
    }
  }

  return result;
}
