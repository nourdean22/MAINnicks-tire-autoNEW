/**
 * Daily Scheduler — Auto-generates time-blocked schedule based on energy patterns.
 *
 * Uses Nour's known patterns:
 * - Morning (8-11): Adderall peak → MIT, deep work, hard decisions
 * - Late morning (11-12): Operations, callbacks, follow-ups
 * - Afternoon (1-4): Shop floor, customer interactions, lighter tasks
 * - Evening (5-7): Review only, no new commitments, planning for tomorrow
 *
 * Pulls: MIT from tasks, pending callbacks, stale leads, commitments due, weather
 */

import { prisma } from "@/lib/prisma";
import { today } from "@/lib/utils/datetime";
import { sendTelegram } from "@/lib/services/telegram";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface TimeBlock {
  time: string;
  duration: string;
  task: string;
  type: "deep_work" | "operations" | "communication" | "review" | "body";
  priority: "critical" | "high" | "medium";
}

export async function generateDailySchedule(): Promise<{
  date: string;
  blocks: TimeBlock[];
  summary: string;
}> {
  const dateStr = today();
  const blocks: TimeBlock[] = [];

  // v10.0.529.106 · Wave 58 · pre-Wave-58 `staleLeads` and
  // `pendingCallbacks` were `Promise.resolve(0)` so the late-morning
  // "clear communication queue" block never fired even when the
  // operator had pending callbacks. Now reads from the same
  // ceo_business_context auditEvent the bridge populates every 4h
  // (see lib/brain/pipeline-controller.ts:readCeoSnapshot).
  const ceoSnapshot = await prisma.auditEvent.findFirst({
    where: { eventType: "ceo_business_context" },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  }).catch(() => null);
  const ceoFresh = ceoSnapshot && (Date.now() - ceoSnapshot.createdAt.getTime() < 24 * 3600_000);
  const ceoPayload = (ceoFresh ? ceoSnapshot.payload : null) as Record<string, unknown> | null;
  const ceoFunnel = ceoPayload?.estimateLeadFunnel as Record<string, unknown> | undefined;
  const ceoLast7 = ceoFunnel?.last7d as Record<string, unknown> | undefined;
  const ceoCallbacks = ceoPayload?.callbacks as Record<string, unknown> | undefined;
  const toNum = (v: unknown) => typeof v === "number" ? v : Number(v) || 0;

  // Gather data
  const [topTasks, overdueCommitments, todayScore] = await Promise.all([
    // Apr 18: OpenLoop retired → Task. 2026-08-19: canonical polarity —
    // higher = more urgent (critical/high = autoPriority > 60).
    prisma.task
      .findMany({
        where: {
          status: { in: ["INBOX", "READY"] },
          autoPriority: { gt: 60 },
        },
        orderBy: [{ autoPriority: "desc" }, { createdAt: "desc" }],
        take: 3,
        select: { title: true, autoPriority: true },
      })
      .then((rows) =>
        rows.map((t) => ({
          title: t.title,
          priority: (t.autoPriority ?? 50) >= 80 ? "critical" : "high",
        })),
      ),
    prisma.commitment.findMany({
      where: { status: "active", deadline: { lt: dateStr }, deletedAt: null },
      take: 3,
    }),
    // v10.0.55 · todayScore replaced with identity_snapshot read so
    // the workout-block scheduler doesn't always think Nour skipped
    // his workout (the legacy null forced the workout block on every
    // day regardless of state).
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true, updatedAt: true, deletedAt: true },
      })
      .then((row) => {
        if (!row || row.deletedAt) return null;
        try {
          const parsed = JSON.parse(row.content) as { workoutDone?: boolean };
          return { workoutDone: !!parsed.workoutDone };
        } catch {
          return null;
        }
      })
      .catch((): null => null),
  ]);

  // ── MORNING PEAK (8:00-11:00) ──
  if (!todayScore?.workoutDone) {
    blocks.push({
      time: "7:30-8:15",
      duration: "45min",
      task: "Workout (Boxing/Gym) — body = business performance",
      type: "body",
      priority: "high",
    });
  }

  // MIT
  if (topTasks.length > 0) {
    blocks.push({
      time: "8:30-10:00",
      duration: "90min",
      task: `MIT: ${topTasks[0].title}`,
      type: "deep_work",
      priority: "critical",
    });
  }

  // Second priority task
  if (topTasks.length > 1) {
    blocks.push({
      time: "10:00-11:00",
      duration: "60min",
      task: topTasks[1].title,
      type: "deep_work",
      priority: "high",
    });
  }

  // ── LATE MORNING (11:00-12:00) ──
  const staleLeads = toNum(ceoLast7?.staleNewEstimates);
  const pendingCallbacks = toNum(ceoCallbacks?.new);
  if (staleLeads > 0 || pendingCallbacks > 0) {
    blocks.push({
      time: "11:00-11:30",
      duration: "30min",
      task: `Clear communication queue: ${staleLeads} stale leads, ${pendingCallbacks} callbacks`,
      type: "communication",
      priority: staleLeads > 2 ? "critical" : "high",
    });
  }

  if (overdueCommitments.length > 0) {
    blocks.push({
      time: "11:30-12:00",
      duration: "30min",
      task: `Resolve ${overdueCommitments.length} overdue commitments`,
      type: "operations",
      priority: "high",
    });
  }

  // ── AFTERNOON (1:00-4:00) ──
  blocks.push({
    time: "1:00-3:00",
    duration: "2hr",
    task: "Shop floor operations — customer interactions, quality checks",
    type: "operations",
    priority: "medium",
  });

  blocks.push({
    time: "3:00-4:00",
    duration: "1hr",
    task: "Estimate follow-ups + quote conversions",
    type: "communication",
    priority: "high",
  });

  // ── EVENING (5:00-6:00) ──
  blocks.push({
    time: "5:00-5:30",
    duration: "30min",
    task: "Daily score + journal entry — close the loop on today",
    type: "review",
    priority: "medium",
  });

  blocks.push({
    time: "5:30-6:00",
    duration: "30min",
    task: "Plan tomorrow — set MIT, check schedule, pre-load brain",
    type: "review",
    priority: "medium",
  });

  const summary = `${blocks.length} blocks planned. ${topTasks.length > 0 ? `MIT: ${topTasks[0].title}.` : "No critical tasks."} ${staleLeads > 0 ? `${staleLeads} leads need response.` : ""} ${overdueCommitments.length > 0 ? `${overdueCommitments.length} commitments overdue.` : ""}`.trim();

  return { date: dateStr, blocks, summary };
}

/**
 * Generate and push the daily schedule to Telegram.
 */
export async function pushDailySchedule(): Promise<void> {
  const schedule = await generateDailySchedule();

  const blockLines = schedule.blocks.map(b => {
    const emoji = b.type === "deep_work" ? "🧠" : b.type === "body" ? "💪" : b.type === "communication" ? "📞" : b.type === "review" ? "📝" : "⚙️";
    const priority = b.priority === "critical" ? "🔴" : b.priority === "high" ? "🟡" : "";
    return `${emoji} <b>${b.time}</b> — ${b.task} ${priority}`;
  });

  await sendTelegram(
    `📅 <b>Today's Schedule — ${schedule.date}</b>\n\n${blockLines.join("\n")}\n\n${schedule.summary}`
  );
}
