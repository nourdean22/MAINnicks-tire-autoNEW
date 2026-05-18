// CP7 · force-dynamic · Railway build cannot reach Neon during static
// prerender. Runtime semantics unchanged (cached() makes these effectively
// dynamic on Vercel too).
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cached } from "@/lib/utils/cache";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/**
 * GET /api/ultron/todo-desk
 *
 * The intelligent-under, simple-on-front data source for the TodoDesk
 * HQ card. Merges four surfaces into a ranked list so the UI can stay
 * minimal while the backend does the thinking:
 *
 *   - Active task (status=DOING) — always at top, with elapsed timer
 *   - Queue (status=READY / INBOX) — sharpest 4 ranked by window-fit
 *     + energy match + auto-priority + freshness
 *   - Aging backlog — inbox tasks aged > 5d, capture inbox items, and
 *     unresolved drift alerts merged inline (up to 3)
 *   - Tomorrow preview — pre-queued items already slotted for tomorrow
 *     plus MIT status
 *
 * Smart layer:
 *   • Window fit — time of day determines which effort bands bubble.
 *     Deep-work window favors H2PLUS/H1, ops window favors M30/M15,
 *     review window favors M5.
 *   • Energy match — pulls today's DailyScore (if logged); high energy
 *     surfaces H-tier, low surfaces M-tier. Falls back to window when
 *     no score logged.
 *   • Aged handling — inbox tasks >= 5d get "aging" flag; >= 10d get
 *     "stale" warning; >= 30d get auto-parked by the backlog-triage
 *     cron (see app/api/cron/backlog-triage).
 *   • Reality gap — for recently completed tasks, the est vs actual
 *     diff travels through so the UI can render the learning chip.
 *   • Commitment lineage — tasks whose title mentions an active
 *     Commitment get a `commitment` flag so the UI can surface the ⚖
 *     chip and promote them.
 *
 * Response is scoped to keep the hot path under 400ms — single
 * Prisma query per surface, no N+1.
 *
 * Cache 60s. Tasks mutate frequently but the UI polls on focus so
 * stale-while-revalidate is fine.
 */

export const revalidate = 60;

type WorkWindow = "deep" | "ops" | "review" | "rest";

interface TaskLink {
  /** One of "relates_to" | "caused_by" | anything auto-linker writes. */
  relationship: string;
  targetType: string;
  targetId: string;
  /** Human-readable label. The desk UI renders this as a small chip. */
  label: string;
  strength: number;
}

interface DeskTask {
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
  /** Auto-linker MemoryEdge rows — up to 3 chips rendered per task. */
  links: TaskLink[];
}

interface BacklogItem {
  kind: "task" | "capture" | "drift";
  id: string;
  title: string;
  detail: string;
  ageDays: number;
  severity: "info" | "warning" | "critical";
}

interface TomorrowItem {
  id: string;
  title: string;
  effort: string;
}

interface DeskPayload {
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
  if (w === "ops") return effort === "M15" || effort === "M30" || effort === "H1";
  if (w === "review") return effort === "M5" || effort === "M15";
  return true; // rest — anything goes
}

/** Effort match against energy level 1-10. High energy → heavier. */
function effortMatchesEnergy(effort: string, energy: number | null): boolean {
  if (energy === null) return true;
  if (energy >= 7) return effort === "H2PLUS" || effort === "H1" || effort === "M30";
  if (energy >= 4) return effort === "M15" || effort === "M30" || effort === "H1";
  return effort === "M5" || effort === "M15";
}

function todayDateString(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function tomorrowDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function GET() {
  try {
    const payload = await cached<DeskPayload>("ultron_todo_desk_v1", 60, async () => {
      const window = detectWindow();
      const todayStr = todayDateString();
      const tomorrowStr = tomorrowDateString();
      const fiveDaysAgo = new Date(Date.now() - 5 * 86400000);
      const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
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
        // All active + queued tasks. INBOX + READY + DOING.
        // v8.24 · soft-delete retrofit on TodoDesk source-of-truth.
        // Without these filters, soft-deleted tasks/commitments/memories
        // would resurface on the HQ surface.
        prisma.task.findMany({
          where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
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
        // v10.0.60 · Wave A part 3 · todayScore lookup via legacy-shim.
        (async () => {
          const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
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
          where: { status: "DONE", deletedAt: null, updatedAt: { gte: todayStart } },
        }),
        // Reality-gap band averages. Source of truth is now the
        // persistent BrainMemory rows written by /api/tasks/[id]/check
        // on each DONE. Falls back to an empty set if the writeback
        // hasn't run yet (fresh install / no completions).
        prisma.brainMemory.findMany({
          where: { category: BRAIN_CATEGORIES.EFFORT_BAND_AVG, deletedAt: null },
          select: { key: true, content: true },
        }),
        prisma.driftAlert.findMany({
          where: { resolved: false },
          orderBy: { createdAt: "asc" },
          take: 5,
          select: { id: true, ruleName: true, severity: true, message: true, createdAt: true },
        }),
        prisma.captureInboxItem.findMany({
          where: { status: "active", triageStatus: "NEW" },
          orderBy: { capturedAt: "asc" },
          take: 5,
          select: { itemKey: true, title: true, actionabilityScore: true, capturedAt: true },
        }),
        prisma.brainMemory.findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.MIT, key: todayStr } },
          select: { content: true },
        }),
        prisma.brainMemory.findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.TOMORROW_NOTE, key: tomorrowStr } },
          select: { content: true },
        }).catch(() => null),
        // Tasks explicitly queued for tomorrow via dueDate
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

      // ── Read effort-band averages from BrainMemory (reality-gap
      //    writeback). Each row stores the rolling avg for a single
      //    band so lookup is O(1) per desk fetch. ──
      const bandAvg: Record<string, number> = {};
      for (const m of completedForEffortBand) {
        try {
          const parsed = JSON.parse(m.content) as { avgMinutes?: number };
          if (typeof parsed.avgMinutes === "number") {
            bandAvg[m.key] = parsed.avgMinutes;
          }
        } catch {
          // malformed row — ignore; next completion will overwrite
        }
      }

      // ── Build commitment lookup for lineage chip ──
      const commitmentWords = new Set<string>();
      for (const c of activeCommitments) {
        // Extract first 4 significant words (length > 3) for matching
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
      // Fetch MemoryEdge rows where this task is either the source or
      // target. The auto-linker cron writes these nightly — relates_to
      // + caused_by — so every surfaced task can expose 2-3 chips that
      // point to the commitments / decisions / reflections it's tied to.
      const taskIds = tasks.map((t) => t.id);
      const rawEdges = taskIds.length > 0
        ? await prisma.memoryEdge.findMany({
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
          }).catch(() => [])
        : [];

      // Build a map taskId → TaskLink[] (up to 3 per task). We also need
      // to resolve the "other side" row's title for the chip label —
      // commitments by description, brain dumps by summary, reflections
      // by date+scope. One more batch query per source type, keyed by id.
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
          const numIds = idList.map((i) => Number(i)).filter((n) => Number.isFinite(n));
          resolvers.push(
            prisma.commitment
              .findMany({ where: { id: { in: numIds } }, select: { id: true, description: true } })
              .then((rows) => {
                for (const r of rows) labelByKey.set(`${type}:${r.id}`, r.description.slice(0, 40));
              })
              .catch(() => {}),
          );
        } else if (type === "brain_dump") {
          resolvers.push(
            prisma.brainDump
              .findMany({ where: { id: { in: idList } }, select: { id: true, summary: true } })
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
              .findMany({ where: { id: { in: idList } }, select: { id: true, date: true, category: true } })
              .then((rows) => {
                for (const r of rows) labelByKey.set(`${type}:${r.id}`, `${r.category} · ${r.date}`);
              })
              .catch(() => {}),
          );
        } else if (type === "mastery_decision") {
          const numIds = idList.map((i) => Number(i)).filter((n) => Number.isFinite(n));
          resolvers.push(
            prisma.masteryDecision
              .findMany({ where: { id: { in: numIds } }, select: { id: true, title: true } })
              .then((rows) => {
                for (const r of rows) labelByKey.set(`${type}:${r.id}`, r.title.slice(0, 40));
              })
              .catch(() => {}),
          );
        } else if (type === "task") {
          resolvers.push(
            prisma.task
              .findMany({ where: { id: { in: idList } }, select: { id: true, title: true } })
              .then((rows) => {
                for (const r of rows) labelByKey.set(`${type}:${r.id}`, r.title.slice(0, 40));
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
            ? Math.round(((predictedMinutes - targetMinutes) / targetMinutes) * 100)
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
      // Weights: autoPriority (0-100) → base
      //          windowFit     → -10 if true
      //          energyMatch   → -8 if true
      //          isCommitment  → -12 if true (commitments get priority)
      //          aged          → +5 per 10 days aged (so ancient stuff
      //                          surfaces so Nour can kill it, but
      //                          doesn't dominate the top)
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
      const agingTasks = queueable.filter((t) => t.agedDays >= 5 && t.agedDays < 30);
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
      for (const a of driftAlerts.slice(0, 2)) {
        const ageDays = Math.floor((Date.now() - a.createdAt.getTime()) / 86400000);
        backlog.push({
          kind: "drift",
          id: String(a.id),
          title: a.ruleName,
          detail: a.message.slice(0, 80),
          ageDays,
          severity: a.severity === "critical" || a.severity === "high" ? "warning" : "info",
        });
      }
      for (const c of captureItems.slice(0, 2)) {
        const ageDays = Math.floor((Date.now() - c.capturedAt.getTime()) / 86400000);
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
      let tomorrowNoteParsed: { focus: string; avoid: string; anchor: string } | null = null;
      if (tomorrowNote?.content) {
        try {
          const parsed = JSON.parse(tomorrowNote.content);
          if (parsed.focus) tomorrowNoteParsed = {
            focus: String(parsed.focus),
            avoid: String(parsed.avoid ?? ""),
            anchor: String(parsed.anchor ?? ""),
          };
        } catch {
          // Not JSON — treat as plain focus text
          tomorrowNoteParsed = { focus: tomorrowNote.content.slice(0, 100), avoid: "", anchor: "" };
        }
      }

      // ── Counts for the footer strip ──
      const agingCount = queueable.filter((t) => t.agedDays >= 5 && t.agedDays < 30).length;
      const staleCount = queueable.filter((t) => t.agedDays >= 10 && t.agedDays < 30).length;
      const parkedCount = await prisma.task.count({
        where: { status: "ARCHIVED", updatedAt: { gte: thirtyDaysAgo } },
      });
      const commitmentCount = enriched.filter((t) => t.isCommitment).length;

      // ── Momentum streak ──
      // Consecutive days with ≥1 completed task, looking back from today
      const recentCompletions = await prisma.task.findMany({
        where: { status: "DONE", deletedAt: null, updatedAt: { gte: sevenDaysAgo } },
        select: { updatedAt: true },
      });
      const completionDays = new Set(
        recentCompletions.map((c) =>
          c.updatedAt.toLocaleDateString("en-CA", { timeZone: "America/New_York" })
        )
      );
      let streak = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

    return NextResponse.json({ data: payload });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 }
    );
  }
}
