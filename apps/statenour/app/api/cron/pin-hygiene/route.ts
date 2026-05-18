import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const maxDuration = 60;

/**
 * GET /api/cron/pin-hygiene — weekly pinned_user maintenance
 *
 * Runs every Sunday 06:00 ET (see vercel.json). Scans Nour's
 * pinned_user memories and produces a soft nudge for any that
 * need attention:
 *
 *   STALE      updatedAt > 14d + seenCount == 1  → "reinforce or unpin?"
 *   VERY_STALE updatedAt > 30d                    → "likely forgotten?"
 *   OVER_CAP   beyond top-5 slot                  → "injection cap — promote or prune?"
 *   OVERSIZED  content > 800 chars                → "trim for token budget?"
 *
 * Each candidate gets a `nudge_pin_hygiene` BrainMemory row the
 * NudgePanel renders as a tappable card. Idempotent — same findings
 * update the same key instead of creating duplicates.
 *
 * Cron config: add to vercel.json crons
 *   { "path": "/api/cron/pin-hygiene", "schedule": "0 6 * * 0" }
 */
export const GET = cronHandler(async () => {
  const now = Date.now();
  const WEEK = 7 * 86400_000;
  const FORTNIGHT = 14 * 86400_000;
  const MONTH = 30 * 86400_000;

  // v10.0.42 — bounded scan + findings cap. Pre-fix no `take`; if
  // pinned_user is ever miscategorized via runaway brain-bus write,
  // this loads thousands. The over-cap rule (idx >= 5) would also
  // produce findings entries for every row beyond index 5 — no
  // upper bound. 200-row cap + 50 findings cap.
  const pins = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.PINNED_USER },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      key: true,
      content: true,
      seenCount: true,
      updatedAt: true,
      metadata: true,
    },
  });

  type Finding = {
    pinId: string;
    pinKey: string;
    kind: "stale" | "very_stale" | "over_cap" | "oversized";
    age_days?: number;
    preview: string;
  };
  const findings: Finding[] = [];

  pins.forEach((p, idx) => {
    const age = now - p.updatedAt.getTime();
    const ageDays = Math.round(age / 86400_000);
    const preview = p.content.slice(0, 90);

    if (age >= MONTH) {
      findings.push({
        pinId: p.id,
        pinKey: p.key,
        kind: "very_stale",
        age_days: ageDays,
        preview,
      });
    } else if (age >= FORTNIGHT && p.seenCount <= 1) {
      findings.push({
        pinId: p.id,
        pinKey: p.key,
        kind: "stale",
        age_days: ageDays,
        preview,
      });
    }

    if (idx >= 5) {
      findings.push({
        pinId: p.id,
        pinKey: p.key,
        kind: "over_cap",
        preview,
      });
    }

    if (p.content.length > 800) {
      findings.push({
        pinId: p.id,
        pinKey: p.key,
        kind: "oversized",
        preview,
      });
    }
  });

  // v10.0.42 — cap findings before metadata write. Pre-fix the
  // findings array could grow unbounded (one row per over-cap pin
  // beyond index 5), bloating the metadata blob to potentially
  // hundreds of KB on a runaway. 50-cap covers any realistic
  // remediation list.
  const cappedFindings = findings.slice(0, 50);

  // Write/update a single summary nudge so NudgePanel can render the
  // whole batch. The individual findings live in metadata so the UI
  // can render per-pin actions.
  if (cappedFindings.length > 0) {
    const summary =
      `${findings.length} pinned memories need review: ` +
      `${findings.filter((f) => f.kind === "very_stale").length} very stale, ` +
      `${findings.filter((f) => f.kind === "stale").length} aging, ` +
      `${findings.filter((f) => f.kind === "over_cap").length} over prompt cap, ` +
      `${findings.filter((f) => f.kind === "oversized").length} oversized.`;

    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE,
          key: "weekly_pin_review",
        },
      },
      update: {
        content: summary,
        confidence: 0.85,
        expiresAt: new Date(now + WEEK),
        metadata: { findings: cappedFindings, totalFindings: findings.length, generatedAt: new Date().toISOString() } as any,
      },
      create: {
        category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE,
        key: "weekly_pin_review",
        content: summary,
        confidence: 0.85,
        source: "cron:pin-hygiene",
        expiresAt: new Date(now + WEEK),
        metadata: { findings: cappedFindings, totalFindings: findings.length, generatedAt: new Date().toISOString() } as any,
      },
    });
  } else {
    // Clean up old nudge if everything is clean now
    await prisma.brainMemory
      .deleteMany({
        where: {
          category: BRAIN_CATEGORIES.NUDGE_PIN_HYGIENE,
          key: "weekly_pin_review",
        },
      })
      .catch(() => {});
  }

  return {
    pinsScanned: pins.length,
    findings: findings.length,
    breakdown: {
      very_stale: findings.filter((f) => f.kind === "very_stale").length,
      stale: findings.filter((f) => f.kind === "stale").length,
      over_cap: findings.filter((f) => f.kind === "over_cap").length,
      oversized: findings.filter((f) => f.kind === "oversized").length,
    },
  };
});
