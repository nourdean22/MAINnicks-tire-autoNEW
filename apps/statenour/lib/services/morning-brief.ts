/**
 * Morning Brief composer · v10.0.524 (base) · v10.0.526 (Arc C F5 + Arc B F6)
 *                                       · v10.0.528 (Arc B F3 decision-replay)
 *
 * v10.0.524 · #2 predictive morning brief — single-domain (personal).
 * v10.0.526 · Arc C Feature 5 · multi-business consolidated brief.
 *           Composes FOUR slices into one push:
 *             1. PERSONAL    (current logic · preserved)
 *             2. SHOP        (nickstire bridge via AuditEvent)
 *             3. WELLBEING   (skeleton · PersonalDailyLog + BodyTracking)
 *             4. ANTICIPATED (Arc B F6 · "Tomorrow you'll probably ask")
 *
 * v10.0.528 · Arc B Feature 3 · Decision-Replay Coach adds a Personal
 *           sub-section listing up to 3 decisions due for replay. The
 *           daily cron (/api/cron/decision-replay) queues these as
 *           BrainMemory(category="decision_replay_due") rows · this
 *           composer reads + marks them consumed in the same pass.
 *
 * The brief is INTENTIONALLY tight — 15 lines max. Tickers carry the
 * detail; this is the wake-up signal. Verbose briefs get ignored.
 *
 * Reused infrastructure (no new deps · no new tables · no new cron):
 *   · `assessDriftState` · scoring/drift.ts
 *   · `listTasks` · services/tasks.ts (filters by status + due)
 *   · `prisma.commitment` · active commitments table
 *   · existing calendar-api.ts via getTodaySchedule helper
 *   · AuditEvent(eventType="ceo_business_context") · nickstire bridge
 *   · CronJobLog · failed-cron tally for the SHOP slice
 *   · PersonalDailyLog + BodyTracking · wellbeing placeholder
 *   · BrainMemory(category="wisdom") · wisdom-of-the-day pull
 *
 * Each slice is gracefully-skippable when data is absent. No "no data"
 * filler line — slices that can't compute themselves drop out silently.
 */

import { prisma } from "@/lib/prisma";
import { readNickRevenue } from "@/lib/nickstire/revenue";
import { activeOnly } from "@/lib/db/soft-delete";
import { logger as rootLogger } from "@/lib/logger";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// v10.0.529.2 M6 fix · surface silent-degrade paths for the 5 parallel
// personal-slice queries. Each `.catch` previously returned the fallback
// shape with zero log surface · a brief that fired with 0 drift / 0 tasks
// / 0 calendar could mean "everything is calm" OR "every DB query just
// failed" and the operator couldn't tell. Now a one-line warn fires per
// failing query so the dashboard reflects reality.
const log = rootLogger.withSurface("services/morning-brief");

function logQueryFail(label: string, err: unknown): void {
  log.warn(`personal_slice_${label}_failed`, {
    err: err instanceof Error ? err.message.slice(0, 200) : String(err),
  });
}

// ── Public shape ────────────────────────────────────────────────────
//
// Backward compatible: existing consumers read `text` + `payload` at
// the top level. v10.0.526 adds a namespaced `payload` (personal /
// shop / wellbeing) and keeps the legacy flat fields aliased through
// `payload.personal.*` so the cron handler's response stays stable.

interface MorningBrief {
  date: string;
  drift: string;
  topTask: string | null;
  taskCount: number;
  calendarConflicts: number;
  unkeptCommitments: number;
  text: string;
  /** Raw payload for the durable log row · namespaced by slice. */
  payload: Record<string, unknown>;
}

interface MorningBriefSlice {
  /** Rendered HTML lines for this slice. Empty array = skip. */
  lines: string[];
  /** Structured payload for the durable log row. Empty object = skip. */
  payload: Record<string, unknown>;
}

// ── Public entrypoint ───────────────────────────────────────────────

/**
 * Build the brief from current operator state. Pure compose — no side
 * effects. The cron handler decides whether to push.
 *
 * Slices are computed in parallel · failures inside any slice degrade
 * gracefully to an empty section without taking the whole brief down.
 */
export async function buildMorningBrief(): Promise<MorningBrief> {
  const todayIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const [personal, shop, wellbeing, anticipated] = await Promise.all([
    buildPersonalSlice(todayIso).catch((): MorningBriefSlice => emptySlice()),
    buildShopSlice().catch((): MorningBriefSlice => emptySlice()),
    buildWellbeingSlice(todayIso).catch((): MorningBriefSlice => emptySlice()),
    buildAnticipatedSlice().catch((): MorningBriefSlice => emptySlice()),
  ]);

  // Compose · header always present · each slice appends only when it
  // has lines. A horizontal rule (HTML <i>—</i>) separates slices for
  // mobile readability without bloating line count.
  const header = `<b>Brief · ${todayIso}</b>`;
  const sections: string[][] = [];
  if (personal.lines.length > 0) sections.push(personal.lines);
  if (shop.lines.length > 0) sections.push(shop.lines);
  if (wellbeing.lines.length > 0) sections.push(wellbeing.lines);
  if (anticipated.lines.length > 0) sections.push(anticipated.lines);

  const text = [header, ...sections.flatMap((s, i) =>
    i === 0 ? s : ["<i>· · ·</i>", ...s],
  )].join("\n");

  // Back-compat: flat fields read from the personal slice so existing
  // consumers (cron handler response, dashboards) keep working.
  const flat = (personal.payload as Record<string, unknown>) ?? {};

  return {
    date: todayIso,
    drift: (flat.drift as string) ?? "LOW",
    topTask: (flat.topTask as string | null) ?? null,
    taskCount: (flat.taskCount as number) ?? 0,
    calendarConflicts: (flat.calendarConflicts as number) ?? 0,
    unkeptCommitments: (flat.unkeptCommitments as number) ?? 0,
    text,
    payload: {
      personal: personal.payload,
      shop: shop.payload,
      wellbeing: wellbeing.payload,
      anticipated: anticipated.payload,
      builtAt: new Date().toISOString(),
    },
  };
}

// ── Slice 4 · ANTICIPATED (v10.0.526 · Arc B F6 · NEW) ──────────────

/**
 * Anticipated-question slice · surfaces "Today you'll probably ask:"
 * with the 3 predictions built last night by /api/cron/anticipate.
 *
 * The cron runs in mega-evening and writes BrainMemory(category=
 * anticipated_question, key=anticipated_<YYYY-MM-DD>). This slice
 * reads via `getTodaysAnticipated` · the helper handles the freshness
 * gate and parsing.
 *
 * Skip rules. Slice is OMITTED ENTIRELY when:
 *   · no anticipated row exists for today
 *   · the row has zero questions (cold start / draft failed)
 *
 * Questions are kept short (under 12 words per the prompt contract)
 * so the slice adds 1 header + up to 3 list lines — fits the 15-line
 * brief budget.
 */
export async function buildAnticipatedSlice(): Promise<MorningBriefSlice> {
  try {
    const { getTodaysAnticipated } = await import("@/lib/brain/anticipated-questions");
    const set = await getTodaysAnticipated();
    if (!set || set.questions.length === 0) return emptySlice();

    // 2026-06-10 · "Tomorrow" → "Today": the set is built the EVENING
    // before (mega-evening fan-out) predicting the NEXT day, and the
    // brief reads it the next morning via the yesterday-fallback — so
    // by the time the operator sees this header, the questions are
    // about TODAY.
    const lines: string[] = ["<b>Today you'll probably ask:</b>"];
    const payloadQs: Array<{ question: string; topic: string | null; hasAnswer: boolean }> = [];
    for (let i = 0; i < set.questions.length && i < 3; i++) {
      const q = set.questions[i]!;
      const hasAnswer = set.answers[i] != null;
      // The dot marker is filled when the precompute succeeded · empty
      // when the slot is null, so the operator sees which ones are
      // ready-to-fire vs draft-only.
      const marker = hasAnswer ? "•" : "◦";
      lines.push(
        `${marker} ${escapeHtml(q.question.slice(0, 90))}${q.topic ? ` <i>[${escapeHtml(q.topic.slice(0, 30))}]</i>` : ""}`,
      );
      payloadQs.push({
        question: q.question,
        topic: q.topic,
        hasAnswer,
      });
    }

    return {
      lines,
      payload: {
        questions: payloadQs,
        builtAt: set.builtAt,
        readyCount: payloadQs.filter((q) => q.hasAnswer).length,
      },
    };
  } catch {
    // Non-fatal · brief still renders the other slices.
    return emptySlice();
  }
}

// ── Slice 1 · PERSONAL (preserved behaviour) ────────────────────────

/**
 * Personal slice · drift + top task + open task count + calendar +
 * aging commitments. Mirrors v10.0.524's original buildMorningBrief
 * verbatim · only the framing changed (returns a slice instead of
 * the full brief).
 */
export async function buildPersonalSlice(
  todayIso: string,
): Promise<MorningBriefSlice> {
  const todayStart = new Date(`${todayIso}T00:00:00-04:00`);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60_000);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60_000);

  // Drift level is sampled from the most recent unresolved drift
  // alert · keeps morning-brief decoupled from the assessDriftState
  // signal-input shape (which requires upstream data sourcing).
  const [latestDrift, topTasks, taskCount, activeCommitments, calendarEvents] =
    await Promise.all([
      prisma.brainMemory
        .findMany({
          where: {
            category: "coach_event",
            key: { startsWith: "coach:drift-recovery:" },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
          select: { metadata: true },
        })
        .then((rows) => {
          const active = rows.find((r) => {
            const meta = (r.metadata ?? {}) as Record<string, any>;
            return !meta.ackedAt;
          });
          if (!active) return null;
          const meta = (active.metadata ?? {}) as Record<string, any>;
          const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning";
          return { severity };
        })
        .catch((err): null => {
          logQueryFail("drift", err);
          return null;
        }),
      prisma.task
        .findMany({
          // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
          where: activeOnly({
            status: { in: ["INBOX", "READY", "DOING"] },
          }),
          orderBy: [{ autoPriority: "desc" }, { roiScore: "desc" }],
          take: 1,
          select: { title: true, nextPhysicalAction: true },
        })
        .catch((err): never[] => {
          logQueryFail("top_task", err);
          return [];
        }),
      prisma.task
        .count({
          // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
          where: activeOnly({
            status: { in: ["INBOX", "READY", "DOING"] },
          }),
        })
        .catch((err) => {
          logQueryFail("task_count", err);
          return 0;
        }),
      prisma.commitment
        .findMany({
          where: {
            status: { in: ["active", "in_progress"] },
            createdAt: { lt: yesterdayStart },
          },
          orderBy: { createdAt: "asc" },
          take: 20,
          select: { id: true, description: true, deadline: true },
        })
        .catch((err): never[] => {
          logQueryFail("commitments", err);
          return [];
        }),
      tryFetchCalendarToday().catch((err): never[] => {
        logQueryFail("calendar", err);
        return [];
      }),
    ]);

  const driftLabel = (latestDrift?.severity ?? "LOW").toUpperCase();

  // Calendar conflicts = events overlapping today.
  const calendarConflicts = (
    calendarEvents as Array<{ start?: string; end?: string }>
  ).filter((e) => {
    if (!e.start) return false;
    const s = new Date(e.start);
    return s >= todayStart && s < todayEnd;
  }).length;

  const topTask = topTasks[0] as
    | { nextPhysicalAction?: string; title?: string }
    | undefined;
  const topTaskText = topTask?.nextPhysicalAction ?? topTask?.title ?? null;

  const lines: string[] = [`Drift: <b>${driftLabel}</b>`];
  if (topTaskText) {
    lines.push(`Top: ${escapeHtml(topTaskText.slice(0, 100))}`);
  }
  if (taskCount > 0) lines.push(`Open tasks: ${taskCount}`);
  if (calendarConflicts > 0) {
    lines.push(
      `Calendar: ${calendarConflicts} event${calendarConflicts === 1 ? "" : "s"}`,
    );
  }
  if (activeCommitments.length > 0) {
    const oldest = activeCommitments[0] as { description: string };
    lines.push(`Aging commits: ${activeCommitments.length}`);
    lines.push(`Oldest: ${escapeHtml(oldest.description.slice(0, 80))}`);
  }

  // Decision-replay sub-section removed 2026-07-30: NOTHING writes the
  // `decision_replay_due` category — the /api/cron/decision-replay builder
  // the v10.0.528 comment named never existed as a route. Prod holds 2
  // fossil rows; the section could only render those ghosts or nothing.

  return {
    lines,
    payload: {
      drift: driftLabel,
      topTask: topTaskText,
      taskCount,
      calendarConflicts,
      unkeptCommitments: activeCommitments.length,
    },
  };
}

// ── Slice 2 · SHOP (v10.0.526 · NEW) ────────────────────────────────

const STALE_BRIDGE_HOURS = 24;

/**
 * Shop slice · line-of-cars + declined-work follow-ups + GBP review
 * delta + revenue-vs-target + failed-cron count.
 *
 * Source. AuditEvent(eventType="ceo_business_context") · the latest
 * row carries the normalized payload that `lib/nickstire/ceo-context.ts`
 * writes when nickstire's `/api/sync/business` fires. CronJobLog gives
 * us the failed-cron tally without needing a second cross-system call.
 *
 * Skip rules. Slice is OMITTED ENTIRELY (no "no data" line · the brief
 * just doesn't have a shop section) when:
 *   · no ceo_business_context row exists, OR
 *   · the latest row is older than 24h (stale bridge),
 *   · AND there are no failed crons in the last 24h.
 * If there ARE failed crons but no bridge data, we still emit a 1-line
 * cron section · operator wants to see infra alerts even without sync.
 */
export async function buildShopSlice(): Promise<MorningBriefSlice> {
  const since24h = new Date(Date.now() - 24 * 60 * 60_000);

  const [latestContext, failedCronCount, failedCronJobs] = await Promise.all([
    prisma.auditEvent
      .findFirst({
        where: { eventType: "ceo_business_context" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      })
      .catch((): null => null),
    prisma.cronJobLog
      .count({
        where: { status: "failed", createdAt: { gte: since24h } },
      })
      .catch(() => 0),
    prisma.cronJobLog
      .findMany({
        where: { status: "failed", createdAt: { gte: since24h } },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { jobName: true },
      })
      .catch((): never[] => []),
  ]);

  const bridgeFresh =
    latestContext != null &&
    Date.now() - new Date(latestContext.createdAt).getTime() <
      STALE_BRIDGE_HOURS * 60 * 60_000;

  // Both signals absent · slice is empty.
  if (!bridgeFresh && failedCronCount === 0) {
    return emptySlice();
  }

  const lines: string[] = ["<b>Shop</b>"];
  const payload: Record<string, unknown> = {};

  if (bridgeFresh && latestContext) {
    const ctx = (latestContext.payload ?? {}) as Record<string, unknown>;

    const lineOfCars = extractLineOfCars(ctx);
    const declinedDelta = extractDeclinedDelta(ctx);
    const declinedTopWithIds = extractDeclinedTopWithIds(ctx);
    const declinedTop = declinedTopWithIds.map((r) => r.name);
    const reviewDelta = extractReviewDelta(ctx);
    const revenueLine = extractRevenueLine(ctx);

    // 2026-05-17 follow-up · Phase 6 surfacing · annotate the top-3
    // declined customers with their inferred preferences (slow payer ·
    // ltv tier · open recovery count). Pure read from BrainMemory ·
    // never throws · empty annotations fall back to the bare names
    // line below.
    const declinedAnnotations = await annotateWithPreferences(
      declinedTopWithIds,
    );

    if (lineOfCars != null) {
      lines.push(`Line of cars: ${lineOfCars}`);
      payload.lineOfCars = lineOfCars;
    }
    if (revenueLine) {
      lines.push(revenueLine.text);
      payload.revenue = revenueLine.payload;
    }
    if (declinedDelta) {
      lines.push(declinedDelta.text);
      payload.declined = declinedDelta.payload;
    }
    if (declinedTop.length > 0) {
      lines.push(
        `Follow-ups: ${declinedTop
          .map((t) => escapeHtml(t.slice(0, 40)))
          .join(" · ")}`,
      );
      payload.declinedTop = declinedTop;
      // Per-customer preference annotations · one line each when we
      // have a preference cached. Skipped silently when none of the
      // top-3 had inferred prefs (zero noise in the brief).
      if (declinedAnnotations.length > 0) {
        for (const ann of declinedAnnotations) {
          lines.push(
            `· ${escapeHtml(ann.name.slice(0, 40))} → ${escapeHtml(ann.summary.slice(0, 80))}`,
          );
        }
        payload.declinedAnnotations = declinedAnnotations;
      }
    }
    if (reviewDelta) {
      lines.push(reviewDelta.text);
      payload.reviewDelta = reviewDelta.payload;
    }

    payload.bridgeSyncedAt = new Date(latestContext.createdAt).toISOString();
  } else if (latestContext) {
    // Bridge exists but stale · note it once so operator knows.
    payload.bridgeStale = true;
    payload.bridgeSyncedAt = new Date(latestContext.createdAt).toISOString();
  }

  if (failedCronCount > 0) {
    const names = (failedCronJobs as Array<{ jobName: string }>)
      .map((j) => escapeHtml(j.jobName.slice(0, 28)))
      .join(", ");
    lines.push(`Failed crons (24h): <b>${failedCronCount}</b> — ${names}`);
    payload.failedCronCount = failedCronCount;
    payload.failedCronJobs = (failedCronJobs as Array<{ jobName: string }>).map(
      (j) => j.jobName,
    );
  }

  // Header-only? Skip entirely.
  if (lines.length <= 1) return emptySlice();

  return { lines, payload };
}

// ── Slice 3 · WELLBEING (v10.0.526 · SKELETON · operator-gated) ─────

/**
 * Wellbeing slice · workout streak + weight delta + sleep avg, with a
 * deterministic wisdom-of-the-day pull at the bottom.
 *
 * Status. SKELETON — operator hasn't confirmed wearable data path yet.
 * The section reads from existing PersonalDailyLog + BodyTracking · no
 * new tables. If neither has 7d of data, the slice OMITS entirely (no
 * "no data" line).
 *
 * Wisdom-of-the-day is deterministic-by-date: same date → same quote
 * all day. We pull all curated wisdom rows once · pick index by a
 * cheap hash of the ISO date · zero-randomness so the brief is
 * reproducible if rebuilt later in the day.
 */
export async function buildWellbeingSlice(
  todayIso: string,
): Promise<MorningBriefSlice> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60_000);

  const [recentLogs, recentBody, wisdomCandidates] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since7d } },
        orderBy: { logDate: "desc" },
        select: { logDate: true, workoutCompleted: true, sleepHours: true },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        orderBy: { date: "desc" },
        take: 14,
        select: { date: true, weight: true },
      })
      .catch((): never[] => []),
    prisma.brainMemory
      .findMany({
        // v10.0.529.106 wave-77 · migrated to activeOnly() helper.
        where: activeOnly({
          category: BRAIN_CATEGORIES.WISDOM,
          confidence: { gte: 0.5 },
        }),
        orderBy: { confidence: "desc" },
        take: 200,
        select: { id: true, content: true, source: true },
      })
      .catch((): never[] => []),
  ]);

  const logs = recentLogs as Array<{
    logDate: Date;
    workoutCompleted: boolean;
    sleepHours: { toNumber(): number } | number | null;
  }>;
  const body = recentBody as Array<{ date: string; weight: number | null }>;
  const wisdoms = wisdomCandidates as Array<{
    id: string;
    content: string;
    source: string | null;
  }>;

  const hasLogs = logs.length > 0;
  const hasBody = body.filter((b) => b.weight != null).length >= 2;

  // Nothing to say · skip the whole slice (no "no data" line).
  if (!hasLogs && !hasBody) return emptySlice();

  const lines: string[] = ["<b>Wellbeing</b>"];
  const payload: Record<string, unknown> = {};

  if (hasLogs) {
    // Workout streak = consecutive most-recent days w/ workoutCompleted.
    const sortedDesc = [...logs].sort(
      (a, b) => b.logDate.getTime() - a.logDate.getTime(),
    );
    let streak = 0;
    for (const l of sortedDesc) {
      if (l.workoutCompleted) streak++;
      else break;
    }

    const sleepValues = logs
      .map((l) =>
        typeof l.sleepHours === "number"
          ? l.sleepHours
          : l.sleepHours?.toNumber?.() ?? null,
      )
      .filter((v): v is number => v != null && v > 0);
    const sleepAvg =
      sleepValues.length > 0
        ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length
        : null;

    if (streak > 0) {
      lines.push(`Workout streak: <b>${streak}d</b>`);
      payload.workoutStreak = streak;
    }
    if (sleepAvg != null) {
      lines.push(`Sleep 7d avg: ${sleepAvg.toFixed(1)}h`);
      payload.sleepAvg = Number(sleepAvg.toFixed(2));
    }
  }

  if (hasBody) {
    const withWeight = body.filter((b) => b.weight != null) as Array<{
      date: string;
      weight: number;
    }>;
    if (withWeight.length >= 2) {
      const latest = withWeight[0]!;
      const prior = withWeight[withWeight.length - 1]!;
      const delta = latest.weight - prior.weight;
      const sign = delta > 0 ? "+" : "";
      lines.push(
        `Weight Δ: ${sign}${delta.toFixed(1)} lb (${withWeight.length}pt window)`,
      );
      payload.weightDelta = Number(delta.toFixed(2));
      payload.weightLatest = latest.weight;
    }
  }

  // Wisdom-of-the-day · deterministic by date.
  if (wisdoms.length > 0) {
    const idx = hashDateToIndex(todayIso, wisdoms.length);
    const pick = wisdoms[idx]!;
    const attribution = pick.source
      ? ` — ${escapeHtml(prettyWisdomSource(pick.source))}`
      : "";
    lines.push(
      `<i>${escapeHtml(pick.content.slice(0, 140))}${attribution}</i>`,
    );
    payload.wisdomId = pick.id;
  }

  // Only header + maybe wisdom but no actual data? Skip.
  if (lines.length <= 1) return emptySlice();
  // Header + only wisdom (no streak / sleep / weight)? Skip wisdom too
  // · operator wanted the section to convey data, not just a quote.
  if (lines.length === 2 && payload.wisdomId && !hasLogs && !hasBody) {
    return emptySlice();
  }

  return { lines, payload };
}

// ── Helpers ─────────────────────────────────────────────────────────

function emptySlice(): MorningBriefSlice {
  return { lines: [], payload: {} };
}

async function tryFetchCalendarToday(): Promise<unknown[]> {
  try {
    const { listEvents } = await import("@/lib/services/calendar-api");
    return await listEvents({ daysAhead: 1, maxResults: 20 });
  } catch {
    return [];
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Deterministic date → index. Tiny djb2-style hash · enough variety
 * across ~200 wisdom rows · zero deps · same date = same index always.
 */
function hashDateToIndex(iso: string, mod: number): number {
  let h = 5381;
  for (let i = 0; i < iso.length; i++) {
    h = ((h << 5) + h + iso.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % Math.max(1, mod);
}

function prettyWisdomSource(s: string): string {
  // Sources look like "wisdom_buffett_12" or "skill_ingestion" · trim
  // to the persona for inline attribution.
  const m = s.match(/^wisdom_([a-z]+)/i);
  if (m?.[1]) return m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return s.slice(0, 24);
}

// ── CEO-context payload extractors ──────────────────────────────────
//
// The shape is normalized at write-time by lib/nickstire/ceo-context.ts
// but historical rows + future schema bumps mean we treat every field
// as optional. Each extractor returns null when its data is absent
// rather than emitting a "0" or "n/a" placeholder line.

function extractLineOfCars(ctx: Record<string, unknown>): number | null {
  // Direct: ctx.lineOfCars
  if (typeof ctx.lineOfCars === "number") return ctx.lineOfCars;
  // workOrders.open · workOrders.total · workOrders.inProgress
  const wo = ctx.workOrders as Record<string, unknown> | undefined;
  if (wo) {
    const v = wo.open ?? wo.total ?? wo.inProgress;
    if (typeof v === "number") return v;
  }
  return null;
}

function extractDeclinedDelta(
  ctx: Record<string, unknown>,
): { text: string; payload: Record<string, unknown> } | null {
  const dec = ctx.declinedWork as Record<string, unknown> | undefined;
  if (!dec) return null;

  const todayCount = numericField(dec, ["count", "openCount", "total"]);
  const todayValue = numericField(dec, [
    "value",
    "valueCents",
    "totalValue",
    "openValue",
  ]);
  const yesterdayCount = numericField(dec, [
    "countYesterday",
    "yesterdayCount",
  ]);

  if (todayCount == null && todayValue == null) return null;

  const parts: string[] = [];
  if (todayCount != null) {
    const deltaStr =
      yesterdayCount != null
        ? ` (${todayCount - yesterdayCount >= 0 ? "+" : ""}${todayCount - yesterdayCount} vs yest)`
        : "";
    parts.push(`${todayCount} open${deltaStr}`);
  }
  if (todayValue != null) {
    // Treat field as dollars if name contains "Cents" we divide.
    const inDollars = guessIsCents(dec) ? todayValue / 100 : todayValue;
    parts.push(`$${formatMoney(inDollars)}`);
  }

  return {
    text: `Declined work: ${parts.join(" · ")}`,
    payload: { count: todayCount, value: todayValue, yesterdayCount },
  };
}

/**
 * Top 3 declined-work rows · used by the brief composer for follow-up
 * targeting. Returns names by default (preserves existing call shape).
 *
 * 2026-05-17 follow-up · also exposes a sibling extractor that
 * returns {id, name} pairs so the Phase 6 preference layer can
 * annotate them ("Brennen · slow payer · 3 open recovery items").
 */
function extractDeclinedTop(ctx: Record<string, unknown>): string[] {
  return extractDeclinedTopWithIds(ctx).map((row) => row.name);
}

interface DeclinedTopRow {
  id?: string;
  name: string;
}

function extractDeclinedTopWithIds(ctx: Record<string, unknown>): DeclinedTopRow[] {
  const dec = ctx.declinedWork as Record<string, unknown> | undefined;
  if (!dec) return [];
  const top = dec.topByScore ?? dec.top ?? dec.followUps;
  if (!Array.isArray(top)) return [];
  return top
    .slice(0, 3)
    .map((row): DeclinedTopRow | null => {
      if (typeof row === "string") return { name: row };
      if (row && typeof row === "object") {
        const r = row as Record<string, unknown>;
        const name =
          r.customerName ?? r.name ?? r.title ?? r.label ?? "Unnamed";
        const id = r.customerId ?? r.id;
        return {
          name: typeof name === "string" ? name : "Unnamed",
          id: typeof id === "string" && id.length > 0 ? id : undefined,
        };
      }
      return null;
    })
    .filter((row): row is DeclinedTopRow => row != null && row.name.length > 0);
}

/**
 * Phase 6 surfacing (2026-05-17) · look up cached preferences for
 * each top declined customer and return short summary lines for the
 * brief. Pure read · never throws · returns [] on any failure so the
 * brief composer never breaks on this annotation.
 */
async function annotateWithPreferences(
  rows: DeclinedTopRow[],
): Promise<Array<{ name: string; summary: string }>> {
  const withIds = rows.filter((r): r is DeclinedTopRow & { id: string } =>
    typeof r.id === "string" && r.id.length > 0,
  );
  if (withIds.length === 0) return [];
  try {
    const { getCustomerPreferences } = await import(
      "@/lib/brain/customer-preferences"
    );
    const prefs = await Promise.all(
      withIds.map(async (row) => {
        const p = await getCustomerPreferences(row.id);
        if (!p?.summary) return null;
        return { name: row.name, summary: p.summary };
      }),
    );
    return prefs.filter((p): p is { name: string; summary: string } => p != null);
  } catch (err) {
    log.warn("annotate_preferences_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return [];
  }
}

function extractReviewDelta(
  ctx: Record<string, unknown>,
): { text: string; payload: Record<string, unknown> } | null {
  const intel = ctx.intelligence as Record<string, unknown> | undefined;
  const gbp =
    (ctx.gbpReviews as Record<string, unknown> | undefined) ??
    (intel?.gbp as Record<string, unknown> | undefined) ??
    (intel?.reviews as Record<string, unknown> | undefined);
  if (!gbp) return null;
  const newCount = numericField(gbp, ["new", "newToday", "delta", "added"]);
  const total = numericField(gbp, ["total", "count", "lifetime"]);
  if (newCount == null && total == null) return null;
  const parts: string[] = [];
  if (newCount != null) parts.push(`+${newCount} new`);
  if (total != null) parts.push(`${total} total`);
  return {
    text: `Reviews: ${parts.join(" · ")}`,
    payload: { new: newCount, total },
  };
}

function extractRevenueLine(
  ctx: Record<string, unknown>,
): { text: string; payload: Record<string, unknown> } | null {
  const rev = ctx.revenue as Record<string, unknown> | undefined;
  if (!rev) return null;
  // Prefer the current nickstire shape (totalDollars + invoiceCount) so the
  // brief shows TODAY's real revenue. The legacy yesterday/target path below
  // is kept only for old payloads. (2026-05-29 · payload-key drift fix.)
  const nickRev = readNickRevenue(rev);
  if (nickRev.hasToday) {
    return {
      text: `Rev (today): $${formatMoney(nickRev.todayDollars)}${
        nickRev.jobs > 0 ? ` · ${nickRev.jobs} jobs` : ""
      }`,
      payload: rev,
    };
  }
  const yesterday = numericField(rev, [
    "yesterday",
    "yesterdayValue",
    "lastDay",
  ]);
  const target = numericField(rev, ["dailyTarget", "target", "goalDaily"]);
  if (yesterday == null) return null;
  const cents = guessIsCents(rev);
  const yest = cents ? yesterday / 100 : yesterday;
  let line = `Rev (yest): $${formatMoney(yest)}`;
  if (target != null) {
    const tgt = cents ? target / 100 : target;
    const pct = tgt > 0 ? Math.round((yest / tgt) * 100) : 0;
    line += ` · ${pct}% of $${formatMoney(tgt)} target`;
  }
  return {
    text: line,
    payload: { yesterday, target },
  };
}

function numericField(
  obj: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

function guessIsCents(obj: Record<string, unknown>): boolean {
  return Object.keys(obj).some((k) => /Cents$/.test(k));
}

function formatMoney(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}
