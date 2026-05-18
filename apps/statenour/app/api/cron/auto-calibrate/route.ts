import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("cron/auto-calibrate");

export const maxDuration = 60;

/**
 * GET /api/cron/auto-calibrate — nightly belief recalibration.
 *
 * Replaces the manual "CALIBRATE MEMORY · START" card that lived in
 * the signal zone. That card made Nour click a button to run what
 * the system should handle on its own.
 *
 * Runs every night at 2:30am ET. Pulls up to 10 aging beliefs
 * (same pool the old manual ritual pulled from) and:
 *
 *   HIGH-CONFIDENCE + CONTRADICTION-FREE  → auto-verify
 *     (confidence += 0.05, seenCount++, updatedAt = now)
 *     No human input needed; the system is confident this still holds.
 *
 *   CONTRADICTED in the last 14 days       → queue for morning review
 *     Written back with metadata.flag = "needs_review" so morning's
 *     situation card can list them as "2 beliefs need your call."
 *
 *   LOW-CONFIDENCE + STALE (>60d)          → auto-retire
 *     expiresAt = now, category prefixed "retired_".
 *     Silent cleanup; Nour can see what was retired in the summary.
 *
 *   NEUTRAL                                → leave alone
 *     Not old enough / not contradicted. Next cycle will re-evaluate.
 *
 * Writes a single `belief_refresh_report` BrainMemory row the
 * situation card reads the next morning. Human-readable summary +
 * metadata.changes with the diff.
 *
 * Cron config (vercel.json):
 *   { "path": "/api/cron/auto-calibrate", "schedule": "30 2 * * *" }
 */

const CALIBRATABLE_CATEGORIES = [
  "pattern",
  "insight",
  "preference",
  "feedback",
  "wisdom",
  "rule",
  "routine",
];
// `identity` is intentionally excluded — identity axes are too
// load-bearing to auto-anything. Nour must rule those explicitly.

interface ChangeRecord {
  id: string;
  action: "verified" | "queued_for_review" | "retired";
  category: string;
  key: string;
  preview: string;
  reason: string;
  before?: { confidence: number };
  after?: { confidence: number };
}

export const GET = cronHandler(async () => {
  const now = new Date();

  // Pull candidates
  const candidates = await prisma.brainMemory.findMany({
    where: {
      category: { in: CALIBRATABLE_CATEGORIES },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      createdAt: { lte: daysAgo(30) },
    },
    orderBy: [{ lastSeen: "asc" }, { confidence: "desc" }],
    take: 20,
    select: {
      id: true,
      category: true,
      key: true,
      content: true,
      confidence: true,
      seenCount: true,
      lastSeen: true,
      createdAt: true,
      metadata: true,
    },
  });

  if (candidates.length === 0) {
    return { candidates: 0, changes: [] };
  }

  // Build a set of recent contradiction tokens — any belief whose
  // content overlaps semantically with a "contradiction" BrainMemory
  // in the last 14d gets flagged for review, not auto-verified.
  const recentContradictions = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.CONTRADICTION,
      createdAt: { gte: daysAgo(14) },
    },
    select: { content: true },
  });
  const contradictionText = recentContradictions
    .map((c) => c.content.toLowerCase())
    .join(" ");

  const changes: ChangeRecord[] = [];

  for (const c of candidates) {
    const ageDays = Math.floor((now.getTime() - c.createdAt.getTime()) / 86400_000);
    const sinceSeenDays = Math.floor((now.getTime() - c.lastSeen.getTime()) / 86400_000);
    const preview = c.content.slice(0, 90);
    const keyWords = c.content
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 8);
    const hasContradiction = keyWords.some((w) => contradictionText.includes(w));

    // Rule 1: auto-retire very-stale low-confidence beliefs
    if (ageDays > 60 && c.confidence < 0.55 && sinceSeenDays > 45) {
      await prisma.brainMemory
        .update({
          where: { id: c.id },
          data: {
            expiresAt: now,
            // Preserve category for now; the expiresAt marks it dead
            metadata: {
              ...(typeof c.metadata === "object" && c.metadata !== null ? c.metadata : {}),
              retiredBy: "auto-calibrate",
              retiredAt: now.toISOString(),
            } as any,
          },
        });
      // v10.0.42 — was `.catch(() => {})`. Pre-fix every write
      // failure was swallowed, so the changes array claimed
      // "retired/verified/queued" while the underlying writes had
      // never committed. Next run re-processed the same candidates.
      // Now: errors propagate to the outer try/catch in the cron
      // handler, surfacing real failures.
      changes.push({
        id: c.id,
        action: "retired",
        category: c.category,
        key: c.key,
        preview,
        reason: `stale ${ageDays}d + low confidence ${c.confidence.toFixed(2)}`,
      });
      continue;
    }

    // Rule 2: contradicted → queue for morning review
    if (hasContradiction) {
      await prisma.brainMemory.update({
        where: { id: c.id },
        data: {
          metadata: {
            ...(typeof c.metadata === "object" && c.metadata !== null ? c.metadata : {}),
            flag: "needs_review",
            flaggedBy: "auto-calibrate",
            flaggedAt: now.toISOString(),
          } as any,
        },
      });
      changes.push({
        id: c.id,
        action: "queued_for_review",
        category: c.category,
        key: c.key,
        preview,
        reason: "overlaps with recent contradiction",
      });
      continue;
    }

    // Rule 3: high confidence + contradiction-free + aged → auto-verify
    if (c.confidence >= 0.7 && ageDays >= 30) {
      const newConfidence = Math.min(1.0, c.confidence + 0.05);
      await prisma.brainMemory.update({
        where: { id: c.id },
        data: {
          confidence: newConfidence,
          seenCount: c.seenCount + 1,
          lastSeen: now,
        },
      });
      changes.push({
        id: c.id,
        action: "verified",
        category: c.category,
        key: c.key,
        preview,
        reason: `aged ${ageDays}d, no contradiction detected`,
        before: { confidence: c.confidence },
        after: { confidence: newConfidence },
      });
      // Cap to 5 verifications per night so we don't inflate the
      // whole pool at once
      const verifiedCount = changes.filter((ch) => ch.action === "verified").length;
      if (verifiedCount >= 5) continue;
    }
  }

  // Write the summary row
  const verified = changes.filter((c) => c.action === "verified").length;
  const queued = changes.filter((c) => c.action === "queued_for_review").length;
  const retired = changes.filter((c) => c.action === "retired").length;
  const untouched = candidates.length - changes.length;

  if (changes.length > 0) {
    const summary =
      `${verified} verified, ${queued} need review, ${retired} retired ` +
      `(${untouched} left alone · pool ${candidates.length})`;

    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.BELIEF_REFRESH_REPORT,
          key: `report-${now.toISOString().slice(0, 10)}`,
        },
      },
      update: {
        content: summary,
        confidence: 0.9,
        expiresAt: new Date(now.getTime() + 48 * 3600_000),
        metadata: { changes, generatedAt: now.toISOString() } as any,
      },
      create: {
        category: BRAIN_CATEGORIES.BELIEF_REFRESH_REPORT,
        key: `report-${now.toISOString().slice(0, 10)}`,
        content: summary,
        confidence: 0.9,
        source: "cron:auto-calibrate",
        expiresAt: new Date(now.getTime() + 48 * 3600_000),
        metadata: { changes, generatedAt: now.toISOString() } as any,
      },
    });
  }

  // v11.0 · Compound loop: auto-promote D/F-graded decisions into
  // anti-pattern drafts. Runs nightly so Nour's anti-pattern library
  // accumulates from his actual graded history without him having to
  // log lessons manually.
  let antiPatternPromoted = 0;
  let antiPatternUpdated = 0;
  try {
    const { autoPromoteFailedDecisions } = await import("@/lib/brain/anti-pattern-auto-promote");
    const promoteResult = await autoPromoteFailedDecisions();
    antiPatternPromoted = promoteResult.promoted.length;
    antiPatternUpdated = promoteResult.updated.length;
  } catch (err) {
    log.warn("anti_pattern_auto_promote_failed", { err: err instanceof Error ? err.message : String(err) });
  }

  return {
    candidates: candidates.length,
    verified,
    queued_for_review: queued,
    retired,
    untouched,
    changes,
    antiPatternPromoted,
    antiPatternUpdated,
  };
});
