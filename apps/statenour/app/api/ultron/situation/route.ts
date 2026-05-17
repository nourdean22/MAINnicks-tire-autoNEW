import { NextResponse } from "next/server";
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
// v10.0.529.31 · Arc B Phase 4 · contradictions as a ranked source
// in the unified situation narrative. Pulls the same data the
// ContradictionsCard + BottomPulseTicker + TodayPulseStrip chip
// consume · meta-aggregation completes the 4-surface composition
// (card · chip · ticker · situation) for contradictions.
import { loadRecentContradictions } from "@/lib/brain/contradiction-surfacer";
// v10.0.529.32 · Arc B Feature 4 · Ghost Nick persona-drift events
// surfaced as a ranked source. Same urgency tier as contradiction.
import { loadRecentDrifts } from "@/lib/brain/persona-drift-detector";

/**
 * GET /api/ultron/situation
 *
 * THE unified signal endpoint. Replaces the 7-card stack on HQ with
 * a single synthesized narrative. Nour asked to kill the redundant
 * cards + auto-run maintenance + weave smart projections + purify
 * the paths — this is the new single surface.
 *
 * This endpoint is a META-aggregator. Under the hood it composes:
 *   • blind-spot-detector (lib/brain/blind-spot-detector)
 *   • narrator voices (watcher/coach/analyst/adviser)
 *   • prediction bets + calibration
 *   • aging-belief pool (what would have needed Calibrate Memory START)
 *   • pin hygiene (stale pins beyond the top-5 injection cap)
 *   • rumination queue (unresolved decisions past review date)
 *   • auto-resolved notes (cron outputs: belief_refresh_report etc)
 *
 * Cached 120s — each source is heavy, and the HQ polls this
 * every 5min via useUltronFetch, so caching is critical.
 */

export const revalidate = 120;

function narratorSeverityToSituation(n: Narration): SituationSeverity {
  if (n.severity === "warn") return "high";
  if (n.severity === "win") return "win";
  return "medium";
}

export async function GET() {
  try {
    const payload = await cached<SituationPayload>("ultron_situation_v1", 120, async () => {
      const now = Date.now();
      const todayISO = new Date().toISOString().slice(0, 10);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      // Pull all sources in parallel. Each is fault-tolerant — a single
      // failure shouldn't collapse the whole payload.
      //
      // May 02 · v10.0.147 · Added two ambient sources:
      //   · predMade7d / predResolved7d → forecasting digest candidate
      //   · brainMem24h / brainMem7d   → brain-growth pulse candidate
      // Both run in the same Promise.all so they cost nothing extra.
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
        // v10.0.529.31 · Arc B Phase 4 · 14-day window of unresolved
        // contradictions for the new "contradiction" candidate source.
        // Matches the ContradictionsCard's lookback window so a
        // contradiction surfaced in the dedicated card also flows
        // into the unified narrative.
        unresolvedContradictions,
        // v10.0.529.32 · Arc B F4 · last 7d of Ghost Nick persona-drift
        // events. Detected by the persona-drift cron · sorted by
        // confidence desc · we take the top for the headline + count
        // the rest.
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
          .catch((): Array<{
            id: string;
            prediction: string;
            category: string | null;
            confidence: number;
            targetDate: string;
            createdAt: Date;
          }> => []),
        prisma.prediction
          .findMany({
            where: { createdAt: { gte: daysAgo(30) } },
            select: { status: true },
          })
          .catch((): Array<{ status: string }> => []),
        // Aging-belief pool — same query the Calibrate Memory card used.
        // Surface count only here; the "re-rule" path moves into the
        // nightly auto-calibrate cron so this becomes a FYI, not a
        // manual STARTable ritual.
        prisma.brainMemory
          .count({
            where: {
              category: {
                in: ["pattern", "insight", "preference", "feedback", "wisdom", "rule", "routine", "identity"],
              },
              confidence: { gte: 0.6 },
              createdAt: { lte: daysAgo(30) },
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          })
          .catch(() => 0),
        // Pin stats for ambient + headline
        prisma.brainMemory
          .findMany({
            where: { category: "pinned_user" },
            orderBy: { updatedAt: "desc" },
            select: { id: true, updatedAt: true },
          })
          .catch((): Array<{ id: string; updatedAt: Date }> => []),
        prisma.brainMemory.count({ where: { category: "pinned_user" } }).catch(() => 0),
        prisma.brainMemory
          .count({
            where: {
              category: "pinned_user",
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
            where: { createdAt: { gte: startOfToday } },
          })
          .catch(() => 0),
        // Cron-produced auto-resolved reports (belief refresh, pin hygiene)
        prisma.brainMemory
          .findMany({
            where: {
              category: { in: ["belief_refresh_report", "nudge_pin_hygiene"] },
              updatedAt: { gte: daysAgo(1) },
            },
            orderBy: { updatedAt: "desc" },
            take: 3,
            select: { category: true, content: true, metadata: true, updatedAt: true },
          })
          .catch((): Array<{
            category: string;
            content: string;
            metadata: unknown;
            updatedAt: Date;
          }> => []),
        // Ghost Nick prediction — folded in Apr 20. Previously rendered
        // as its own GhostNickStrip below the Situation card; same
        // information fits as a candidate with ghost source weighting.
        prisma.brainMemory
          .findUnique({
            where: {
              category_key: { category: "ghost_prediction", key: "current" },
            },
            select: { content: true, updatedAt: true },
          })
          .catch((): null => null),
        // Apr 20 · Agent health — oldest pending DeviceCommand. If
        // the desktop agent hasn't claimed a command for 5+ min,
        // something is off (agent crashed / desktop asleep / sync-
        // key rotated). Surface as a candidate so Nour knows before
        // trying to "lock the front door" via chat and having it
        // pile up silently.
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
        // May 02 · v10.0.147 · Forecasting digest data — Nick's
        // weekly prediction throughput. predMade7d is the count of
        // predictions Nick made in the last 7d (via /api/brain/predict
        // or chat-side suggestPrediction tool). predResolved7d is
        // every prediction resolved within the same window so we can
        // compute a hit-rate that's distinct from the 30d average.
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
        // May 02 · v10.0.147 · Brain-growth pulse — memories added
        // in the last 24h tells Nour the learning loop is alive.
        // Count is filtered to the user-meaningful categories
        // (skip raw chat fragments, cron auto-reports etc that would
        // inflate the number without representing real learning).
        prisma.brainMemory
          .count({
            where: {
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
        // 7d count grouped by category — used in the body line so
        // Nour sees WHAT kind of learning happened (e.g. "12 added · 5
        // beliefs · 3 strategies · 2 patterns").
        prisma.brainMemory
          .groupBy({
            by: ["category"],
            where: {
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
          .catch((): Array<{ category: string; _count: { _all: number } }> => []),
        // v10.0.529.31 · Arc B Phase 4 · pull unresolved contradictions
        // from the last 14d. Sorted desc by createdAt by the surfacer
        // helper · we use the freshest one for the candidate headline
        // and count the rest. catch returns [] so a corrupt brain-memory
        // row never breaks the situation card.
        loadRecentContradictions(14, false).catch(
          (): Awaited<ReturnType<typeof loadRecentContradictions>> => [],
        ),
        // v10.0.529.32 · Arc B Feature 4 · pull recent persona-drift
        // events (last 7d). Sorted by confidence desc by the detector
        // helper · top events are the strongest drifts.
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
          // v11 clarity fix · /strategy was retired in v10 (folded into /);
          // blind spots live on /brain via the brain-maturity panel
          action: { kind: "navigate", href: "/brain" },
          domain: b.domain,
          ageDays: b.daysSinceAttention,
          dedupeTokens: [b.domain.toLowerCase(), ...b.description.toLowerCase().split(/\s+/).slice(0, 3)],
        });
      }

      // Narrator — coach/watcher/analyst/adviser. Cap at 2 so they
      // don't swamp.
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
          // v11 clarity fix — previously just said "bet resolves soon" with
          // no context about WHO made the bet (Nick, not Nour) or WHY it
          // matters (calibration). New copy makes the ask explicit: 30s
          // to grade Nick's prediction, which trains his future confidence.
          headline: `Nick predicted: ${urgentBet.prediction.slice(0, 60)}`,
          body: `${Math.round(urgentBet.confidence * 100)}% confidence · resolves by ${urgentBet.targetDate} · grade it to train Nick's calibration`,
          actionLabel: "grade prediction",
          action: { kind: "navigate", href: "/brain" },
          dedupeTokens: [urgentBet.category || "bet"],
        });
      }

      // Aging beliefs → still surface as secondary, but frame as
      // "auto will handle overnight" instead of manual START.
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

      // v10.0.529.31 · Arc B Phase 4 · CONTRADICTIONS
      // One summary candidate per fetch · the top contradiction by
      // surface order (freshest) leads the headline + body. Severity
      // scales with count: 1 → low (FYI), 2-3 → medium (worth a beat),
      // 4+ → high (drift accumulating). The dedicated ContradictionsCard
      // is the focused-resolution surface · this entry is the unified-
      // narrative entry · they're complementary, not redundant
      // (dedupeTokens use "self_model" + the signal type so a
      // narrator observation about the same shift collapses into
      // this higher-ranked candidate).
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
          // Deep-links to the ContradictionsCard's anchor on the home
          // route. Pre-loads the top contradiction's resolution form
          // via the same ?resolve=<key> path the BottomPulseTicker uses.
          action: {
            kind: "navigate",
            href: `/?resolve=${encodeURIComponent(top.key)}#contradictions`,
          },
          domain: "self_model",
          dedupeTokens: [
            "contradiction",
            "self_model",
            top.signal,
          ],
        });
      }

      // v10.0.529.32 · Arc B F4 · GHOST NICK PERSONA DRIFT
      // Persona drift events from the last 7d · the persona-drift cron
      // logs assistant replies that fell below 0.6 cosine similarity
      // against the operator's 8-axis identity_snapshot. One summary
      // candidate · top event by drift magnitude leads the headline.
      // Severity scales with COUNT (not just magnitude) so a single
      // drift is a low-signal FYI while a pattern of drift is a
      // medium/high event worth Nick reading.
      if (recentPersonaDrifts.length > 0) {
        const count = recentPersonaDrifts.length;
        const top = recentPersonaDrifts[0]; // sorted by confidence/drift desc
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
          // /brain hosts the identity-snapshot surface · the operator
          // can update axes there. Future dedicated drift-review card
          // can replace this with a deeper anchor.
          action: { kind: "navigate", href: "/brain" },
          domain: "self_model",
          dedupeTokens: [
            "persona_drift",
            "self_model",
            "identity",
          ],
        });
      }

      // Ghost Nick — if a fresh prediction exists (<6h), surface it
      // as a cross-signal candidate. Weight as medium when confidence
      // is high (>=0.7) + not dismissed, otherwise low.
      if (ghostBundle?.content) {
        try {
          const bundle = JSON.parse(ghostBundle.content) as {
            predictions?: Array<{ title: string; confidence: number; dismissed?: boolean }>;
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

      // Apr 20 · Desktop agent health — if a command has been
      // pending for 5+ min with no one claiming it, the agent
      // is likely offline. Surface so Nour doesn't keep sending
      // commands into the void.
      if (oldestPendingDeviceCmd) {
        const ageMin = Math.round(
          (Date.now() - oldestPendingDeviceCmd.createdAt.getTime()) / 60_000
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

      // May 03 · v10.0.150 · Forecasting digest — now diagnostic, not
      // throughput-only. Reads the calibration summary so the candidate
      // tells the operator whether Nick's confidence is actually
      // calibrated rather than just "12 predictions made." Falls back
      // to the v10.0.147 throughput message when there's not enough
      // resolved data to compute calibration.
      const made7d = predMade7d;
      const resolved7d = predResolved7d.length;
      const confirmed7d = predResolved7d.filter((p) => p.status === "confirmed").length;
      const disproven7d = predResolved7d.filter((p) => p.status === "disproven").length;
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
        // Severity ladder — promote when calibration verdict says
        // drift (4+ resolved + >15-pt gap between claim and reality)
        // since that's the diagnostic worth reading. "well-calibrated"
        // is a quiet win. Throughput-only fallback stays at "low."
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
            ((calibration.hitRate ?? 0) + (calibration.avgClaimVsRealityGap ?? 0)) * 100,
          );
          const actualPct = Math.round(calibration.hitRate * 100);
          headline = `calibration drift · Nick says ${claimedPct}%, only ${actualPct}% land`;
          body = `${calibration.resolved} resolved this week · mean Brier ${(calibration.meanBrier ?? 0).toFixed(3)} · gap >15pts means his confidence is overstated. Re-rule the strongest beliefs.`;
        } else if (calibration.verdict === "well-calibrated") {
          const pct = Math.round((calibration.hitRate ?? 0) * 100);
          headline = `calibration tight · ${pct}% land at ${pct}% confidence`;
          body = `${calibration.resolved} resolved this week · mean Brier ${(calibration.meanBrier ?? 0).toFixed(3)} (lower is better). Trust Nick's confidence more.`;
        } else {
          // Fallback: not enough resolved to read calibration, use v10.0.147 throughput message.
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

      // May 02 · v10.0.147 · Brain-growth pulse — surfaces when
      // memories got added in the last 24h. Silence is signal too:
      // when both 24h and 7d are zero, we surface a low-severity
      // "learning loop quiet" so Nour knows nothing's flowing in.
      // Otherwise it's a "win" candidate with the category breakdown.
      // Coerce the prisma groupBy result into the shape we actually
      // use — the inferred Prisma type has a deeper $count signature
      // that fights the simple reduce. Local alias keeps the math
      // type-clean without losing accuracy.
      type CategoryCount = { category: string; _count: { _all: number } };
      const memCats = brainMem7dByCategory as unknown as CategoryCount[];
      const mem7dTotal = memCats.reduce(
        (sum, row) => sum + (row._count?._all ?? 0),
        0,
      );
      // Top 3 categories by count for the body breakdown.
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
        // Quiet week — flag it so Nour knows the loop is dormant.
        // Low severity so it doesn't drown louder signals; this is
        // an FYI, not an alarm.
        candidates.push({
          source: "brain_growth",
          severity: "low",
          headline: "learning loop quiet · 0 memories in 7 days",
          body:
            "Nothing's been ingested. Use /save in chat or hit the brain page to add what mattered this week.",
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
          source: row.category === "belief_refresh_report" ? "calibration" : "pin_hygiene",
          severity: "low",
          headline:
            row.category === "belief_refresh_report"
              ? `overnight: ${row.content.slice(0, 60)}`
              : row.content.slice(0, 80),
          body: row.content.slice(0, 200),
          autoResolved: true,
          actionLabel: row.category === "belief_refresh_report" ? "review changes" : "open pins",
          action: {
            kind: "navigate",
            href: row.category === "belief_refresh_report" ? "/brain" : "/brain#pinned-context",
          },
        });
      }

      // ── Ambient rate data ──
      const confirmed = predResolved30d.filter((p) => p.status === "confirmed").length;
      const disproven = predResolved30d.filter((p) => p.status === "disproven").length;
      const resolved = confirmed + disproven;
      const betHitRatePct = resolved >= 3 ? Math.round((confirmed / resolved) * 100) : null;

      const pinInjectedOfCap = { injected: Math.min(pinnedCount, 5), cap: 5 };

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

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "situation build failed",
        code: "SITUATION_BUILD_FAILED",
        data: {
          primary: null,
          secondaries: [],
          autoResolved: [],
          monitors: [],
          counts: {
            blindSpots: 0,
            activeBets: 0,
            agingBeliefs: 0,
            stalePins: 0,
            openRuminations: 0,
            reflectionsToday: 0,
          },
          noiseReduced: 0,
          generatedAt: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
