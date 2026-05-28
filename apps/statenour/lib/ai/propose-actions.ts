/**
 * propose-actions · Wave AG · 2026-05-28.
 *
 * The proposer. Reads operator state across the OS and emits a
 * ranked list of 3-6 candidate `NickActionDraft` rows that the 8am
 * `nick-action-proposal` cron writes as AutonomousAction(approval=
 * "pending") rows, then pushes to Telegram for one-tap approval.
 *
 * Deterministic by design. No AI call in v1 — every candidate falls
 * out of a database query the OS already keeps fresh. Adding AI
 * later (e.g. for SMS body drafting on `send_sms_outreach`) is a
 * surgical edit at the executor, not here.
 *
 * Source signals ·
 *   1. `archive_mission`     · COMPLETE/KILLED missions w/ all-DONE tasks
 *   2. `nudge_task`          · DOING tasks past dueDate
 *   3. `commit_journal`      · yesterday's brain_dumps without a Journal entry
 *   4. `send_sms_outreach`   · today's top relationship pick from cache
 *   5. `reassign_task`       · stale INBOX tasks > 14d old in m-inbox
 *
 * Ranking · P0 (urgent / safety) > P1 (compounding) > P2 (hygiene).
 * Caps at 6 to keep the Telegram message scannable.
 *
 * Per kaizen + karpathy · the simplest thing that delivers operator
 * leverage. No new tables. No AI roundtrip. Idempotency lives at the
 * cron layer (one batch per day · re-fires skip).
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export type NickActionType =
  | "archive_mission"
  | "nudge_task"
  | "commit_journal"
  | "send_sms_outreach"
  | "reassign_task"
  | "confirm_spend";

export type NickActionTarget =
  | "mission"
  | "task"
  | "person"
  | "brain_dump"
  | "ai_cost";

export type NickActionPriority = "P0" | "P1" | "P2";

export interface NickActionDraft {
  /** Stable rule slug for telemetry · "nick_action_archive_mission" etc. */
  ruleName: string;
  /** Human-readable "what triggered this" · 1 line. */
  trigger: string;
  /** Action class · the executor dispatches on this. */
  actionType: NickActionType;
  /** Target row type · informs the executor's lookup. */
  targetType: NickActionTarget;
  /** Target row id · the entity being acted on. */
  targetId: string;
  /** Action params · executor-specific Json shape. */
  payload: Record<string, unknown>;
  /** 1-line Nick rationale rendered in Telegram + /system/approvals. */
  rationale: string;
  /** Ranking signal · P0 first. */
  priority: NickActionPriority;
}

const PRIORITY_ORDER: Record<NickActionPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

const MAX_ACTIONS = 6;
const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Build today's Nick Action Queue draft list. Returns up to 6 ranked
 * candidates · the cron writes each as an AutonomousAction(approval=
 * "pending") row.
 */
export async function proposeNickActions(
  today: string = new Date().toISOString().slice(0, 10),
): Promise<NickActionDraft[]> {
  // Each source is best-effort · one bad source must not blank the queue.
  const [archives, nudges, journalCommits, outreach, reassigns] =
    await Promise.all([
      archiveMissionCandidates().catch(() => []),
      nudgeTaskCandidates().catch(() => []),
      commitJournalCandidates().catch(() => []),
      outreachCandidate(today).catch(() => []),
      reassignTaskCandidates().catch(() => []),
    ]);

  const all = [
    ...archives,
    ...nudges,
    ...journalCommits,
    ...outreach,
    ...reassigns,
  ];

  // Rank P0 → P1 → P2; preserve insertion order within priority for
  // a deterministic morning ordering (same operator state = same queue).
  all.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  return all.slice(0, MAX_ACTIONS);
}

// ── Source 1: archive_mission ──────────────────────────────────────
//
// Mission rows where status=ACTIVE + every task is DONE/CANCELLED.
// Operator-grade signal · the mission is done in practice but still
// occupies a slot in the /missions list. Nick proposes to close it.

async function archiveMissionCandidates(): Promise<NickActionDraft[]> {
  const missions = await prisma.mission.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      tasks: {
        where: { deletedAt: null },
        select: { id: true, status: true },
      },
    },
    take: 30,
  });

  const drafts: NickActionDraft[] = [];

  for (const m of missions) {
    if (m.tasks.length === 0) continue; // skip empty missions
    const allClosed = m.tasks.every(
      (t) => t.status === "DONE" || t.status === "ARCHIVED",
    );
    if (!allClosed) continue;
    drafts.push({
      ruleName: "nick_action_archive_mission",
      trigger: `mission "${m.title.slice(0, 60)}" · ${m.tasks.length} tasks all closed`,
      actionType: "archive_mission",
      targetType: "mission",
      targetId: m.id,
      payload: {
        missionTitle: m.title,
        closedTaskCount: m.tasks.length,
      },
      rationale: `All ${m.tasks.length} tasks closed · mission stays open until you say so`,
      priority: "P2",
    });
  }

  return drafts.slice(0, 2); // cap source contribution
}

// ── Source 2: nudge_task ───────────────────────────────────────────
//
// DOING tasks whose dueDate is in the past. Either (a) move to DONE
// because the operator forgot to close, or (b) split / re-plan. The
// nudge surfaces the row · the operator decides which.

async function nudgeTaskCandidates(): Promise<NickActionDraft[]> {
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: {
      status: "DOING",
      deletedAt: null,
      dueDate: { lt: now },
    },
    orderBy: { dueDate: "asc" },
    take: 5,
    select: {
      id: true,
      title: true,
      dueDate: true,
      mission: { select: { id: true, title: true } },
    },
  });

  return tasks.map<NickActionDraft>((t) => {
    const days = t.dueDate
      ? Math.max(1, Math.floor((now.getTime() - t.dueDate.getTime()) / DAY_MS))
      : 0;
    return {
      ruleName: "nick_action_nudge_task",
      trigger: `task "${t.title.slice(0, 60)}" · ${days}d overdue`,
      actionType: "nudge_task",
      targetType: "task",
      targetId: t.id,
      payload: {
        taskTitle: t.title,
        missionId: t.mission.id,
        missionTitle: t.mission.title,
        daysOverdue: days,
      },
      rationale: `In flight ${days}d past due · approve to bump status READY + log a "needs decision" journal note`,
      priority: days > 7 ? "P0" : "P1",
    };
  });
}

// ── Source 3: commit_journal ───────────────────────────────────────
//
// Yesterday's BrainDump rows that never got promoted to a Journal
// entry. Operator dumped, intent was unclear at the time, but a 1-
// liner commit makes the dump retrievable + closes the loop.

async function commitJournalCandidates(): Promise<NickActionDraft[]> {
  const yesterday = new Date(Date.now() - DAY_MS);
  const startOfYesterday = new Date(
    yesterday.getFullYear(),
    yesterday.getMonth(),
    yesterday.getDate(),
  );
  const endOfYesterday = new Date(startOfYesterday.getTime() + DAY_MS);

  const dumps = await prisma.brainDump.findMany({
    where: {
      createdAt: { gte: startOfYesterday, lt: endOfYesterday },
      // committed brain_dumps already linked to a journal carry a
      // `summary` populated by the ingest pipeline · uncommitted ones
      // have raw thoughts only.
      summary: null,
    },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, rawThoughts: true, createdAt: true },
  });

  return dumps.map<NickActionDraft>((d) => ({
    ruleName: "nick_action_commit_journal",
    trigger: `brain dump from ${d.createdAt.toISOString().slice(0, 10)} · not yet committed`,
    actionType: "commit_journal",
    targetType: "brain_dump",
    targetId: d.id,
    payload: {
      preview: d.rawThoughts.slice(0, 240),
      dumpedAt: d.createdAt.toISOString(),
    },
    rationale: `Approve to ingest as a Journal entry · extracts tasks + commitments + insights`,
    priority: "P1",
  }));
}

// ── Source 4: send_sms_outreach ────────────────────────────────────
//
// Top relationship pick from today's cache (written by the Wave AB
// /api/ai/relationships-pick-today endpoint). Nick proposes the
// outreach as a one-tap · the executor drafts the SMS body + queues
// via the shop SMS bridge (out-of-process · nickstire).

async function outreachCandidate(today: string): Promise<NickActionDraft[]> {
  const cached = await prisma.brainMemory.findFirst({
    where: {
      category: BRAIN_CATEGORIES.RELATIONSHIPS_PICKS_TODAY,
      key: today,
    },
    select: { metadata: true },
  });
  if (!cached?.metadata) return [];
  const meta = cached.metadata as Record<string, unknown>;
  const picks = meta.picks as
    | Array<{ personId: string; personName: string; rationale: string }>
    | undefined;
  if (!picks || picks.length === 0) return [];

  const top = picks[0];
  // Guard against the picks array carrying a partial/synthetic row.
  if (!top.personId || !top.personName) return [];

  return [
    {
      ruleName: "nick_action_outreach_top_pick",
      trigger: `today's top relationship pick · ${top.personName}`,
      actionType: "send_sms_outreach",
      targetType: "person",
      targetId: top.personId,
      payload: {
        personName: top.personName,
        rationale: top.rationale,
      },
      rationale: `${top.rationale.slice(0, 140)} · approve to draft + send via shop SMS`,
      priority: "P1",
    },
  ];
}

// ── Source 5: reassign_task ────────────────────────────────────────
//
// INBOX tasks that have lived in the inbox > 14d. Either they need a
// real mission home or they're abandoned. Nick proposes a reassign so
// the operator's review is one tap not a redirect dance.

async function reassignTaskCandidates(): Promise<NickActionDraft[]> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * DAY_MS);
  const tasks = await prisma.task.findMany({
    where: {
      status: "INBOX",
      deletedAt: null,
      createdAt: { lt: fourteenDaysAgo },
    },
    orderBy: { createdAt: "asc" },
    take: 5,
    select: {
      id: true,
      title: true,
      createdAt: true,
      mission: { select: { id: true, title: true } },
    },
  });

  // Skip when the inbox is healthy — < 3 stale rows is normal triage churn.
  if (tasks.length < 3) return [];

  // Surface the oldest one as the candidate (operator can use it as a
  // proxy for "go reset my inbox").
  const oldest = tasks[0];
  const days = Math.floor(
    (Date.now() - oldest.createdAt.getTime()) / DAY_MS,
  );
  return [
    {
      ruleName: "nick_action_reassign_inbox",
      trigger: `inbox has ${tasks.length} tasks > 14d old · oldest ${days}d`,
      actionType: "reassign_task",
      targetType: "task",
      targetId: oldest.id,
      payload: {
        taskTitle: oldest.title,
        currentMissionId: oldest.mission.id,
        currentMissionTitle: oldest.mission.title,
        staleCount: tasks.length,
        oldestDays: days,
      },
      rationale: `Approve to mark stale · sets status WAITING with a 7-day snooze so it auto-resurfaces`,
      priority: "P2",
    },
  ];
}
