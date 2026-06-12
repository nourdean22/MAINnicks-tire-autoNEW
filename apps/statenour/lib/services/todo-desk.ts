/**
 * lib/services/todo-desk.ts · Phase B.6a (2026-05-22 ·
 * legacy-modernizer REST→tRPC ultron slice · operator-domain
 * sub-slice).
 *
 * The intelligent-under, simple-on-front data source for the TodoDesk
 * HQ card. Merges four surfaces into a ranked list so the UI can stay
 * minimal while the backend does the thinking:
 *
 *   - Active task (status=DOING) — always at top, with elapsed timer
 *   - Queue (status=READY / INBOX) — sharpest 4 ranked by window-fit
 *     + energy match + auto-priority + freshness
 *   - Aging backlog — inbox tasks aged > 5d + captures + drift alerts
 *   - Tomorrow preview — pre-queued items + MIT status
 *
 * Extracted from the inline route logic in
 * app/api/ultron/todo-desk/route.ts so BOTH the legacy REST route AND
 * the new `operator.todoDesk` tRPC procedure call the same
 * `buildTodoDesk` function · drift impossible. The `cached()` wrapper
 * lives inside `buildTodoDesk` so both transports share the 60s
 * window.
 */

import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

type WorkWindow = "deep" | "ops" | "review" | "rest";

export interface TaskLink {
  relationship: string;
  targetType: string;
  targetId: string;
  label: string;
  strength: number;
}

export interface DeskTask {
  id: string;
  title: string;
  status: string;
  effort: string;
  effortLabel: string;
  context: string;
  autoPriority: number | null;
  autoPriorityExplanation: string | null;
  missionTitle: string | null;
  missionDomain: string | null;
  startedAt: string | null;
  lastTouchedAt: string | null;
  agedDays: number;
  windowFit: boolean;
  energyMatch: boolean;
  isCommitment: boolean;
  elapsedMinutes: number | null;
  targetMinutes: number;
  predictedMinutes: number | null;
  realityGapPercent: number | null;
  links: TaskLink[];
}

export interface BacklogItem {
  kind: "task" | "capture" | "drift";
  id: string;
  title: string;
  detail: string;
  ageDays: number;
  severity: "info" | "warning" | "critical";
}

export interface TomorrowItem {
  id: string;
  title: string;
  effort: string;
}

export interface DeskPayload {
  window: { kind: WorkWindow; label: string };
  energyLevel: number | null;
  scoreLogged: boolean;
  active: DeskTask | null;
  queue: DeskTask[];
  backlog: BacklogItem[];
  tomorrow: {
    mitSet: boolean;
    mitText: string | null;
    tomorrowNote: { focus: string; avoid: string; anchor: string } | null;
    queued: TomorrowItem[];
  };
  counts: {
    aging: number;
    stale: number;
    parked: number;
    commitments: number;
  };
  momentum: {
    doneToday: number;
    streak: number;
  };
  generatedAt: string;
}

const EFFORT_LABEL: Record<string, string> = {
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H2PLUS: "2h+",
};
const EFFORT_MINUTES: Record<string, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2PLUS: 120,
};

function detectWindow(): { kind: WorkWindow; label: string } {
  const h = new Date().getHours();
  if (h >= 6 && h < 12) return { kind: "deep", label: "deep work window" };
  if (h >= 12 && h < 17) return { kind: "ops", label: "ops window" };
  if (h >= 17 && h < 22) return { kind: "review", label: "review window" };
  return { kind: "rest", label: "rest window" };
}

function effortFitsWindow(effort: string, w: WorkWindow): boolean {
  if (w === "deep") return effort === "H2PLUS" || effort === "H1";
  if (w === "ops")
    return effort === "M15" || effort === "M30" || effort === "H1";
  if (w === "review") return effort === "M5" || effort === "M15";
  return true; // rest — anything goes
}

/** Effort match against energy level 1-10. High energy → heavier. */
function effortMatchesEnergy(effort: string, energy: number | null): boolean {
  if (energy === null) return true;
  if (energy >= 7)
    return effort === "H2PLUS" || effort === "H1" || effort === "M30";
  if (energy >= 4)
    return effort === "M15" || effort === "M30" || effort === "H1";
  return effort === "M5" || effort === "M15";
}

function todayDateString(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}
function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Build the TodoDesk payload · cached 60s. Tasks mutate frequently
 * but the UI polls on focus so stale-while-revalidate is fine. Both
 * the REST route and the `operator.todoDesk` tRPC procedure call this.
 */
export async function buildTodoDesk(): Promise<DeskPayload> {
  return cached<DeskPayload>("ultron_todo_desk_v1", 60, async () => {
    const window = detectWindow();
    const todayStr = todayDateString();
    const tomorrowStr = tomorrowDateString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);

    // ── Parallel fetches ──
    const [
      tasks,
      dailyScore,
      activeCommitments,
      completedToday,
      completedForEffortBand,
      driftAlerts,
      captureItems,
      mitMemory,
      tomorrowNote,
      tomorrowQueued,
    ] = await Promise.all([
      prisma.task.findMany({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          status: true,
          effort: true,
          context: true,
          autoPriority: true,
          autoPriorityExplanation: true,
          startedAt: true,
          lastTouchedAt: true,
          energyRequired: true,
          actualMinutes: true,
          mission: { select: { title: true, domain: true } },
        },
      }),
      (async () => {
        const { recentScoreSnapshots } = await import(
          "@/lib/brain/legacy-shims"
        );
        const all = await recentScoreSnapshots(1);
        return all[0] ?? null;
      })(),
      prisma.commitment.findMany({
        where: {
          status: { in: ["active", "in_progress"] },
          deletedAt: null,
        },
        select: { description: true },
      }),
      prisma.task.count({
        where: {
          status: "DONE",
          deletedAt: null,
          updatedAt: { gte: todayStart },
        },
      }),
      prisma.brainMemory.findMany({
        where: {
          category: BRAIN_CATEGORIES.EFFORT_BAND_AVG,
          deletedAt: null,
        },
        select: { key: true, content: true },
      }),
      prisma.brainMemory.findMany({
        where: {
          category: BRAIN_CATEGORIES.COACH_EVENT,
          key: { startsWith: "coach:drift-recovery:" },
        },
        orderBy: { updatedAt: "asc" },
        take: 20,
        select: {
          key: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      }),
      prisma.captureInboxItem.findMany({
        where: { status: "active", triageStatus: "NEW" },
        orderBy: { capturedAt: "asc" },
        take: 5,
        select: {
          itemKey: true,
          title: true,
          actionabilityScore: true,
          capturedAt: true,
        },
      }),
      prisma.brainMemory.findUnique({
        where: {
          category_key: { category: BRAIN_CATEGORIES.MIT, key: todayStr },
        },
        select: { content: true },
      }),
      prisma.brainMemory
        .findUnique({
          where: {
            category_key: {
              category: BRAIN_CATEGORIES.TOMORROW_NOTE,
              key: tomorrowStr,
            },
          },
          select: { content: true },
        })
        .catch(() => null),
      prisma.task.findMany({
        where: {
          status: { in: ["INBOX", "READY"] },
          deletedAt: null,
          dueDate: {
            gte: new Date(`${tomorrowStr}T00:00:00`),
            lt: new Date(`${tomorrowStr}T23:59:59`),
          },
        },
        orderBy: { autoPriority: "asc" },
        take: 4,
        select: { id: true, title: true, effort: true },
      }),
    ]);

    // ── Read effort-band averages from BrainMemory ──
    const bandAvg: Record<string, number> = {};
    for (const m of completedForEffortBand) {
      try {
        const parsed = JSON.parse(m.content) as { avgMinutes?: number };
        if (typeof parsed.avgMinutes === "number") {
          bandAvg[m.key] = parsed.avgMinutes;
        }
      } catch {
        // malformed row — ignore
      }
    }

    // ── Build commitment lookup for lineage chip ──
    const commitmentWords = new Set<string>();
    for (const c of activeCommitments) {
      const words = c.description
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3)
        .slice(0, 4);
      for (const w of words) commitmentWords.add(w);
    }
    const isCommitmentLinked = (title: string): boolean => {
      const lower = title.toLowerCase();
      let hits = 0;
      for (const w of commitmentWords) {
        if (lower.includes(w)) hits++;
        if (hits >= 2) return true;
      }
      return false;
    };

    // ── Auto-linker edges ──
    const taskIds = tasks.map((t) => t.id);
    const rawEdges =
      taskIds.length > 0
        ? await prisma.memoryEdge
            .findMany({
              where: {
                OR: [
                  { sourceType: "task", sourceId: { in: taskIds } },
                  { targetType: "task", targetId: { in: taskIds } },
                ],
              },
              orderBy: { strength: "desc" },
              select: {
                sourceType: true,
                sourceId: true,
                targetType: true,
                targetId: true,
                relationship: true,
                strength: true,
                evidence: true,
              },
              take: 150,
            })
            .catch(() => [])
        : [];

    const otherRefs: Record<string, Set<string>> = {};
    for (const e of rawEdges) {
      const [otherType, otherId] =
        e.sourceType === "task" && taskIds.includes(e.sourceId)
          ? [e.targetType, e.targetId]
          : [e.sourceType, e.sourceId];
      (otherRefs[otherType] ??= new Set()).add(otherId);
    }

    const labelByKey = new Map<string, string>();
    const resolvers: Array<Promise<void>> = [];
    for (const [type, ids] of Object.entries(otherRefs)) {
      const idList = Array.from(ids);
      if (idList.length === 0) continue;
      if (type === "commitment") {
        const numIds = idList
          .map((i) => Number(i))
          .filter((n) => Number.isFinite(n));
        resolvers.push(
          prisma.commitment
            .findMany({
              where: { id: { in: numIds } },
              select: { id: true, description: true },
            })
            .then((rows) => {
              for (const r of rows)
                labelByKey.set(`${type}:${r.id}`, r.description.slice(0, 40));
            })
            .catch(() => {}),
        );
      } else if (type === "brain_dump") {
        resolvers.push(
          prisma.brainDump
            .findMany({
              where: { id: { in: idList } },
              select: { id: true, summary: true },
            })
            .then((rows) => {
              for (const r of rows) {
                const text = r.summary ?? "";
                labelByKey.set(`${type}:${r.id}`, text.slice(0, 40) || "dump");
              }
            })
            .catch(() => {}),
        );
      } else if (type === "reflection") {
        resolvers.push(
          prisma.reflection
            .findMany({
              where: { id: { in: idList } },
              select: { id: true, date: true, category: true },
            })
            .then((rows) => {
              for (const r of rows)
                labelByKey.set(
                  `${type}:${r.id}`,
                  `${r.category} · ${r.date}`,
                );
            })
            .catch(() => {}),
        );
      } else if (type === "mastery_decision") {
        const numIds = idList
          .map((i) => Number(i))
          .filter((n) => Number.isFinite(n));
        resolvers.push(
          prisma.masteryDecision
            .findMany({
              where: { id: { in: numIds } },
              select: { id: true, title: true },
            })
            .then((rows) => {
              for (const r of rows)
                labelByKey.set(`${type}:${r.id}`, r.title.slice(0, 40));
            })
            .catch(() => {}),
        );
      } else if (type === "task") {
        resolvers.push(
          prisma.task
            .findMany({
              where: { id: { in: idList } },
              select: { id: true, title: true },
            })
            .then((rows) => {
              for (const r of rows)
                labelByKey.set(`${type}:${r.id}`, r.title.slice(0, 40));
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(resolvers);

    const linksByTask: Record<string, TaskLink[]> = {};
    for (const e of rawEdges) {
      const [thisId, otherType, otherId] =
        e.sourceType === "task" && taskIds.includes(e.sourceId)
          ? [e.sourceId, e.targetType, e.targetId]
          : [e.targetId, e.sourceType, e.sourceId];
      const label = labelByKey.get(`${otherType}:${otherId}`) ?? otherType;
      const list = (linksByTask[thisId] ??= []);
      if (list.length < 3) {
        list.push({
          relationship: e.relationship,
          targetType: otherType,
          targetId: otherId,
          label,
          strength: e.strength,
        });
      }
    }

    // ── Sort tasks: DOING first, then composite score ──
    const energy = dailyScore?.energyLevel ?? null;
    const enriched = tasks.map((t) => {
      const agedMs = t.lastTouchedAt
        ? Date.now() - t.lastTouchedAt.getTime()
        : 0;
      const agedDays = Math.floor(agedMs / 86400000);
      const windowFit = effortFitsWindow(t.effort, window.kind);
      const energyMatch = effortMatchesEnergy(t.effort, energy);
      const targetMinutes = EFFORT_MINUTES[t.effort] ?? 30;
      const predictedMinutes = bandAvg[t.effort] ?? null;
      const elapsedMinutes = t.startedAt
        ? Math.max(0, Math.floor((Date.now() - t.startedAt.getTime()) / 60000))
        : null;
      const realityGapPercent =
        predictedMinutes !== null && predictedMinutes > 0
          ? Math.round(
              ((predictedMinutes - targetMinutes) / targetMinutes) * 100,
            )
          : null;
      return {
        id: t.id,
        title: t.title,
        status: t.status,
        effort: t.effort,
        effortLabel: EFFORT_LABEL[t.effort] ?? t.effort,
        context: t.context,
        autoPriority: t.autoPriority,
        autoPriorityExplanation: t.autoPriorityExplanation,
        missionTitle: t.mission?.title ?? null,
        missionDomain: t.mission?.domain ?? null,
        startedAt: t.startedAt?.toISOString() ?? null,
        lastTouchedAt: t.lastTouchedAt?.toISOString() ?? null,
        agedDays,
        windowFit,
        energyMatch,
        isCommitment: isCommitmentLinked(t.title),
        elapsedMinutes,
        targetMinutes,
        predictedMinutes,
        realityGapPercent,
        links: linksByTask[t.id] ?? [],
      } satisfies DeskTask;
    });

    // Composite ranking score — lower is better (like autoPriority).
    function rank(t: (typeof enriched)[number]): number {
      const base = t.autoPriority ?? 50;
      let score = base;
      if (t.windowFit) score -= 10;
      if (t.energyMatch) score -= 8;
      if (t.isCommitment) score -= 12;
      if (t.agedDays >= 10) score += 5;
      if (t.agedDays >= 30) score += 10;
      return score;
    }

    const activeTask = enriched.find((t) => t.status === "DOING") ?? null;
    const queueable = enriched
      .filter((t) => t.id !== activeTask?.id && t.status !== "DOING")
      .sort((a, b) => rank(a) - rank(b));

    // Queue = top 4 that are NOT aged > 10d (aged stuff goes to backlog)
    const freshQueue = queueable.filter((t) => t.agedDays < 10).slice(0, 4);

    // ── Backlog items: aging tasks + drift + captures ──
    const backlog: BacklogItem[] = [];
    const agingTasks = queueable.filter(
      (t) => t.agedDays >= 5 && t.agedDays < 30,
    );
    for (const t of agingTasks.slice(0, 2)) {
      backlog.push({
        kind: "task",
        id: t.id,
        title: t.title,
        detail: `aged ${t.agedDays}d · ${t.effortLabel}`,
        ageDays: t.agedDays,
        severity: t.agedDays >= 10 ? "warning" : "info",
      });
    }
    const activeDrifts = driftAlerts
      .filter((d) => {
        const meta = (d.metadata ?? {}) as Record<string, unknown>;
        return !meta.ackedAt;
      })
      .map((d) => {
        const meta = (d.metadata ?? {}) as Record<string, unknown>;
        const severity = meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "high" : "warning";
        return {
          id: d.key,
          ruleName: d.content,
          severity,
          message: typeof meta.body === "string" ? meta.body : "",
          createdAt: d.createdAt,
        };
      });

    for (const a of activeDrifts.slice(0, 2)) {
      const ageDays = Math.floor(
        (Date.now() - a.createdAt.getTime()) / 86400000,
      );
      backlog.push({
        kind: "drift",
        id: a.id,
        title: a.ruleName,
        detail: a.message.slice(0, 80),
        ageDays,
        severity:
          a.severity === "critical" || a.severity === "high"
            ? "warning"
            : "info",
      });
    }
    for (const c of captureItems.slice(0, 2)) {
      const ageDays = Math.floor(
        (Date.now() - c.capturedAt.getTime()) / 86400000,
      );
      backlog.push({
        kind: "capture",
        id: c.itemKey,
        title: c.title,
        detail: `captured ${ageDays}d · actionability ${c.actionabilityScore}`,
        ageDays,
        severity: "info",
      });
    }

    // ── Tomorrow preview ──
    let tomorrowNoteParsed: {
      focus: string;
      avoid: string;
      anchor: string;
    } | null = null;
    if (tomorrowNote?.content) {
      try {
        const parsed = JSON.parse(tomorrowNote.content);
        if (parsed.focus)
          tomorrowNoteParsed = {
            focus: String(parsed.focus),
            avoid: String(parsed.avoid ?? ""),
            anchor: String(parsed.anchor ?? ""),
          };
      } catch {
        tomorrowNoteParsed = {
          focus: tomorrowNote.content.slice(0, 100),
          avoid: "",
          anchor: "",
        };
      }
    }

    // ── Counts for the footer strip ──
    const agingCount = queueable.filter(
      (t) => t.agedDays >= 5 && t.agedDays < 30,
    ).length;
    const staleCount = queueable.filter(
      (t) => t.agedDays >= 10 && t.agedDays < 30,
    ).length;
    const parkedCount = await prisma.task.count({
      where: { status: "ARCHIVED", updatedAt: { gte: thirtyDaysAgo } },
    });
    const commitmentCount = enriched.filter((t) => t.isCommitment).length;

    // ── Momentum streak ──
    const recentCompletions = await prisma.task.findMany({
      where: {
        status: "DONE",
        deletedAt: null,
        updatedAt: { gte: sevenDaysAgo },
      },
      select: { updatedAt: true },
    });
    const completionDays = new Set(
      recentCompletions.map((c) =>
        c.updatedAt.toLocaleDateString("en-CA", {
          timeZone: "America/New_York",
        }),
      ),
    );
    let streak = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
      if (completionDays.has(ds)) streak++;
      else if (i === 0) continue; // today-in-progress grace
      else break;
    }

    return {
      window,
      energyLevel: energy,
      scoreLogged: !!dailyScore,
      active: activeTask,
      queue: freshQueue,
      backlog: backlog.slice(0, 3),
      tomorrow: {
        mitSet: !!mitMemory,
        mitText: mitMemory?.content.slice(0, 120) ?? null,
        tomorrowNote: tomorrowNoteParsed,
        queued: tomorrowQueued.map((t) => ({
          id: t.id,
          title: t.title,
          effort: EFFORT_LABEL[t.effort] ?? t.effort,
        })),
      },
      counts: {
        aging: agingCount,
        stale: staleCount,
        parked: parkedCount,
        commitments: commitmentCount,
      },
      momentum: {
        doneToday: completedToday,
        streak,
      },
      generatedAt: new Date().toISOString(),
    };
  });
}
