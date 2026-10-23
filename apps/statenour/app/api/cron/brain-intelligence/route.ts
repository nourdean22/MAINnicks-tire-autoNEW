/**
 * GET /api/cron/brain-intelligence
 *
 * Runs the v7.0 self-improving intelligence engines:
 * 1. Score pending predictions (outcome tracking)
 * 2. Distill wisdom from recurring patterns
 * 3. Detect blind spots (stored for system prompt)
 * 4. Generate learning journal entry
 * 5. Find hidden correlations
 *
 * Runs as part of the evening mega cron.
 */

import { cronHandler } from "@/lib/utils/http";
import { scorePendingPredictions } from "@/lib/brain/outcome-tracker";
import { logger as rootLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const log = rootLogger.withSurface("cron/brain-intelligence");
import { distillWisdom } from "@/lib/brain/wisdom-distiller";
import { generateLearningJournal } from "@/lib/brain/learning-journal";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";
import { findCorrelations } from "@/lib/brain/correlation-finder";
import { persistBlindSpot } from "@/lib/brain/blind-spot-identity";
import type { ExtractedPrediction } from "@/lib/ai/outcome-calibration";
export const maxDuration = 120; // Pro plan

/** Days after a clicks window ends before GSC's numbers are read as final. */
const GSC_LAG_DAYS = 3;

export const GET = cronHandler(async () => {
  const results: Record<string, unknown> = {};

  // 1. Score predictions
  try {
    const scored = await scorePendingPredictions();
    results.predictions = {
      scored: scored.length,
      confirmed: scored.filter((s) => s.accurate).length,
      disproven: scored.filter((s) => !s.accurate).length,
    };
  } catch (err) {
    results.predictions = { error: err instanceof Error ? err.message : "failed" };
  }

  // 1b. Resolve pending GSC clicks or shop revenue assistant predictions
  try {
    const unresolved = await prisma.brainMemory.findMany({
      where: {
        category: "prediction",
        deletedAt: null,
        createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        // Resolved rows never leave the table, so without this the oldest 100 are all resolved and nothing pending is reached.
        metadata: { path: ["resolved"], equals: false },
      },
      // forensic-audit MEDIUM · was take:20 with no orderBy, so once ~20
      // already-resolved rows existed the window filled with them and pending
      // predictions starved forever. Process OLDEST-first and widen the window
      // so genuinely-pending rows are reached; the stale-expiry below stops
      // resolved rows from re-accumulating in the pending pool.
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    const pending = unresolved.filter((p) => {
      const meta = p.metadata as any;
      return meta && meta.resolved === false;
    });

    let resolvedAssistantCount = 0;
    if (pending.length > 0) {
      const { queryNick } = await import("@/lib/nickstire/query");
      const { resolvePrediction, shiftDate } = await import("@/lib/ai/outcome-calibration");
      const { today } = await import("@/lib/utils/datetime");
      const todayET = today();

      for (const p of pending) {
        const meta = p.metadata as any;

        // Measured predictions carry their own metric and ET window: read exactly that, once it is over.
        // shortcut: a row with two windowed predictions resolves only the first; split rows if that ever matters.
        const windowed = (meta?.predictions as ExtractedPrediction[] | undefined)?.find(
          (x) => (x.metric === "clicks" || x.metric === "revenue") && x.window,
        );
        if (windowed?.window) {
          const isClicks = windowed.metric === "clicks";
          // GSC finalizes a day ~2-3 days late; reading sooner would undercount.
          const settledAfter = shiftDate(windowed.window.to, isClicks ? GSC_LAG_DAYS : 0);
          if (todayET <= settledAfter) continue;
          const range = { from: windowed.window.from, to: windowed.window.to };
          const res = await queryNick<any>(isClicks ? "gsc_summary" : "revenue_range", range);
          const data = "data" in res ? res.data : null;
          // A failed or partial read is UNKNOWN: never scored as 0.
          const actual = !data
            ? null
            : isClicks
              ? data.source === "gsc_official_no_dimension" && typeof data.totalClicks === "number" ? data.totalClicks : null
              : typeof data.totalDollars === "number" ? data.totalDollars : null;
          if (actual === null) {
            if (todayET > shiftDate(settledAfter, 7)) {
              await prisma.brainMemory.update({
                where: { id: p.id },
                data: { metadata: { ...(meta ?? {}), resolved: true, resolvedOutcome: "expired_unverifiable" } as any },
              });
            }
            continue;
          }
          const result = await resolvePrediction({
            captionText: meta?.captionPreview || p.content || "",
            actualScore: actual,
            metric: windowed.metric as "clicks" | "revenue",
            predictionId: p.id,
          });
          if (result.resolved) resolvedAssistantCount++;
          continue;
        }

        // shortcut: rows without a stored window (pre 2026-10-11) keep the word guess + creation-day read; delete once none are pending.
        const text = (meta?.captionPreview || p.content || "").toLowerCase();
        const dateStr = new Date(p.createdAt).toISOString().split("T")[0];

        let actualScore: number | null = null;
        let metric: "clicks" | "revenue" = "clicks";
        if (text.includes("click") || text.includes("gsc") || text.includes("search")) {
          const res = await queryNick<any>("gsc_summary", { from: dateStr, to: dateStr });
          if (res) {
            const data = (res as any).data || res;
            actualScore = typeof data.totalClicks === "number" ? data.totalClicks : null;
          }
        } else if (text.includes("revenue") || text.includes("sales") || text.includes("dollar")) {
          metric = "revenue";
          const res = await queryNick<any>("revenue_range", { from: dateStr, to: dateStr });
          if (res) {
            const data = (res as any).data || res;
            actualScore = typeof data.totalDollars === "number" ? data.totalDollars : null;
          }
        }

        // forensic-audit MEDIUM · DO NOT fabricate an outcome. The old code set
        // actualScore = engagementPred × random(0.7-1.2) and fed it to
        // resolvePrediction, poisoning the calibration stats (meanErrorPct,
        // within20PctRate) that get injected into system prompts with invented
        // numbers. For a stale prediction with no fetchable real actual, mark it
        // expired so it leaves the pending pool WITHOUT corrupting calibration.
        const ageMs = Date.now() - new Date(p.createdAt).getTime();
        const isStale = ageMs > 7 * 24 * 60 * 60 * 1000;
        if (actualScore === null && isStale) {
          await prisma.brainMemory.update({
            where: { id: p.id },
            data: { metadata: { ...(meta ?? {}), resolved: true, resolvedOutcome: "expired_unverifiable" } as any },
          });
          continue;
        }

        if (actualScore !== null) {
          const captionText = meta?.captionPreview || p.content || "";
          const result = await resolvePrediction({ captionText, actualScore, metric });
          if (result.resolved) {
            resolvedAssistantCount++;
          }
        }
      }
    }
    results.assistantPredictions = { resolved: resolvedAssistantCount };
  } catch (err) {
    results.assistantPredictions = { error: err instanceof Error ? err.message : "failed" };
  }

  // 2. Wisdom distillation
  try {
    const wisdom = await distillWisdom();
    results.wisdom = { distilled: wisdom.length, principles: wisdom };
  } catch (err) {
    results.wisdom = { error: err instanceof Error ? err.message : "failed" };
  }

  // 3. Blind spot detection (store top spots as memories for prompt)
  try {
    const spots = await detectBlindSpots();
    // v10.0.34 — count actual persisted writes. Pre-fix the
    // .catch(() => {}) ate every write failure silently, so the
    // cron returned `{ detected: N }` looking healthy even when
    // zero spots had landed. Now: track persisted vs failed and
    // surface both in the cron-run summary.
    // 2026-08-22 — the key used to be `blindspot_${domain}_${Date.now()}`.
    // remember() upserts on (category, key), so a clock in the key meant every
    // run minted a NEW row and the operator's verdict had nothing to attach
    // to: measured on prod, 3 of 3 verdicts given on 08-21 were regenerated as
    // unjudged within 24h. persistBlindSpot() keys on the spot's identity and
    // owns the recurrence policy — see lib/brain/blind-spot-identity.ts.
    let createdSpots = 0;
    let reinforcedSpots = 0;
    let resurfacedSpots = 0;
    let revivedSpots = 0;
    let noopSpots = 0;
    let failedSpots = 0;
    for (const spot of spots.slice(0, 3)) {
      try {
        const res = await persistBlindSpot(spot);
        if (res.action === "created") createdSpots++;
        else reinforcedSpots++;
        if (res.resurfaced) resurfacedSpots++;
        if (res.revived) revivedSpots++;
        if (res.noop) noopSpots++;
      } catch (err) {
        failedSpots++;
        log.warn("blindspot_write_failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    results.blindSpots = {
      detected: spots.length,
      // `persisted` kept for continuity with the existing cron-run summary;
      // created/reinforced is the pair that actually distinguishes a healthy
      // steady state (mostly reinforced) from key churn (mostly created).
      persisted: createdSpots + reinforcedSpots,
      created: createdSpots,
      reinforced: reinforcedSpots,
      resurfaced: resurfacedSpots,
      // A steady state is mostly `reinforced` with revived/noop at zero.
      // `revived` above zero means the TTL sweep is reaching these rows before
      // the next run; `noop` above zero means the commit gateway is refusing
      // the write and the reconciling update is the only thing keeping the row
      // current. Both are silent today, which is why they are counted.
      revived: revivedSpots,
      noop: noopSpots,
      failed: failedSpots,
      critical: spots.filter((s) => s.severity === "critical").length,
    };
  } catch (err) {
    results.blindSpots = { error: err instanceof Error ? err.message : "failed" };
  }

  // 4. Learning journal
  try {
    const journal = await generateLearningJournal();
    results.journal = { date: journal.date, selfAssessment: journal.selfAssessment.slice(0, 200) };
  } catch (err) {
    results.journal = { error: err instanceof Error ? err.message : "failed" };
  }

  // 5. Hidden correlations
  try {
    const corrs = await findCorrelations();
    const surprising = corrs.filter((c) => c.surprising);
    results.correlations = { found: corrs.length, surprising: surprising.length };
  } catch (err) {
    results.correlations = { error: err instanceof Error ? err.message : "failed" };
  }

  return results;
});
