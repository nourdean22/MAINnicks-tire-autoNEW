/**
 * lib/missions/deck.ts — the Missions page's server-composed read model.
 *
 * One query set, one scorer pass, every section derived from the same
 * ranked dataset — the operator-brief.ts pattern applied to /missions
 * (Execution Deck wave, 2026-09-01). Replaces the page's five client
 * polls (task.list 15s + task.missions 30s + healthSummary 30s +
 * governorState 30s + missionsHygiene 120s) with one read.
 *
 * Honesty contract (house doctrine): every source is guarded; a failed
 * read renders as a named unknown, never as zero, and the board-level
 * read state distinguishes unreadable from stale from ready client-side.
 *
 * Ranking authority: scoreTaskPriority (lib/scoring/task-priority.ts) is
 * the ONLY ordering brain — this file never sorts by the stored
 * autoPriority column (stored-score staleness is a defect class, #1946).
 */
import { parseResumeRecord, type ResumeRecord } from "@/lib/missions/resume-record";
import { prisma } from "@/lib/prisma";
import { activeOnly } from "@/lib/db/soft-delete";
import { serializeForJson } from "@/lib/utils/serialize";
import { rankMissions } from "@/lib/scoring/mission-ranking";
import {
  HABIT_LOOPS,
  scoreTaskPriority,
  type RankedMissionRef,
} from "@/lib/scoring/task-priority";
import { isGeneralAnchor, isUserProject } from "@/lib/services/mission-helpers";
import { buildTaskRescue } from "@/lib/services/task-rescue";
import { getLatestGovernorDecision } from "@/lib/health-governor/health-governor-guardrails";
import { startOfDayET, toDateString } from "@/lib/utils/datetime";

export const EFFORT_MINUTES: Record<string, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2PLUS: 120,
};

/** WIP cap on ACTIVE user projects — the 4th requires pausing one (§5). */
export const MISSION_WIP_CAP = 3;

/** Rhythm consistency window, in ET days ("6 of last 7"). */
export const RHYTHM_WINDOW_DAYS = 7;

/** Readiness reads older than this are reported unknown, never as a score. */
export const READINESS_MAX_AGE_DAYS = 2;

/** Triage rows shown before the "+N more" truth line. */
export const TRIAGE_LIMIT = 12;

export type DeckTaskRef = {
  id: string;
  title: string;
  nextPhysicalAction: string | null;
  effort: string | null;
  effortMinutes: number;
  energyRequired: string | null;
  status: string;
  dueDate: string | null;
  missionId: string;
  missionTitle: string | null;
  score: number;
  why: string;
};

export type DeckNextMove = {
  /** resume = a DOING loop is open · start = fresh pick · null = nothing eligible. */
  kind: "resume" | "start";
  task: DeckTaskRef;
  alternates: DeckTaskRef[];
  /** Latest "parked" note for the hero — where the operator stopped. */
  resumeNote: string | null;
  /** U5 (2026-09-07) · structured record from the same parked event; null on legacy parks. */
  resumeRecord: ResumeRecord | null;
  /** When the hero was parked (ISO) — the reader weighs freshness before acting. */
  parkedAt: string | null;
} | null;

export type DeckTriageRow = {
  kind: "capture" | "classify" | "unattached" | "rescue";
  id: string;
  taskId: string | null;
  title: string;
  detail: string | null;
};

export type DeckMission = {
  id: string;
  title: string;
  deadline: string | null;
  openCount: number;
  doneCount: number;
};

export type DeckLane = {
  id: string;
  title: string;
  canonicalDomain: string | null;
  isShop: boolean;
  openCount: number;
  oldestOpenDays: number | null;
};

export type DeckRhythm = {
  id: string;
  title: string;
  loopKind: string;
  doneToday: boolean;
  /** Distinct ET days with a completion event in the trailing window. */
  windowDone: number;
  windowOf: number;
};

export type DeckWaitingRow = {
  id: string;
  title: string;
  waitingOn: string;
  ageDays: number;
  delegatedToNick: boolean;
};

export type DeckEvidenceRow = {
  id: string;
  title: string;
  missionTitle: string | null;
};

export type DeckReadiness =
  | { state: "nominal"; measuredDaysAgo: number }
  | { state: "exception"; line: string; measuredDaysAgo: number }
  | { state: "unknown"; line: string; measuredDaysAgo: number | null };

export type MissionsDeck = {
  generatedAt: string;
  nextMove: DeckNextMove;
  capacity: { chosenMinutes: number; chosenCount: number };
  triage: { rows: DeckTriageRow[]; totalCount: number };
  missions: DeckMission[];
  missionSlotsOpen: number;
  lanes: DeckLane[];
  rhythms: DeckRhythm[];
  waiting: DeckWaitingRow[];
  evidence: { rows: DeckEvidenceRow[]; count: number };
  readiness: DeckReadiness;
  /** Sources that failed to read this pass — named, never silently zero. */
  unmeasured: string[];
};

const DAY_MS = 86_400_000;

function daysBetween(from: Date | string | null | undefined, now: Date): number | null {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

function toRef(
  t: {
    id: string;
    title: string;
    nextPhysicalAction: string | null;
    effort: string | null;
    energyRequired: string | null;
    status: string;
    dueDate: Date | string | null;
    missionId: string;
  },
  missionTitle: string | null,
  score: number,
  why: string,
): DeckTaskRef {
  return {
    id: t.id,
    title: t.title,
    nextPhysicalAction: t.nextPhysicalAction,
    effort: t.effort,
    effortMinutes: EFFORT_MINUTES[t.effort ?? ""] ?? 30,
    energyRequired: t.energyRequired,
    status: t.status,
    dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : null,
    missionId: t.missionId,
    missionTitle,
    score,
    why,
  };
}

export async function buildMissionsDeck(now = new Date()): Promise<MissionsDeck> {
  const unmeasured: string[] = [];
  const todayStart = startOfDayET(now);

  // ── the one dataset ────────────────────────────────────────────────
  const [missions, tasks] = await Promise.all([
    prisma.mission.findMany({ where: activeOnly() }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { notIn: ["ARCHIVED"] } },
      select: {
        id: true,
        title: true,
        nextPhysicalAction: true,
        status: true,
        effort: true,
        energyRequired: true,
        roiScore: true,
        frictionScore: true,
        dueDate: true,
        lastTouchedAt: true,
        lastCompletedAt: true,
        loopKind: true,
        manualPriorityOverride: true,
        waitingOn: true,
        startedAt: true,
        snoozedUntil: true,
        missionId: true,
        pendingClassification: true,
        createdAt: true,
        updatedAt: true,
      },
      take: 1500,
    }),
  ]);

  const serialMissions = serializeForJson(missions);
  const ranking = rankMissions(serialMissions, now);
  const missionMap = new Map<string, RankedMissionRef & { title?: string }>(
    ranking.rankedMissions.map((m) => [m.id, m]),
  );
  const missionById = new Map(serialMissions.map((m: { id: string }) => [m.id, m]));
  const titleOf = (missionId: string) =>
    (missionById.get(missionId) as { title?: string } | undefined)?.title ?? null;

  const anchorIds = new Set(
    serialMissions.filter((m: Parameters<typeof isGeneralAnchor>[0]) => isGeneralAnchor(m)).map((m: { id: string }) => m.id),
  );
  const shopAnchorIds = new Set(
    serialMissions
      .filter(
        (m: { canonicalDomain?: string | null; domain?: string | null } & Parameters<typeof isGeneralAnchor>[0]) =>
          isGeneralAnchor(m) &&
          ((m.canonicalDomain ?? "").toLowerCase() === "business" ||
            (m.domain ?? "").toUpperCase() === "BUSINESS"),
      )
      .map((m: { id: string }) => m.id),
  );
  const userProjects = serialMissions.filter(
    (m: Parameters<typeof isUserProject>[0] & { status: string }) =>
      m.status === "ACTIVE" && isUserProject(m),
  );

  const serialTasks = serializeForJson(tasks);
  const scored = serialTasks.map((t: (typeof serialTasks)[number]) => {
    const r = scoreTaskPriority(t, missionMap, now);
    return { ...t, _score: r.score, _why: r.explanation };
  });
  type ScoredTask = (typeof scored)[number];

  const isHabit = (t: ScoredTask) => HABIT_LOOPS.has((t.loopKind ?? "").toUpperCase());
  const isOpen = (t: ScoredTask) => t.status === "INBOX" || t.status === "READY" || t.status === "DOING";
  const isBlocked = (t: ScoredTask) => typeof t.waitingOn === "string" && t.waitingOn.trim().length > 0;
  const openTasks = scored.filter(isOpen);

  // ── next move — one decided action (§10.2) ─────────────────────────
  // Eligibility (boundary §3): habits never; blocked never; tasks filed
  // in the SHOP anchor never (ordinary shop ops belong in the admin).
  // Business USER projects stay eligible — the scorer already dampens
  // them unless their due ramp is hot.
  const heroEligible = openTasks
    .filter((t: ScoredTask) => !isHabit(t) && !isBlocked(t) && !shopAnchorIds.has(t.missionId))
    .sort((a: ScoredTask, b: ScoredTask) => b._score - a._score);

  const doingNow = heroEligible.filter((t: ScoredTask) => t.status === "DOING");
  const heroPick = doingNow[0] ?? heroEligible[0] ?? null;
  const alternates = heroEligible
    .filter((t: ScoredTask) => t.id !== heroPick?.id)
    .slice(0, 2)
    .map((t: ScoredTask) => toRef(t, titleOf(t.missionId), t._score, t._why));

  // Ready-to-resume note: the latest "parked" event's payload.note for the
  // hero — shown when the pick is a resume so the block starts clean.
  let resumeNote: string | null = null;
  let resumeRecord: ResumeRecord | null = null;
  let parkedAt: string | null = null;
  if (heroPick) {
    try {
      const parked = await prisma.taskEvent.findFirst({
        where: { taskId: heroPick.id, kind: "parked" },
        orderBy: { createdAt: "desc" },
        select: { payload: true, createdAt: true },
      });
      const note = (parked?.payload as { note?: unknown } | null)?.note;
      resumeNote = typeof note === "string" && note.trim().length > 0 ? note.trim() : null;
      resumeRecord = parseResumeRecord(parked?.payload);
      parkedAt = parked?.createdAt ? new Date(parked.createdAt).toISOString() : null;
    } catch {
      unmeasured.push("resume note");
    }
  }

  const nextMove: DeckNextMove = heroPick
    ? {
        kind: doingNow.length > 0 ? "resume" : "start",
        task: toRef(heroPick, titleOf(heroPick.missionId), heroPick._score, heroPick._why),
        alternates,
        resumeNote,
        resumeRecord,
        parkedAt,
      }
    : null;

  // ── capacity — the chosen set, honestly summed (§10.3) ─────────────
  const dueToday = (t: ScoredTask) =>
    t.dueDate !== null && new Date(t.dueDate).getTime() < todayStart.getTime() + DAY_MS;
  const chosen = openTasks.filter(
    (t: ScoredTask) => !isHabit(t) && (t.status === "DOING" || dueToday(t)),
  );
  const capacity = {
    chosenMinutes: chosen.reduce(
      (sum: number, t: ScoredTask) => sum + (EFFORT_MINUTES[t.effort ?? ""] ?? 30),
      0,
    ),
    chosenCount: chosen.length,
  };

  // ── triage airlock (§10.4) ─────────────────────────────────────────
  const triageRows: DeckTriageRow[] = [];
  let captureCount = 0;
  try {
    const captures = await prisma.captureInboxItem.findMany({
      where: { triageStatus: "NEW", status: "active" },
      orderBy: { capturedAt: "desc" },
      select: { id: true, title: true, summary: true },
      take: TRIAGE_LIMIT,
    });
    captureCount = await prisma.captureInboxItem.count({
      where: { triageStatus: "NEW", status: "active" },
    });
    for (const c of captures) {
      triageRows.push({ kind: "capture", id: c.id, taskId: null, title: c.title, detail: c.summary });
    }
  } catch {
    unmeasured.push("captures");
  }

  const pendingClassify = openTasks.filter(
    (t: ScoredTask) => t.pendingClassification !== null && t.pendingClassification !== undefined,
  );
  for (const t of pendingClassify) {
    triageRows.push({
      kind: "classify",
      id: `classify:${t.id}`,
      taskId: t.id,
      title: t.title,
      detail: "Nick proposed a mission — accept or re-file.",
    });
  }

  const unattached = openTasks.filter(
    (t: ScoredTask) =>
      !missionById.has(t.missionId) ||
      ((missionById.get(t.missionId) as { status?: string } | undefined)?.status !== "ACTIVE" &&
        !anchorIds.has(t.missionId)),
  );
  for (const t of unattached) {
    triageRows.push({
      kind: "unattached",
      id: `unattached:${t.id}`,
      taskId: t.id,
      title: t.title,
      detail: "No live mission — file it, park it, or let it go.",
    });
  }

  let rescueCount = 0;
  try {
    const rescue = await buildTaskRescue();
    rescueCount = rescue.findings.length;
    // One task, one attention slot: a finding about the task that ALREADY
    // owns the hero (or already queued above) never re-queues in triage —
    // the self-audit caught the hero's own staleness finding double-billing.
    const already = new Set(triageRows.map((r) => r.taskId).filter(Boolean));
    if (heroPick) already.add(heroPick.id);
    for (const f of rescue.findings.slice(0, 4)) {
      if (f.taskId && already.has(f.taskId)) continue;
      triageRows.push({
        kind: "rescue",
        id: `rescue:${f.taskId ?? f.title}`,
        taskId: f.taskId ?? null,
        title: f.title,
        detail: f.reason ?? f.issue,
      });
    }
  } catch {
    unmeasured.push("rescue");
  }

  const triage = {
    rows: triageRows.slice(0, TRIAGE_LIMIT),
    totalCount: captureCount + pendingClassify.length + unattached.length + rescueCount,
  };

  // ── missions — finite user projects only (§10.5) ───────────────────
  // Slimmed to the fields the page actually reads (WIP slots + counts) —
  // per-mission progress/next-task live on MissionCard, and shipping a
  // second unread copy in this payload was the "cost nobody collects"
  // defect class this rebuild exists to kill (self-audit trim).
  const deckMissions: DeckMission[] = userProjects
    .map((m: { id: string; title: string; deadline?: string | null }) => {
      const mine = scored.filter((t: ScoredTask) => t.missionId === m.id);
      const open = mine.filter(isOpen).filter((t: ScoredTask) => !isHabit(t));
      const done = mine.filter((t: ScoredTask) => t.status === "DONE");
      return {
        id: m.id,
        title: m.title,
        deadline: m.deadline ?? null,
        openCount: open.length,
        doneCount: done.length,
      };
    })
    .sort((a: DeckMission, b: DeckMission) => {
      const ad = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      return ad - bd || a.title.localeCompare(b.title);
    });

  // ── lanes — eternal domain queues, counts + age, never progress (§10.6) ──
  const lanes: DeckLane[] = serialMissions
    .filter((m: Parameters<typeof isGeneralAnchor>[0] & { status: string }) => m.status === "ACTIVE" && isGeneralAnchor(m))
    .map((m: { id: string; title: string; canonicalDomain?: string | null }) => {
      const open = openTasks.filter((t: ScoredTask) => t.missionId === m.id && !isHabit(t));
      const oldest = open.reduce(
        (acc: number | null, t: ScoredTask) => {
          const d = daysBetween(t.lastTouchedAt ?? t.createdAt, now);
          return d === null ? acc : acc === null ? d : Math.max(acc, d);
        },
        null as number | null,
      );
      return {
        id: m.id,
        title: m.title,
        canonicalDomain: m.canonicalDomain ?? null,
        isShop: shopAnchorIds.has(m.id),
        openCount: open.length,
        oldestOpenDays: oldest,
      };
    })
    .filter((l: DeckLane) => l.openCount > 0)
    .sort((a: DeckLane, b: DeckLane) => Number(a.isShop) - Number(b.isShop) || b.openCount - a.openCount);

  // ── rhythms — habits off the board, measured kindly (§10.7) ────────
  const rhythmTasks = scored.filter(
    (t: ScoredTask) => isHabit(t) && (isOpen(t) || t.status === "WAITING"),
  );
  let rhythms: DeckRhythm[] = [];
  try {
    const windowStart = new Date(todayStart.getTime() - (RHYTHM_WINDOW_DAYS - 1) * DAY_MS);
    const events = rhythmTasks.length
      ? await prisma.taskEvent.findMany({
          where: {
            taskId: { in: rhythmTasks.map((t: ScoredTask) => t.id) },
            kind: "completed",
            createdAt: { gte: windowStart },
          },
          select: { taskId: true, createdAt: true },
        })
      : [];
    const daysByTask = new Map<string, Set<string>>();
    for (const e of events) {
      const key = toDateString(e.createdAt);
      if (!daysByTask.has(e.taskId)) daysByTask.set(e.taskId, new Set());
      daysByTask.get(e.taskId)!.add(key);
    }
    const todayKey = toDateString(now);
    rhythms = rhythmTasks
      .map((t: ScoredTask) => {
        const days = daysByTask.get(t.id) ?? new Set<string>();
        const doneToday =
          days.has(todayKey) ||
          (t.lastCompletedAt !== null && toDateString(new Date(t.lastCompletedAt)) === todayKey);
        return {
          id: t.id,
          title: t.title,
          loopKind: (t.loopKind ?? "DAILY").toUpperCase(),
          doneToday,
          windowDone: days.size,
          windowOf: RHYTHM_WINDOW_DAYS,
        };
      })
      .sort((a: DeckRhythm, b: DeckRhythm) => Number(a.doneToday) - Number(b.doneToday) || a.title.localeCompare(b.title));
  } catch {
    unmeasured.push("rhythm history");
    rhythms = rhythmTasks.map((t: ScoredTask) => ({
      id: t.id,
      title: t.title,
      loopKind: (t.loopKind ?? "DAILY").toUpperCase(),
      doneToday:
        t.lastCompletedAt !== null && toDateString(new Date(t.lastCompletedAt)) === toDateString(now),
      windowDone: 0,
      windowOf: 0,
    }));
  }

  // ── waiting / delegated (§10.8) ────────────────────────────────────
  const waiting: DeckWaitingRow[] = scored
    .filter((t: ScoredTask) => isBlocked(t) && t.status !== "DONE" && t.status !== "ARCHIVED")
    .map((t: ScoredTask) => ({
      id: t.id,
      title: t.title,
      waitingOn: (t.waitingOn as string).trim(),
      ageDays: daysBetween(t.updatedAt, now) ?? 0,
      delegatedToNick: (t.waitingOn as string).trim().toLowerCase() === "nick",
    }))
    .sort((a: DeckWaitingRow, b: DeckWaitingRow) => b.ageDays - a.ageDays);

  // ── evidence — done today, receipts not points (§10.9) ─────────────
  const doneToday = scored.filter(
    (t: ScoredTask) =>
      (t.status === "DONE" &&
        t.updatedAt !== null &&
        new Date(t.updatedAt).getTime() >= todayStart.getTime()) ||
      (isHabit(t) &&
        t.lastCompletedAt !== null &&
        new Date(t.lastCompletedAt).getTime() >= todayStart.getTime()),
  );
  const evidence = {
    rows: doneToday.slice(0, 10).map((t: ScoredTask) => ({
      id: t.id,
      title: t.title,
      missionTitle: titleOf(t.missionId),
    })),
    count: doneToday.length,
  };

  // ── readiness — dark cockpit, freshness-bounded (§10 header) ───────
  let readiness: DeckReadiness = { state: "unknown", line: "Health data unreadable.", measuredDaysAgo: null };
  try {
    const latestLog = await prisma.personalDailyLog.findFirst({
      orderBy: { logDate: "desc" },
      select: { logDate: true },
    });
    const age = latestLog ? (daysBetween(latestLog.logDate, now) ?? null) : null;
    if (age === null || age > READINESS_MAX_AGE_DAYS) {
      readiness = {
        state: "unknown",
        line:
          age === null
            ? "No health log yet — readiness unknown."
            : `Health data is ${age} day${age === 1 ? "" : "s"} old — readiness unknown.`,
        measuredDaysAgo: age,
      };
    } else {
      const decision = await getLatestGovernorDecision();
      if (!decision) {
        readiness = { state: "unknown", line: "Readiness could not be computed.", measuredDaysAgo: age };
      } else if (decision.mode === "STABLE" || decision.mode === "OPTIMIZED") {
        readiness = { state: "nominal", measuredDaysAgo: age };
      } else {
        const reason = decision.reasons?.[0] ?? decision.mode;
        readiness = { state: "exception", line: `${decision.mode.replace("_", " ")} — ${reason}`, measuredDaysAgo: age };
      }
    }
  } catch {
    unmeasured.push("readiness");
  }

  return {
    generatedAt: now.toISOString(),
    nextMove,
    capacity,
    triage,
    missions: deckMissions,
    missionSlotsOpen: Math.max(0, MISSION_WIP_CAP - deckMissions.length),
    lanes,
    rhythms,
    waiting,
    evidence,
    readiness,
    unmeasured,
  };
}
