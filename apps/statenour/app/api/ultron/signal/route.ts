import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";
import { findTeachingMoments } from "@/lib/brain/teaching-moments";
import { findCounterIntuitive } from "@/lib/brain/counter-intuitive";
import { findCorrelations } from "@/lib/brain/correlation-finder";
import { distillWisdom } from "@/lib/brain/wisdom-distiller";
import { analyzeAttentionPatterns } from "@/lib/brain/attention-tracker";
import { cached } from "@/lib/utils/cache";
import { daysAgo } from "@/lib/utils/datetime";

/**
 * GET /api/ultron/signal
 *
 * THE SIGNAL ZONE — composite endpoint feeding the middle Ultron panel.
 * Aggregates:
 *   - 6 brain engines (blind-spots, teaching, counter-intuitive, correlations,
 *     wisdom, attention) — same contracts as hq-signals
 *   - Bet desk: Nick's active predictions + calibration scoreboard
 *   - Rumination stats (server-side open counts)
 *   - Focus score from attention-tracker for the mind chip on the pulse strip
 *
 * Cache: 300s (L1) + Redis. These engines are heavy (each runs ~10 Prisma
 * queries), so caching hard is mandatory.
 */

type SignalKind = "blind_spot" | "teaching_moment" | "counter_intuitive" | "correlation" | "wisdom";

type UltronSignal =
  | { kind: "blind_spot"; severity: "critical" | "high" | "medium" | "low"; domain: string; title: string; evidence: string; action: string; daysSinceAttention: number }
  | { kind: "teaching_moment"; domain: string; title: string; why: string; lesson: string; evidence: string }
  | { kind: "counter_intuitive"; category: string; assumption: string; reality: string; impact: string; dataPoints: number }
  | { kind: "correlation"; metricA: string; metricB: string; coefficient: number; direction: "positive" | "negative"; strength: "strong" | "moderate" | "weak"; interpretation: string; dataPoints: number }
  | { kind: "wisdom"; content: string };

interface BetSummary {
  id: string;
  prediction: string;
  category: string | null;
  confidence: number; // 0-1
  createdAt: string;
  targetDate: string;
  ageDays: number;
}

interface SignalPayload {
  signals: UltronSignal[];
  counts: {
    blindSpots: { critical: number; high: number; medium: number; low: number; total: number };
    teachingMoments: number;
    counterIntuitive: number;
    correlations: number;
    wisdom: number;
  };
  bets: {
    active: BetSummary[];
    calibration: {
      last30d: { confirmed: number; disproven: number; pending: number; total: number };
      hitRate: number | null; // % — null if <3 resolved
      byCategory: Array<{ category: string; hitRate: number; sample: number }>;
    };
  };
  attention: {
    topTopics: Array<{ topic: string; mentions: number }>;
    neglectedWithGoals: Array<{ domain: string; daysSilent: number }>;
    focusScore: number;
    velocity: number;
    actionRatio: number;
  } | null;
  ruminations: {
    openPending: number; // unresolved decisions aging >3d
    reopenedThisWeek: number; // decisions/commitments edited 3+ times in 7d
  };
  generatedAt: string;
}

const KIND_PRIORITY: Record<SignalKind, number> = {
  blind_spot: 0,
  teaching_moment: 1,
  counter_intuitive: 2,
  correlation: 3,
  wisdom: 4,
};
const SEVERITY_PRIORITY: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const revalidate = 300;

export async function GET() {
  try {
    const payload = await cached<SignalPayload>("ultron_signal_v1", 300, async () => {
      const thirtyDaysAgo = daysAgo(30);

      const [
        blindSpots,
        teaching,
        counter,
        correlations,
        wisdom,
        attention,
        predictions,
        predResolved30d,
        openDecisionsOld,
      ] = await Promise.all([
        detectBlindSpots().catch(() => []),
        findTeachingMoments().catch(() => []),
        findCounterIntuitive().catch(() => []),
        findCorrelations().catch(() => []),
        distillWisdom().catch((): string[] => []),
        analyzeAttentionPatterns().catch(() => null),
        // Active predictions (bets). Apr 19 · Filter out stale
        // predictions that reference retired concepts (open loops,
        // daily score). The predictive-engine prompt is updated but
        // historical rows still linger — hide them so the UI stops
        // showing "open loops will exceed 6 days" copy.
        prisma.prediction.findMany({
          where: {
            status: "pending",
            NOT: [
              { prediction: { contains: "open loop", mode: "insensitive" } },
              { prediction: { contains: "open loops", mode: "insensitive" } },
              { prediction: { contains: "daily score", mode: "insensitive" } },
              { prediction: { contains: "log score", mode: "insensitive" } },
            ],
          },
          orderBy: { confidence: "desc" },
          take: 6,
          select: { id: true, prediction: true, category: true, confidence: true, createdAt: true, targetDate: true },
        }).catch((): Array<{ id: string; prediction: string; category: string | null; confidence: number; createdAt: Date; targetDate: string }> => []),
        // Last 30d resolved for calibration
        prisma.prediction.findMany({
          where: { createdAt: { gte: thirtyDaysAgo } },
          select: { status: true, category: true },
        }).catch((): Array<{ status: string; category: string | null }> => []),
        // Rumination proxy — pending decisions with reviewAt in the past
        prisma.decisionReplay.count({
          where: { reviewed: false, reviewAt: { lte: new Date() } },
        }).catch(() => 0),
      ]);

      // ── Signals ──
      const signals: UltronSignal[] = [];
      for (const b of blindSpots.slice(0, 4)) {
        signals.push({
          kind: "blind_spot",
          severity: b.severity,
          domain: b.domain,
          title: b.description,
          evidence: b.evidence,
          action: b.suggestedAction,
          daysSinceAttention: b.daysSinceAttention,
        });
      }
      for (const t of teaching.slice(0, 3)) {
        signals.push({
          kind: "teaching_moment",
          domain: t.domain,
          title: t.observation,
          why: t.why,
          lesson: t.lesson,
          evidence: t.evidence,
        });
      }
      for (const c of counter.slice(0, 3)) {
        signals.push({
          kind: "counter_intuitive",
          category: c.category,
          assumption: c.assumption,
          reality: c.reality,
          impact: c.impact,
          dataPoints: c.dataPoints,
        });
      }
      for (const r of correlations.filter((c) => c.surprising).slice(0, 2)) {
        signals.push({
          kind: "correlation",
          metricA: r.metricA,
          metricB: r.metricB,
          coefficient: r.coefficient,
          direction: r.direction,
          strength: r.strength,
          interpretation: r.interpretation,
          dataPoints: r.dataPoints,
        });
      }
      for (const w of wisdom.slice(0, 2)) {
        signals.push({ kind: "wisdom", content: w });
      }

      signals.sort((a, b) => {
        const pa = KIND_PRIORITY[a.kind];
        const pb = KIND_PRIORITY[b.kind];
        if (pa !== pb) return pa - pb;
        if (a.kind === "blind_spot" && b.kind === "blind_spot") {
          return SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity];
        }
        return 0;
      });

      // ── Counts ──
      const counts = {
        blindSpots: {
          critical: blindSpots.filter((b) => b.severity === "critical").length,
          high: blindSpots.filter((b) => b.severity === "high").length,
          medium: blindSpots.filter((b) => b.severity === "medium").length,
          low: blindSpots.filter((b) => b.severity === "low").length,
          total: blindSpots.length,
        },
        teachingMoments: teaching.length,
        counterIntuitive: counter.length,
        correlations: correlations.filter((c) => c.surprising).length,
        wisdom: wisdom.length,
      };

      // ── Bets / calibration ──
      const now = Date.now();
      const activeBets: BetSummary[] = predictions.map((p) => ({
        id: p.id,
        prediction: p.prediction,
        category: p.category,
        confidence: p.confidence,
        createdAt: p.createdAt.toISOString(),
        targetDate: p.targetDate,
        ageDays: Math.floor((now - p.createdAt.getTime()) / 86400000),
      }));

      const confirmed = predResolved30d.filter((p) => p.status === "confirmed").length;
      const disproven = predResolved30d.filter((p) => p.status === "disproven").length;
      const pending = predResolved30d.filter((p) => p.status === "pending").length;
      const resolved = confirmed + disproven;
      const hitRate = resolved >= 3 ? Math.round((confirmed / resolved) * 100) : null;

      const byCat = new Map<string, { hits: number; total: number }>();
      for (const p of predResolved30d) {
        if (p.status === "pending") continue;
        const key = p.category || "general";
        const e = byCat.get(key) ?? { hits: 0, total: 0 };
        e.total++;
        if (p.status === "confirmed") e.hits++;
        byCat.set(key, e);
      }
      const byCategory = Array.from(byCat.entries())
        .filter(([, e]) => e.total >= 3)
        .map(([category, e]) => ({
          category,
          hitRate: Math.round((e.hits / e.total) * 100),
          sample: e.total,
        }))
        .sort((a, b) => b.sample - a.sample);

      const bets = {
        active: activeBets,
        calibration: {
          last30d: { confirmed, disproven, pending, total: predResolved30d.length },
          hitRate,
          byCategory,
        },
      };

      // ── Attention compact ──
      const attentionCompact = attention
        ? {
            topTopics: attention.topTopics.slice(0, 3),
            neglectedWithGoals: attention.neglectedDomains
              .filter((d) => d.hasGoal)
              .slice(0, 3)
              .map((d) => ({ domain: d.domain, daysSilent: d.daysSinceEngagement })),
            focusScore: attention.focusScore,
            velocity: attention.attentionVelocity,
            actionRatio: attention.depthAnalysis.actionRatio,
          }
        : null;

      // ── Rumination ──
      const ruminations = {
        openPending: openDecisionsOld,
        reopenedThisWeek: 0, // placeholder — v2 will track via reopen events
      };

      return {
        signals,
        counts,
        bets,
        attention: attentionCompact,
        ruminations,
        generatedAt: new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: {
          signals: [],
          counts: { blindSpots: { critical: 0, high: 0, medium: 0, low: 0, total: 0 }, teachingMoments: 0, counterIntuitive: 0, correlations: 0, wisdom: 0 },
          bets: { active: [], calibration: { last30d: { confirmed: 0, disproven: 0, pending: 0, total: 0 }, hitRate: null, byCategory: [] } },
          attention: null,
          ruminations: { openPending: 0, reopenedThisWeek: 0 },
          generatedAt: new Date().toISOString(),
        },
        error: String(err),
      },
      { status: 500 },
    );
  }
}
