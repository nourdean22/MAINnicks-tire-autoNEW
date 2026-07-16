/**
 * lib/services/ultron-situation.ts · Phase B.6a (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · operator-domain
 * sub-slice).
 *
 * THE unified signal composer. Replaces the 7-card stack on HQ with
 * a single synthesized narrative. A META-aggregator that composes:
 *   • blind-spot-detector
 *   • narrator voices (watcher/coach/analyst/adviser)
 *   • prediction bets + calibration
 *   • aging-belief pool · pin hygiene · rumination queue
 *   • contradictions · persona-drift · ghost · agent health
 *   • brain-growth pulse · forecasting digest · momentum
 *   • auto-resolved cron notes
 *
 * Extracted from the inline route logic in
 * app/api/ultron/situation/route.ts so BOTH the legacy REST route AND
 * the new `operator.situation` tRPC procedure call the same
 * `buildSituation` function · drift impossible. The `cached()`
 * wrapper lives inside `buildSituation` so both transports share the
 * 120s window.
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { daysAgo } from "@/lib/utils/datetime";
import {
  synthesizeSituation,
  type SituationCandidate,
  type SituationPayload,
  type SituationSeverity,
} from "@/lib/ultron/situation-synthesizer";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";
import { generateNarrations, type Narration } from "@/lib/ultron/narrator";
import { summarizeCalibration } from "@/lib/brain/calibration";
import { loadRecentContradictions } from "@/lib/brain/contradiction-surfacer";
import { loadRecentDrifts } from "@/lib/brain/persona-drift-detector";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

function narratorSeverityToSituation(n: Narration): SituationSeverity {
  if (n.severity === "warn") return "high";
  if (n.severity === "win") return "win";
  return "medium";
}

/**
 * Build the unified situation payload · cached 120s (each source is
 * heavy, HQ polls every 5min). Both the REST route and the
 * `operator.situation` tRPC procedure call this.
 */
export async function buildSituation(): Promise<SituationPayload> {
  return cached<SituationPayload>("ultron_situation_v1", 120, async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // Pull all sources in parallel. Each is fault-tolerant — a single
    // failure shouldn't collapse the whole payload.
    const [
      blindSpots,
      narrations,
      activeBets,
      predResolved30d,
      agingBeliefs,
      pinStats,
      pinnedCount,
      stalePinsCount,
      openRuminations,
      reflectionsToday,
      autoResolvedRows,
      ghostBundle,
      oldestPendingDeviceCmd,
      predMade7d,
      predResolved7d,
      brainMem24h,
      brainMem7dByCategory,
      unresolvedContradictions,
      recentPersonaDrifts,
    ] = await Promise.all([
      detectBlindSpots().catch(() => []),
      generateNarrations().catch((): Narration[] => []),
      prisma.prediction
        .findMany({
          where: { status: "pending" },
          orderBy: { confidence: "desc" },
          take: 6,
          select: {
            id: true,
            prediction: true,
            category: true,
            confidence: true,
            targetDate: true,
            createdAt: true,
          },
        })
        .catch(
          (): Array<{
            id: string;
            prediction: string;
            category: string | null;
            confidence: number;
            targetDate: string;
            createdAt: Date;
          }> => [],
        ),
      prisma.prediction
        .findMany({
          where: { createdAt: { gte: daysAgo(30) } },
          select: { status: true },
        })
        .catch((): Array<{ status: string }> => []),
      prisma.brainMemory
        .count({
          where: {
            deletedAt: null,
            category: {
              in: [
                "pattern",
                "insight",
                "preference",
                "feedback",
                "wisdom",
                "rule",
                "routine",
                "identity",
              ],
            },
            confidence: { gte: 0.6 },
            createdAt: { lte: daysAgo(30) },
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        })
        .catch(() => 0),
      prisma.brainMemory
        .findMany({
          where: { category: BRAIN_CATEGORIES.PINNED_USER },
          orderBy: { updatedAt: "desc" },
          select: { id: true, updatedAt: true },
        })
        .catch((): Array<{ id: string; updatedAt: Date }> => []),
      prisma.brainMemory
        .count({ where: { category: BRAIN_CATEGORIES.PINNED_USER, deletedAt: null } })
        .catch(() => 0),
      prisma.brainMemory
        .count({
          where: {
            category: BRAIN_CATEGORIES.PINNED_USER,
            deletedAt: null,
            updatedAt: { lt: daysAgo(14) },
          },
        })
        .catch(() => 0),
      prisma.decisionReplay
        .count({
          where: { reviewed: false, reviewAt: { lte: new Date() } },
        })
        .catch(() => 0),
      prisma.reflection
        .count({
          where: { deletedAt: null, createdAt: { gte: startOfToday } },
        })
        .catch(() => 0),
      prisma.brainMemory
        .findMany({
          where: {
            category: { in: ["belief_refresh_report", "nudge_pin_hygiene"] },
            updatedAt: { gte: daysAgo(1) },
          },
          orderBy: { updatedAt: "desc" },
          take: 3,
          select: {
            category: true,
            content: true,
            metadata: true,
            updatedAt: true,
          },
        })
        .catch(
          (): Array<{
            category: string;
            content: string;
            metadata: unknown;
            updatedAt: Date;
          }> => [],
        ),
      prisma.brainMemory
        .findUnique({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.GHOST_PREDICTION,
              key: "current",
            },
          },
          select: { content: true, updatedAt: true },
        })
        .catch((): null => null),
      prisma.deviceCommand
        .findFirst({
          where: { status: "pending" },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            command: true,
            createdAt: true,
            device: { select: { name: true } },
          },
        })
        .catch((): null => null),
      prisma.prediction
        .count({ where: { createdAt: { gte: daysAgo(7) } } })
        .catch(() => 0),
      prisma.prediction
        .findMany({
          where: {
            createdAt: { gte: daysAgo(7) },
            status: { in: ["confirmed", "disproven"] },
          },
          select: { status: true },
        })
        .catch((): Array<{ status: string }> => []),
      prisma.brainMemory
        .count({
          where: {
            deletedAt: null,
            createdAt: { gte: daysAgo(1) },
            category: {
              in: [
                "decision",
                "belief",
                "strategy",
                "brand_marketing",
                "pattern",
                "wisdom",
                "insight",
                "preference",
                "feedback",
                "rule",
                "routine",
                "identity",
                "user_save",
              ],
            },
          },
        })
        .catch(() => 0),
      prisma.brainMemory
        .groupBy({
          by: ["category"],
          where: {
            deletedAt: null,
            createdAt: { gte: daysAgo(7) },
            category: {
              in: [
                "decision",
                "belief",
                "strategy",
                "brand_marketing",
                "pattern",
                "wisdom",
                "insight",
                "preference",
                "feedback",
                "rule",
                "routine",
                "identity",
                "user_save",
              ],
            },
          },
          _count: { _all: true },
        })
        .catch(
          (): Array<{ category: string; _count: { _all: number } }> => [],
        ),
      loadRecentContradictions(14, false).catch(
        (): Awaited<ReturnType<typeof loadRecentContradictions>> => [],
      ),
      loadRecentDrifts(7).catch(
        (): Awaited<ReturnType<typeof loadRecentDrifts>> => [],
      ),
    ]);

    // ── Build candidate list ──
    const candidates: SituationCandidate[] = [];

    // Blind spots — the strongest signal source
    for (const b of blindSpots.slice(0, 4)) {
      const sev: SituationSeverity =
        b.severity === "critical"
          ? "critical"
          : b.severity === "high"
            ? "high"
            : b.severity === "medium"
              ? "medium"
              : "low";
      candidates.push({
        source: "blind_spot",
        severity: sev,
        headline: b.description.slice(0, 80),
        body: b.evidence.slice(0, 200),
        actionLabel: b.suggestedAction.slice(0, 40),
        action: { kind: "navigate", href: "/brain" },
        domain: b.domain,
        ageDays: b.daysSinceAttention,
        dedupeTokens: [
          b.domain.toLowerCase(),
          ...b.description.toLowerCase().split(/\s+/).slice(0, 3),
        ],
      });
    }

    // Narrator — coach/watcher/analyst/adviser. Cap at 2.
    for (const n of narrations.slice(0, 2)) {
      const sev = narratorSeverityToSituation(n);
      candidates.push({
        source: "narrator",
        severity: sev,
        headline: n.title.slice(0, 80),
        body: n.body?.slice(0, 200),
        domain: n.domain,
        dedupeTokens: n.triggers.slice(0, 3),
      });
    }

    // Active bets — only surface if there's one resolving soon
    const todayMs = Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate(),
    );
    const urgentBet = activeBets.find((b) => {
      const targetMs = Date.parse(b.targetDate);
      const daysToTarget = (targetMs - todayMs) / 86400_000;
      return daysToTarget >= 0 && daysToTarget <= 3;
    });
    if (urgentBet) {
      candidates.push({
        source: "bet",
        severity: "medium",
        headline: `Nick predicted: ${urgentBet.prediction.slice(0, 60)}`,
        body: `${Math.round(urgentBet.confidence * 100)}% confidence · resolves by ${urgentBet.targetDate} · grade it to train Nick's calibration`,
        actionLabel: "grade prediction",
        action: { kind: "navigate", href: "/brain" },
        dedupeTokens: [urgentBet.category || "bet"],
      });
    }

    // Aging beliefs → still surface as secondary
    if (agingBeliefs > 0) {
      candidates.push({
        source: "calibration",
        severity: agingBeliefs >= 8 ? "medium" : "low",
        headline: `${agingBeliefs} aging belief${agingBeliefs === 1 ? "" : "s"} · auto-refresh tonight`,
        body:
          agingBeliefs >= 8
            ? "Queue is building. Auto-calibrate will re-rule them at 2:30am — override if any are urgent."
            : "Queued for overnight auto-refresh. No action needed.",
        actionLabel: "review now",
        action: { kind: "navigate", href: "/journal?tab=calibrate" },
        autoResolved: true,
        dedupeTokens: ["belief", "calibrate"],
      });
    }

    // Pin hygiene — only if stale pins beyond top-5 injection cap
    if (stalePinsCount > 0) {
      candidates.push({
        source: "pin_hygiene",
        severity: stalePinsCount >= 3 ? "medium" : "low",
        headline: `${stalePinsCount} pinned context${stalePinsCount === 1 ? "" : "s"} going stale`,
        body: `Haven't been touched in 14+ days — still current or unpin?`,
        actionLabel: "review pins",
        action: { kind: "navigate", href: "/brain#pinned-context" },
        dedupeTokens: ["pin", "context"],
      });
    }

    // Ruminations — unresolved decisions past review date
    if (openRuminations > 0) {
      candidates.push({
        source: "rumination",
        severity: openRuminations >= 5 ? "high" : "medium",
        headline: `${openRuminations} open decision${openRuminations === 1 ? "" : "s"} past review date`,
        body: "These are rotting in the inbox. Decide or archive.",
        actionLabel: "open journal",
        action: { kind: "navigate", href: "/journal?tab=decisions" },
        dedupeTokens: ["decision", "rumination"],
      });
    }

    // CONTRADICTIONS — one summary candidate
    if (unresolvedContradictions.length > 0) {
      const count = unresolvedContradictions.length;
      const top = unresolvedContradictions[0];
      const newSnip = top.new_excerpt.slice(0, 60).trim();
      const oldSnip = top.old_excerpt.slice(0, 60).trim();
      const severity: SituationSeverity =
        count >= 4 ? "high" : count >= 2 ? "medium" : "low";
      const headline =
        count === 1
          ? `contradiction · ${top.signal} flip on "${newSnip}"`
          : `${count} unresolved contradictions · self-model drifting`;
      const body =
        count === 1
          ? `${top.days_apart}d ago you said: "${oldSnip}". Reconcile or dismiss.`
          : `Freshest: "${newSnip}" conflicts with ${top.days_apart}d-old position. ${count - 1} other${count - 1 === 1 ? "" : "s"} waiting.`;
      candidates.push({
        source: "contradiction",
        severity,
        headline: headline.slice(0, 80),
        body: body.slice(0, 200),
        actionLabel: "resolve",
        action: {
          kind: "navigate",
          href: `/?resolve=${encodeURIComponent(top.key)}#contradictions`,
        },
        domain: "self_model",
        dedupeTokens: ["contradiction", "self_model", top.signal],
      });
    }

    // GHOST NICK PERSONA DRIFT — one summary candidate
    if (recentPersonaDrifts.length > 0) {
      const count = recentPersonaDrifts.length;
      const top = recentPersonaDrifts[0];
      const driftPct = Math.round(top.drift * 100);
      const severity: SituationSeverity =
        count >= 4 ? "high" : count >= 2 ? "medium" : "low";
      const headline =
        count === 1
          ? `Nick drifted ${driftPct}% from your identity spec`
          : `${count} replies drifting from your identity spec`;
      const body =
        count === 1
          ? `"${top.excerpt.slice(0, 100)}…" · the reply didn't match the 8-axis snapshot. Update your spec or dismiss.`
          : `Strongest: ${driftPct}% drift on "${top.excerpt.slice(0, 80)}…" · ${count - 1} more replies misaligned this week.`;
      candidates.push({
        source: "persona_drift",
        severity,
        headline: headline.slice(0, 80),
        body: body.slice(0, 200),
        actionLabel: "review",
        action: { kind: "navigate", href: "/brain" },
        domain: "self_model",
        dedupeTokens: ["persona_drift", "self_model", "identity"],
      });
    }

    // Ghost Nick — if a fresh prediction exists (<6h)
    if (ghostBundle?.content) {
      try {
        const bundle = JSON.parse(ghostBundle.content) as {
          predictions?: Array<{
            title: string;
            confidence: number;
            dismissed?: boolean;
          }>;
          predicted_at?: string;
        };
        const predictedAt = bundle.predicted_at
          ? new Date(bundle.predicted_at).getTime()
          : ghostBundle.updatedAt.getTime();
        const ageH = (Date.now() - predictedAt) / 3600_000;
        if (ageH < 6 && Array.isArray(bundle.predictions)) {
          const top = bundle.predictions.find((p) => !p.dismissed);
          if (top) {
            const conf = Math.round((top.confidence ?? 0) * 100);
            candidates.push({
              source: "ghost",
              severity: conf >= 70 ? "medium" : "low",
              headline: `ghost bets you'll tackle "${top.title.slice(0, 48)}" (${conf}%)`,
              body: "Shadow predictor based on your rhythm. Follow or break the pattern?",
              actionLabel: "compare to reality",
              action: { kind: "navigate", href: "/brain" },
              dedupeTokens: ["ghost", "prediction"],
            });
          }
        }
      } catch {
        // malformed ghost row — skip silently
      }
    }

    // Desktop agent health
    if (oldestPendingDeviceCmd) {
      const ageMin = Math.round(
        (Date.now() - oldestPendingDeviceCmd.createdAt.getTime()) / 60_000,
      );
      if (ageMin >= 5) {
        candidates.push({
          source: "narrator",
          severity: ageMin >= 15 ? "high" : "medium",
          headline: `desktop agent offline · ${ageMin}m pending`,
          body: `Oldest queued: "${oldestPendingDeviceCmd.command}" on ${
            oldestPendingDeviceCmd.device?.name || "unknown device"
          }. Start the poller on the desktop or commands will time out.`,
          actionLabel: "open devices",
          action: { kind: "navigate", href: "/system/devices" },
          dedupeTokens: ["agent", "device"],
          domain: "systems",
        });
      }
    }

    // Forecasting digest — diagnostic, reads the calibration summary
    const made7d = predMade7d;
    const resolved7d = predResolved7d.length;
    const confirmed7d = predResolved7d.filter(
      (p) => p.status === "confirmed",
    ).length;
    const disproven7d = predResolved7d.filter(
      (p) => p.status === "disproven",
    ).length;
    const calibration = await summarizeCalibration({ days: 7 }).catch(
      (): Awaited<ReturnType<typeof summarizeCalibration>> => ({
        resolved: 0,
        confirmed: 0,
        hitRate: null,
        meanBrier: null,
        verdict: "unknown",
        avgClaimVsRealityGap: null,
      }),
    );

    if (made7d >= 1 || resolved7d >= 1) {
      const severity: SituationSeverity =
        calibration.verdict === "drift"
          ? "high"
          : calibration.verdict === "well-calibrated"
            ? "win"
            : "low";

      let headline: string;
      let body: string;
      if (calibration.verdict === "drift" && calibration.hitRate !== null) {
        const claimedPct = Math.round(
          ((calibration.hitRate ?? 0) +
            (calibration.avgClaimVsRealityGap ?? 0)) *
            100,
        );
        const actualPct = Math.round(calibration.hitRate * 100);
        headline = `calibration drift · Nick says ${claimedPct}%, only ${actualPct}% land`;
        body = `${calibration.resolved} resolved this week · mean Brier ${(calibration.meanBrier ?? 0).toFixed(3)} · gap >15pts means his confidence is overstated. Re-rule the strongest beliefs.`;
      } else if (calibration.verdict === "well-calibrated") {
        const pct = Math.round((calibration.hitRate ?? 0) * 100);
        headline = `calibration tight · ${pct}% land at ${pct}% confidence`;
        body = `${calibration.resolved} resolved this week · mean Brier ${(calibration.meanBrier ?? 0).toFixed(3)} (lower is better). Trust Nick's confidence more.`;
      } else {
        const hitFragment =
          resolved7d >= 2
            ? ` · ${Math.round((confirmed7d / resolved7d) * 100)}% hit`
            : " · not enough resolved yet";
        headline = `${made7d} prediction${made7d === 1 ? "" : "s"} this week · ${resolved7d} resolved${hitFragment}`;
        body =
          resolved7d === 0
            ? "Nothing's hit its target window yet. Check back as the deadlines roll through."
            : `${confirmed7d} confirmed · ${disproven7d} disproven · need ≥4 resolved to read calibration drift.`;
      }

      candidates.push({
        source: "forecast",
        severity,
        headline,
        body,
        actionLabel: "open predictions",
        action: { kind: "navigate", href: "/brain" },
        dedupeTokens: ["forecast", "prediction", "calibration"],
      });
    }

    // Brain-growth pulse
    type CategoryCount = { category: string; _count: { _all: number } };
    const memCats = brainMem7dByCategory as unknown as CategoryCount[];
    const mem7dTotal = memCats.reduce(
      (sum, row) => sum + (row._count?._all ?? 0),
      0,
    );
    const topCats = [...memCats]
      .sort((a, b) => (b._count?._all ?? 0) - (a._count?._all ?? 0))
      .slice(0, 3);
    if (brainMem24h > 0 || mem7dTotal > 0) {
      const breakdown = topCats
        .map((c) => `${c._count._all} ${c.category}`)
        .join(" · ");
      candidates.push({
        source: "brain_growth",
        severity: "win",
        headline:
          brainMem24h > 0
            ? `${brainMem24h} memor${brainMem24h === 1 ? "y" : "ies"} learned today · ${mem7dTotal} this week`
            : `${mem7dTotal} memor${mem7dTotal === 1 ? "y" : "ies"} this week · learning loop alive`,
        body: breakdown
          ? `Top categories: ${breakdown}`
          : "The learning loop is moving.",
        actionLabel: "open brain",
        action: { kind: "navigate", href: "/brain" },
        dedupeTokens: ["brain", "growth", "memories"],
      });
    } else if (mem7dTotal === 0) {
      candidates.push({
        source: "brain_growth",
        severity: "low",
        headline: "learning loop quiet · 0 memories in 7 days",
        body: "Nothing's been ingested. Use /save in chat or hit the brain page to add what mattered this week.",
        actionLabel: "open brain",
        action: { kind: "navigate", href: "/brain" },
        dedupeTokens: ["brain", "growth", "memories"],
      });
    }

    // Momentum — a positive candidate so we're not always doom
    if (reflectionsToday > 0 && blindSpots.length === 0) {
      candidates.push({
        source: "momentum",
        severity: "win",
        headline: `${reflectionsToday} reflection${reflectionsToday === 1 ? "" : "s"} logged today · nothing breaking`,
        body: "Clean state. Use the space.",
        actionLabel: "write another",
        action: { kind: "navigate", href: "/journal" },
        dedupeTokens: ["momentum", "reflection"],
      });
    }

    // ── Auto-resolved notes (cron output) ──
    const autoResolved: SituationCandidate[] = [];
    for (const row of autoResolvedRows) {
      autoResolved.push({
        source:
          row.category === "belief_refresh_report"
            ? "calibration"
            : "pin_hygiene",
        severity: "low",
        headline:
          row.category === "belief_refresh_report"
            ? `overnight: ${row.content.slice(0, 60)}`
            : row.content.slice(0, 80),
        body: row.content.slice(0, 200),
        autoResolved: true,
        actionLabel:
          row.category === "belief_refresh_report"
            ? "review changes"
            : "open pins",
        action: {
          kind: "navigate",
          href:
            row.category === "belief_refresh_report"
              ? "/brain"
              : "/brain#pinned-context",
        },
      });
    }

    // ── Ambient rate data ──
    const confirmed = predResolved30d.filter(
      (p) => p.status === "confirmed",
    ).length;
    const disproven = predResolved30d.filter(
      (p) => p.status === "disproven",
    ).length;
    const resolved = confirmed + disproven;
    const betHitRatePct =
      resolved >= 3 ? Math.round((confirmed / resolved) * 100) : null;

    const pinInjectedOfCap = { injected: Math.min(pinnedCount, 5), cap: 5 };
    void pinStats; // ambient pin list reserved for future use · matches legacy

    // ── Synthesize ──
    const synth = synthesizeSituation({
      candidates,
      autoResolved,
      counts: {
        blindSpots: blindSpots.length,
        activeBets: activeBets.length,
        agingBeliefs,
        stalePins: stalePinsCount,
        openRuminations,
        reflectionsToday,
      },
      ambientRates: {
        betHitRatePct,
        predictionsPendingResolve: activeBets.length,
        pinInjectedOfCap,
      },
    });

    return synth;
  });
}
