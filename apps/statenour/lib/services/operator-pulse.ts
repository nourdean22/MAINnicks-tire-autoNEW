/**
 * lib/services/operator-pulse.ts · Phase E (2026-05-18 PM)
 *
 * The "OperatorPulse" composer · the forward-looking intelligence
 * layer that the four mastery surfaces (/tasks · /goals · /scoreboard
 * · / home) share. Each surface gets a surface-aware composition of
 * the same three primitives:
 *
 *   1. PULSE · 1-sentence "right now · the move is X because Y" line
 *      (action-forward · always points somewhere · self-hides if nothing
 *      moves the needle)
 *   2. FORECAST · 1-line 7d projection ("at current pace · {what
 *      happens by Friday}") · the missing forward-look on the
 *      backward-looking surfaces
 *   3. DRIFT · optional ONE warning per session · surfaces silent
 *      decay (stale promises · trailing axes · zero-activity goals).
 *
 * Composition philosophy:
 *   · NO AI calls in the read path · pure heuristics + Prisma reads
 *     (sub-300ms target)
 *   · Reuses existing snapshots (buildGoalsSnapshot · buildMetaScoreboard)
 *     so we never duplicate the heavy queries
 *   · Surface-aware framing · the same underlying data tells a
 *     different story on /tasks vs /goals vs /scoreboard
 *   · Self-hides when nothing has signal · pages stay calm
 *
 * Why this exists (per brainstorm 2026-05-18 PM):
 *   The 3 mastery surfaces were beautifully editorial but
 *   purely backward-looking · no "where am I heading" · no
 *   "what's the next move" · no "what's silently rotting".
 *   This composer adds intelligence without redesigning the
 *   surfaces · ONE primitive, mounted four times.
 *
 * See: ADR-0016 (Operator Pulse · pending) · /api/operator/pulse
 */

import { prisma } from "@/lib/prisma";
import { buildGoalsSnapshot, type AxisScore, type GoalRow } from "./goals-snapshot";
import { buildMetaScoreboard, type ScoreboardNumber } from "./meta-scoreboard";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/operator-pulse");

export type PulseSurface = "tasks" | "goals" | "scoreboard" | "home";

export interface PulseLine {
  /** 1-sentence action-forward narration */
  text: string;
  /** Where the operator goes when they tap the line */
  href: string | null;
  /** Visual hint · drives the color of the leading dot */
  tone: "gold" | "amber" | "emerald" | "neutral";
}

export interface OperatorPulseSnapshot {
  surface: PulseSurface;
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  composedAt: string;
}

// ── Helper · the trailing axis (worst score with negative delta) ────

function findTrailingAxis(axes: AxisScore[]): AxisScore | null {
  const candidates = axes.filter((a) => a.delta7d <= 0);
  if (candidates.length === 0) return null;
  // Sort by composite badness · low score AND falling delta both count
  const ranked = [...candidates].sort((a, b) => {
    const aBad = (10 - a.score) + Math.abs(a.delta7d) * 2;
    const bBad = (10 - b.score) + Math.abs(b.delta7d) * 2;
    return bBad - aBad;
  });
  return ranked[0] ?? null;
}

function flattenGoals(snap: Awaited<ReturnType<typeof buildGoalsSnapshot>>): GoalRow[] {
  const all: GoalRow[] = [];
  for (const h of ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "LIFE", "UNSCOPED"] as const) {
    const bucket = snap.ladder[h];
    if (bucket?.length) all.push(...bucket);
  }
  return all;
}

// ── Surface composers ───────────────────────────────────────────────

interface ComposerInput {
  goals: Awaited<ReturnType<typeof buildGoalsSnapshot>>;
  scoreboard: Awaited<ReturnType<typeof buildMetaScoreboard>>;
  doneToday: number;
  avg7dDone: number;
  topOpenTask: {
    id: string;
    title: string;
    roiScore: number;
    goalId: string | null;
    promiseTo: string | null;
    loopKind: string | null;
  } | null;
  stalePromise: {
    id: string;
    title: string;
    promiseTo: string | null;
    daysSinceUpdate: number;
  } | null;
}

function composeForTasks(i: ComposerInput): OperatorPulseSnapshot["pulse"] extends infer _ ? Pick<OperatorPulseSnapshot, "pulse" | "forecast" | "drift"> : never {
  // Pulse · highest-leverage open task
  let pulse: PulseLine | null = null;
  if (i.topOpenTask) {
    const t = i.topOpenTask;
    const goalSuffix = t.goalId ? " · lifts a goal" : "";
    const promiseSuffix = t.promiseTo ? ` · promise to ${t.promiseTo}` : "";
    pulse = {
      text: `Right now · do "${t.title.slice(0, 52)}${t.title.length > 52 ? "…" : ""}" · roi ${t.roiScore}${goalSuffix}${promiseSuffix}`,
      href: `/tasks#task-row-${t.id}`,
      tone: t.roiScore >= 80 ? "gold" : "neutral",
    };
  }

  // Forecast · today's done vs 7d avg
  let forecast: PulseLine | null = null;
  if (i.avg7dDone > 0 || i.doneToday > 0) {
    const diff = i.doneToday - i.avg7dDone;
    const sign = diff > 0 ? "ahead" : diff < 0 ? "behind" : "on";
    const tone: PulseLine["tone"] = diff > 1 ? "emerald" : diff < -1 ? "amber" : "neutral";
    forecast = {
      text: `Pace · ${i.doneToday} done today · 7d avg ${i.avg7dDone.toFixed(1)} · ${sign} pace`,
      href: null,
      tone,
    };
  }

  // Drift · stalest PROMISE
  const drift: PulseLine | null = i.stalePromise
    ? {
        text: `Promise · "${i.stalePromise.title.slice(0, 40)}${i.stalePromise.title.length > 40 ? "…" : ""}" · ${i.stalePromise.daysSinceUpdate}d quiet${i.stalePromise.promiseTo ? ` (to ${i.stalePromise.promiseTo})` : ""}`,
        href: `/tasks#task-row-${i.stalePromise.id}`,
        tone: "amber",
      }
    : null;

  return { pulse, forecast, drift };
}

function composeForGoals(i: ComposerInput): Pick<OperatorPulseSnapshot, "pulse" | "forecast" | "drift"> {
  const trailing = findTrailingAxis(i.goals.axes);
  const allGoals = flattenGoals(i.goals);

  // Pulse · the trailing axis + how many active goals it has
  let pulse: PulseLine | null = null;
  if (trailing) {
    const inDomain = allGoals.filter((g) => g.domain === trailing.domain);
    const deltaStr = trailing.delta7d < 0
      ? `↓${Math.abs(trailing.delta7d).toFixed(1)}`
      : "flat";
    const guidance = inDomain.length === 0
      ? "no active goals · this axis has no work"
      : `${inDomain.length} active goal${inDomain.length === 1 ? "" : "s"} could move it`;
    pulse = {
      text: `Right now · ${trailing.domain} is trailing · ${trailing.score.toFixed(1)}/10 ${deltaStr} · ${guidance}`,
      href: `/goals#axis-${encodeURIComponent(trailing.domain)}`,
      tone: trailing.score < 4 ? "amber" : "neutral",
    };
  }

  // Forecast · pace breakdown
  let forecast: PulseLine | null = null;
  if (allGoals.length > 0) {
    const onPace = allGoals.filter((g) => g.daysSinceActivity !== null && g.daysSinceActivity <= 3 && g.progress > 0).length;
    const atRisk = allGoals.filter((g) => g.daysSinceActivity !== null && g.daysSinceActivity >= 7 && g.status !== "achieved").length;
    forecast = {
      text: `7d shape · ${onPace} on track · ${atRisk} at risk · ${allGoals.length} total`,
      href: null,
      tone: atRisk > onPace ? "amber" : atRisk > 0 ? "neutral" : "emerald",
    };
  }

  // Drift · oldest no-activity goal that is NOT already pruner-flagged
  const dormant = allGoals
    .filter(
      (g) =>
        !g.pruneCandidate &&
        g.status !== "achieved" &&
        g.daysSinceActivity !== null &&
        g.daysSinceActivity >= 14,
    )
    .sort((a, b) => (b.daysSinceActivity ?? 0) - (a.daysSinceActivity ?? 0));
  const drift: PulseLine | null = dormant[0]
    ? {
        text: `Drift · "${dormant[0].title.slice(0, 44)}${dormant[0].title.length > 44 ? "…" : ""}" · ${dormant[0].daysSinceActivity}d quiet`,
        href: `/goals#goal-${dormant[0].id}`,
        tone: "amber",
      }
    : null;

  return { pulse, forecast, drift };
}

function composeForScoreboard(i: ComposerInput): Pick<OperatorPulseSnapshot, "pulse" | "forecast" | "drift"> {
  const anomalies = i.scoreboard.numbers.filter((n) => n.anomalous);
  const anchors = i.scoreboard.numbers.filter((n) => !n.anomalous);

  // Pulse · top anomaly with its why
  let pulse: PulseLine | null = null;
  if (anomalies[0]) {
    const a = anomalies[0];
    pulse = {
      text: `Right now · ${a.label.toLowerCase()} is anomalous · ${a.why ?? `${a.display}, attention needed`}`,
      href: a.link,
      tone: "amber",
    };
  } else if (anchors[0]) {
    pulse = {
      text: `Calm · top anchor: ${anchors[0].label.toLowerCase()} ${anchors[0].display}`,
      href: anchors[0].link,
      tone: "emerald",
    };
  }

  // Forecast · trending anchors
  let forecast: PulseLine | null = null;
  const movers = anchors.filter((n) => n.delta7d != null && Math.abs(n.delta7d) > 0);
  if (movers.length > 0) {
    const up = movers.filter((m) => (m.delta7d ?? 0) > 0).length;
    const down = movers.length - up;
    forecast = {
      text: `7d motion · ${up} climbing · ${down} falling · ${anchors.length - movers.length} flat`,
      href: null,
      tone: down > up ? "amber" : up > 0 ? "emerald" : "neutral",
    };
  }

  // Drift · trailing axis (cross-surface · same datasource as /goals)
  const trailing = findTrailingAxis(i.goals.axes);
  const drift: PulseLine | null = trailing && trailing.score < 5
    ? {
        text: `Drift · ${trailing.domain} axis at ${trailing.score.toFixed(1)}/10 · ${trailing.delta7d < 0 ? `↓${Math.abs(trailing.delta7d).toFixed(1)}` : "flat"}`,
        href: `/goals#axis-${encodeURIComponent(trailing.domain)}`,
        tone: "amber",
      }
    : null;

  return { pulse, forecast, drift };
}

function composeForHome(i: ComposerInput): Pick<OperatorPulseSnapshot, "pulse" | "forecast" | "drift"> {
  // Home rotates the lens by what's most pressing: anomaly > top task > goal
  const anomalies = i.scoreboard.numbers.filter((n) => n.anomalous);

  let pulse: PulseLine | null = null;
  if (anomalies[0]) {
    const a = anomalies[0];
    pulse = {
      text: `${a.label} · ${a.display} · ${a.why ?? "attention needed"}`,
      href: a.link,
      tone: "amber",
    };
  } else if (i.topOpenTask) {
    const t = i.topOpenTask;
    pulse = {
      text: `Today · "${t.title.slice(0, 56)}${t.title.length > 56 ? "…" : ""}" is the top move`,
      href: `/tasks#task-row-${t.id}`,
      tone: t.roiScore >= 80 ? "gold" : "neutral",
    };
  }

  // Forecast · the goals-snapshot 7d shape
  const all = flattenGoals(i.goals);
  let forecast: PulseLine | null = null;
  if (all.length > 0) {
    const onPace = all.filter((g) => g.daysSinceActivity !== null && g.daysSinceActivity <= 3 && g.progress > 0).length;
    const atRisk = all.filter((g) => g.daysSinceActivity !== null && g.daysSinceActivity >= 7 && g.status !== "achieved").length;
    forecast = {
      text: `Week shape · ${onPace} goals tracking · ${atRisk} drifting · ${i.doneToday} tasks done today`,
      href: "/goals",
      tone: atRisk > onPace ? "amber" : "neutral",
    };
  }

  // Drift · pick the loudest signal across both surfaces
  const trailing = findTrailingAxis(i.goals.axes);
  let drift: PulseLine | null = null;
  if (i.stalePromise) {
    drift = {
      text: `Quiet promise · "${i.stalePromise.title.slice(0, 36)}${i.stalePromise.title.length > 36 ? "…" : ""}" · ${i.stalePromise.daysSinceUpdate}d`,
      href: `/tasks#task-row-${i.stalePromise.id}`,
      tone: "amber",
    };
  } else if (trailing && trailing.score < 5) {
    drift = {
      text: `Trailing axis · ${trailing.domain} ${trailing.score.toFixed(1)}/10`,
      href: `/goals#axis-${encodeURIComponent(trailing.domain)}`,
      tone: "amber",
    };
  }

  return { pulse, forecast, drift };
}

// ── Public composer ─────────────────────────────────────────────────

const NEW_YORK_TZ = "America/New_York";

function isoStartOfTodayET(): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: NEW_YORK_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  // Construct as ET midnight then convert · ET offset is variable so
  // approximate by using the ISO date string. Good enough for "done today".
  const iso = `${map.year}-${map.month}-${map.day}T00:00:00-05:00`;
  return new Date(iso);
}

export async function buildOperatorPulse(
  surface: PulseSurface,
): Promise<OperatorPulseSnapshot> {
  const startOfToday = isoStartOfTodayET();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

  const [goals, scoreboard, doneToday, done7dTotal, topOpenTask, stalePromise] =
    await Promise.all([
      buildGoalsSnapshot(),
      buildMetaScoreboard(),
      prisma.task
        .count({
          where: {
            status: "DONE",
            deletedAt: null,
            updatedAt: { gte: startOfToday },
          },
        })
        .catch(() => 0),
      prisma.task
        .count({
          where: {
            status: "DONE",
            deletedAt: null,
            updatedAt: { gte: sevenDaysAgo },
          },
        })
        .catch(() => 0),
      prisma.task
        .findFirst({
          where: {
            status: { in: ["INBOX", "READY", "DOING"] },
            deletedAt: null,
          },
          orderBy: [{ roiScore: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            title: true,
            roiScore: true,
            goalId: true,
            promiseTo: true,
            loopKind: true,
          },
        })
        .catch(() => null),
      prisma.task
        .findFirst({
          where: {
            loopKind: "PROMISE",
            status: { in: ["INBOX", "READY", "DOING"] },
            deletedAt: null,
            updatedAt: { lte: new Date(Date.now() - 7 * 86_400_000) },
          },
          orderBy: { updatedAt: "asc" },
          select: { id: true, title: true, promiseTo: true, updatedAt: true },
        })
        .then((r) =>
          r
            ? {
                id: r.id,
                title: r.title,
                promiseTo: r.promiseTo,
                daysSinceUpdate: Math.floor(
                  (Date.now() - r.updatedAt.getTime()) / 86_400_000,
                ),
              }
            : null,
        )
        .catch(() => null),
    ]).catch((err) => {
      log.warn("pulse_composition_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      throw err;
    });

  const input: ComposerInput = {
    goals,
    scoreboard,
    doneToday,
    avg7dDone: done7dTotal / 7,
    topOpenTask,
    stalePromise,
  };

  let parts: Pick<OperatorPulseSnapshot, "pulse" | "forecast" | "drift">;
  switch (surface) {
    case "tasks":
      parts = composeForTasks(input);
      break;
    case "goals":
      parts = composeForGoals(input);
      break;
    case "scoreboard":
      parts = composeForScoreboard(input);
      break;
    case "home":
      parts = composeForHome(input);
      break;
  }

  return {
    surface,
    pulse: parts.pulse,
    forecast: parts.forecast,
    drift: parts.drift,
    composedAt: new Date().toISOString(),
  };
}

// Helper export for tests + callers that want to skip the full snapshot.
export const __internals = {
  findTrailingAxis,
  flattenGoals,
  composeForTasks,
  composeForGoals,
  composeForScoreboard,
  composeForHome,
};

// Convenience re-exports so consumers don't need to import from multiple files.
export type { ScoreboardNumber, AxisScore, GoalRow };
