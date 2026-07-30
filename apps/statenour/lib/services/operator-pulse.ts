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
import { cached } from "@/lib/utils/cache";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

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

export interface WisdomLine {
  /** The wisdom quote text · max 180 chars after composition */
  text: string;
  /** Attribution (e.g. "Buffett", "Naval", "principle", "you") */
  attribution: string;
  /** Optional link to the wisdom row in /brain/wisdom */
  href: string | null;
}

export interface OperatorPulseSnapshot {
  surface: PulseSurface;
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  /** Phase F (2026-05-18 PM) · context-matched wisdom quote · keyword
   *  + persona weighted · no embedding cost · null when nothing fits. */
  wisdom: WisdomLine | null;
  composedAt: string;
}

// ── Helper · the trailing axis (worst score with negative delta) ────

function findTrailingAxis(axes: AxisScore[]): AxisScore | null {
  const candidates = axes.filter((a) => a.delta7d <= 0);
  if (candidates.length === 0) return null;
  // Sort by composite badness · low score AND falling delta both count
  const ranked = candidates.toSorted((a, b) => {
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
      href: `/missions#task-row-${t.id}`,
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
        href: `/missions#task-row-${i.stalePromise.id}`,
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
      href: `/stats#axis-${encodeURIComponent(trailing.domain)}`,
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
    .toSorted((a, b) => (b.daysSinceActivity ?? 0) - (a.daysSinceActivity ?? 0));
  const drift: PulseLine | null = dormant[0]
    ? {
        text: `Drift · "${dormant[0].title.slice(0, 44)}${dormant[0].title.length > 44 ? "…" : ""}" · ${dormant[0].daysSinceActivity}d quiet`,
        href: `/stats#goal-${dormant[0].id}`,
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
        href: `/stats#axis-${encodeURIComponent(trailing.domain)}`,
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
      href: `/missions#task-row-${t.id}`,
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
      href: "/stats",
      tone: atRisk > onPace ? "amber" : "neutral",
    };
  }

  // Drift · pick the loudest signal across both surfaces
  const trailing = findTrailingAxis(i.goals.axes);
  let drift: PulseLine | null = null;
  if (i.stalePromise) {
    drift = {
      text: `Quiet promise · "${i.stalePromise.title.slice(0, 36)}${i.stalePromise.title.length > 36 ? "…" : ""}" · ${i.stalePromise.daysSinceUpdate}d`,
      href: `/missions#task-row-${i.stalePromise.id}`,
      tone: "amber",
    };
  } else if (trailing && trailing.score < 5) {
    drift = {
      text: `Trailing axis · ${trailing.domain} ${trailing.score.toFixed(1)}/10`,
      href: `/stats#axis-${encodeURIComponent(trailing.domain)}`,
      tone: "amber",
    };
  }

  return { pulse, forecast, drift };
}

// ── Phase F · context-matched wisdom selector ───────────────────────
//
// Pulls one wisdom quote from BrainMemory(category="wisdom") that
// matches the current pulse context. KEYWORD + persona-weighted ·
// NO embedding cost (we already paid that price for the embedding
// rows; for pulse-context selection we want sub-100ms).
//
// Matching strategy (rough but useful):
//   1. Build a set of candidate keywords from pulse parts (trailing
//      axis · anomaly label · domain · loopKind etc).
//   2. Pull recent + high-confidence wisdom rows.
//   3. Score each row by overlap with keywords + persona boost +
//      not-shown-recently penalty.
//   4. Return the top match (or null if nothing meaningfully overlaps).
//
// If no signal-bearing keywords exist (calm day · no anomalies) we
// fall back to one operator-favored persona quote (Buffett/Naval/
// Munger) rotated by date so the pulse always has something
// reflective even when there's nothing burning.

const PERSONA_RANK: Record<string, number> = {
  buffett: 1.20,
  naval: 1.20,
  munger: 1.18,
  bezos: 1.15,
  jobs: 1.10,
  greene: 1.10,
  gates: 1.05,
  musk: 1.05,
  satori: 0.85,
};

function personaFromKey(key: string): string | null {
  const m = key.match(/^wisdom_([a-z]+)_/);
  return m ? m[1] : null;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function buildWisdomKeywords(parts: {
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  trailingAxis: AxisScore | null;
  topAnomaly: ScoreboardNumber | null;
  surface: PulseSurface;
}): Set<string> {
  const keywords = new Set<string>();
  if (parts.pulse) tokenize(parts.pulse.text).forEach((w) => keywords.add(w));
  if (parts.drift) tokenize(parts.drift.text).forEach((w) => keywords.add(w));
  if (parts.trailingAxis) keywords.add(parts.trailingAxis.domain.toLowerCase());
  if (parts.topAnomaly) {
    tokenize(parts.topAnomaly.label).forEach((w) => keywords.add(w));
    if (parts.topAnomaly.why) tokenize(parts.topAnomaly.why).forEach((w) => keywords.add(w));
  }
  // Surface adds an implicit semantic frame · tasks → execution · goals
  // → strategy · scoreboard → measurement · home → reflection. These
  // keywords aren't strict matches but bias the persona selection.
  if (parts.surface === "tasks") {
    keywords.add("action");
    keywords.add("execute");
    keywords.add("focus");
  } else if (parts.surface === "goals") {
    keywords.add("strategy");
    keywords.add("vision");
    keywords.add("long");
  } else if (parts.surface === "scoreboard") {
    keywords.add("measure");
    keywords.add("number");
    keywords.add("signal");
  } else if (parts.surface === "home") {
    keywords.add("today");
    keywords.add("morning");
  }
  return keywords;
}

async function pickWisdomForPulse(input: {
  pulse: PulseLine | null;
  forecast: PulseLine | null;
  drift: PulseLine | null;
  trailingAxis: AxisScore | null;
  topAnomaly: ScoreboardNumber | null;
  surface: PulseSurface;
}): Promise<WisdomLine | null> {
  const keywords = buildWisdomKeywords(input);
  if (keywords.size === 0) return null;

  // Pull a recent slice of wisdom · 400 rows is plenty for keyword
  // scoring · indexed read so this is sub-50ms. Raised from 300 to
  // 400 because the H.3.2 filter below drops noisy system entries.
  const rawRows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.WISDOM,
        deletedAt: null,
        confidence: { gte: 0.4 },
      },
      select: {
        id: true,
        key: true,
        content: true,
        source: true,
        confidence: true,
        seenCount: true,
      },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: 400,
    })
    .catch(() => [] as Array<{
      id: string;
      key: string;
      content: string;
      source: string | null;
      confidence: number | null;
      seenCount: number | null;
    }>);
  // H.3.2 · same source-filter as lib/brain/wisdom-suggest.ts · keeps
  // human-curated + distilled wisdom · drops system-cron auto-promoted
  // entries ("[PROMOTED TO WISDOM] Nick advice ... System health:
  // Green ..." was leaking through pre-fix).
  const NOISY_SOURCES = new Set([
    "wisdom_sync_cron",
    "device_analysis",
    "conversation_analysis",
    "history_ingestion",
  ]);
  const rows = rawRows.filter((w) => {
    if (!w.content || w.content.length < 20) return false;
    if (/^\s*\[PROMOTED TO WISDOM\]/i.test(w.content)) return false;
    if (/^\s*\[nick advice\]/i.test(w.content)) return false;
    if (w.source && NOISY_SOURCES.has(w.source)) return false;
    if (w.key && /^(nick_?advice|nickadvice|chat_reply)_/i.test(w.key)) return false;
    return true;
  });
  if (rows.length === 0) return null;

  // Recently shown cooldown · don't loop the same quote across surfaces
  // in the same session.
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const shownRecently = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.PULSE_WISDOM_SHOWN, updatedAt: { gte: since } },
      select: { key: true },
      take: 200,
    })
    .then((r) => new Set(r.map((x) => x.key.replace(/^pulse:/, ""))))
    .catch(() => new Set<string>());

  // Score each candidate
  let best: { row: (typeof rows)[number]; score: number } | null = null;
  for (const row of rows) {
    const persona = personaFromKey(row.key);
    const personaBoost = persona ? (PERSONA_RANK[persona] ?? 1.0) : 1.0;
    const contentTokens = tokenize(row.content);
    let overlap = 0;
    for (const k of keywords) {
      if (contentTokens.has(k)) overlap += 1;
    }
    if (overlap === 0) continue;

    const recentPenalty = shownRecently.has(row.id) ? 0.4 : 1.0;
    const confidence = Number(row.confidence ?? 0.5);
    const score = overlap * personaBoost * confidence * recentPenalty;
    if (!best || score > best.score) {
      best = { row, score };
    }
  }
  if (!best) return null;

  // Fire-and-forget: mark this wisdom as shown so the same quote
  // doesn't echo across rapid page navigations within 6h.
  void prisma.brainMemory
    .upsert({
      where: {
        category_key: { category: BRAIN_CATEGORIES.PULSE_WISDOM_SHOWN, key: `pulse:${best.row.id}` },
      },
      create: {
        category: BRAIN_CATEGORIES.PULSE_WISDOM_SHOWN,
        key: `pulse:${best.row.id}`,
        content: `pulse surfaced wisdom ${best.row.id}`,
        confidence: 0.5,
        source: "operator-pulse",
        createdBy: "system",
      },
      update: { updatedAt: new Date(), seenCount: { increment: 1 } },
    })
    .catch(() => {
      /* non-fatal · the pulse still renders if the bookkeeping write fails */
    });

  // Format the line · cap at 180 chars · attribution from persona key
  // or source label.
  const persona = personaFromKey(best.row.key);
  const attribution = persona
    ? persona.charAt(0).toUpperCase() + persona.slice(1)
    : best.row.source === "manual" || best.row.source === "user"
      ? "you"
      : best.row.source === "skill_ingestion"
        ? "principle"
        : "wisdom";
  const text = best.row.content.length > 180
    ? best.row.content.slice(0, 177).trimEnd() + "…"
    : best.row.content;
  return {
    text,
    attribution,
    href: `/brain?tab=wisdom&focus=${encodeURIComponent(best.row.id)}`,
  };
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

/** N.5 · server-side cache wrapper · 30s TTL matches the client
 *  staleTime · cuts the heavy goals + scoreboard snapshot queries
 *  when multiple surfaces request the same pulse within the window
 *  (which happens on every page navigation in the mastery area). */
export async function buildOperatorPulse(
  surface: PulseSurface,
): Promise<OperatorPulseSnapshot> {
  return cached(`pulse:${surface}`, 30, () => buildOperatorPulseUncached(surface));
}

async function buildOperatorPulseUncached(
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
        }),
      prisma.task
        .count({
          where: {
            status: "DONE",
            deletedAt: null,
            updatedAt: { gte: sevenDaysAgo },
          },
        }),
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
        }),
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
        ),
      // 2026-07-30 sweep · the four inner .catch swallows here are GONE.
      // A failed count rendered "0 done today" and a failed task read
      // rendered "no stale promise" — both feeding the emerald "Calm"
      // verdict below. Every read now fails loudly into the outer catch
      // (which logs pulse_composition_failed and rethrows), matching how
      // goals/scoreboard already behave.
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

  // Phase F · context-matched wisdom · pure keyword + persona scoring
  // over an indexed BrainMemory read · sub-100ms typical · null when
  // nothing fits. Fails closed: if wisdom selection throws, the pulse
  // still ships its three core lines.
  const trailingAxis = findTrailingAxis(goals.axes);
  const topAnomaly = scoreboard.numbers.find((n) => n.anomalous) ?? null;
  const wisdom = await pickWisdomForPulse({
    pulse: parts.pulse,
    forecast: parts.forecast,
    drift: parts.drift,
    trailingAxis,
    topAnomaly,
    surface,
  }).catch(() => null);

  return {
    surface,
    pulse: parts.pulse,
    forecast: parts.forecast,
    drift: parts.drift,
    wisdom,
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
  pickWisdomForPulse,
  buildWisdomKeywords,
};

// Convenience re-exports so consumers don't need to import from multiple files.
export type { ScoreboardNumber, AxisScore, GoalRow };
