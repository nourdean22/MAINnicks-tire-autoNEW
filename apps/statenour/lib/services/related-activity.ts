/**
 * relatedActivity: everything NOUR OS already logged about one goal, mission or person, in one read
 * (job 2026-11-02-nour-os-interconnect W1; plan in docs/plans/nour-os-interconnect/01-...md section 5).
 *
 * A saved query over the event tables that exist (Tana T1), never a copy and never a new table.
 * A goal also reaches tasks through their mission's lifeGoalId when the task has no goalId of its
 * own (Linear L1, inherited at read time, no backfill). Each table is its own read: one that fails
 * is named in `failed`, so a broken read never renders as "nothing happened" (empty-vs-error).
 * Person rows are read by id only; the person profile (phone, email) is never touched.
 *
 * Consumers: Nick's getRelated tool (lib/ai/tools/goals.ts); the goal card, Home and missions page
 * waves read the same signature.
 */
import { prisma } from "@/lib/prisma";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";

/** The caps, set once here; tools read them, never copy them. */
export const RELATED_MAX_ITEMS = 50;
export const RELATED_MAX_DAYS = 90;
export const RELATED_DEFAULT_DAYS = 14;

const DAY_MS = 86_400_000;

export type RelatedKind =
  | "goal_event"
  | "task_event"
  | "task"
  | "journal"
  | "reflection"
  | "situation"
  | "decision"
  | "contact"
  | "chat";

export interface RelatedItem {
  at: Date;
  kind: RelatedKind;
  source: string;
  title: string;
  ref: { table: string; id: string };
}

export interface RelatedKey {
  goalId?: string;
  missionId?: string;
  personId?: string;
}

export interface RelatedActivityResult {
  items: RelatedItem[];
  /** Names of the reads that threw. Their rows are missing, not zero. */
  failed: string[];
}

const clip = (s: string | null | undefined, n = 120) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
};

function goalEventTitle(kind: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === "check_in") {
    const note = typeof p.note === "string" && p.note.trim() ? ` - ${clip(p.note, 80)}` : "";
    return `check-in: ${String(p.health ?? "unknown")}${note}`;
  }
  if (kind === "progress_logged" && typeof p.delta === "number") return `progress ${p.delta >= 0 ? "+" : ""}${p.delta}`;
  return kind.replace(/_/g, " ");
}

type Read = { name: string; run: () => Promise<RelatedItem[]> };

export async function relatedActivity(
  key: RelatedKey,
  opts: { since?: Date; limit?: number } = {},
): Promise<RelatedActivityResult> {
  const { goalId, missionId, personId } = key;
  if (!goalId && !missionId && !personId) {
    throw new Error("relatedActivity needs a goalId, missionId or personId");
  }
  const take = Math.max(1, Math.min(RELATED_MAX_ITEMS, Math.floor(opts.limit ?? RELATED_MAX_ITEMS)));
  const floor = new Date(Date.now() - RELATED_MAX_DAYS * DAY_MS);
  const since = opts.since && opts.since > floor ? opts.since : floor;
  const created = { createdAt: { gte: since } };
  const desc = { orderBy: { createdAt: "desc" as const }, take };

  const reads: Read[] = [];

  // Journal tables carry goalId and missionId both; one read per (table, key).
  const journal = (field: "goalId" | "missionId", id: string): Read[] => [
    {
      name: "journal",
      run: async () =>
        (await prisma.brainDump.findMany({
          where: { [field]: id, deletedAt: null, ...created },
          select: { id: true, summary: true, rawThoughts: true, createdAt: true },
          ...desc,
        })).map((r) => ({ at: r.createdAt, kind: "journal", source: "journal", title: clip(r.summary || r.rawThoughts), ref: { table: "BrainDump", id: r.id } })),
    },
    {
      name: "reflection",
      run: async () =>
        (await prisma.reflection.findMany({
          where: { [field]: id, deletedAt: null, ...created },
          select: { id: true, insight: true, createdAt: true },
          ...desc,
        })).map((r) => ({ at: r.createdAt, kind: "reflection", source: "reflection", title: clip(r.insight), ref: { table: "Reflection", id: r.id } })),
    },
    {
      name: "situation",
      run: async () =>
        (await prisma.situationLog.findMany({
          where: { [field]: id, ...created },
          select: { id: true, situation: true, createdAt: true },
          ...desc,
        })).map((r) => ({ at: r.createdAt, kind: "situation", source: "situation log", title: clip(r.situation), ref: { table: "SituationLog", id: r.id } })),
    },
    {
      name: "decision",
      run: async () =>
        (await prisma.decisionReplay.findMany({
          where: { [field]: id, ...created },
          select: { id: true, title: true, createdAt: true },
          ...desc,
        })).map((r) => ({ at: r.createdAt, kind: "decision", source: "decision", title: clip(r.title), ref: { table: "DecisionReplay", id: r.id } })),
    },
  ];

  const tasks = (where: Record<string, unknown>, source: (goalId: string | null) => string): Read => ({
    name: "task",
    run: async () =>
      (await prisma.task.findMany({
        where: { ...where, deletedAt: null, updatedAt: { gte: since } },
        select: { id: true, title: true, status: true, goalId: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take,
      })).map((t) => ({ at: t.updatedAt, kind: "task", source: source(t.goalId), title: `${clip(t.title, 100)} (${t.status})`, ref: { table: "Task", id: t.id } })),
  });

  if (goalId) {
    reads.push(
      {
        name: "goal_event",
        run: async () =>
          (await prisma.goalEvent.findMany({
            where: { goalId, ...created },
            select: { id: true, kind: true, payload: true, createdAt: true },
            ...desc,
          })).map((e) => ({ at: e.createdAt, kind: "goal_event", source: "goal", title: goalEventTitle(e.kind, e.payload), ref: { table: "GoalEvent", id: e.id } })),
      },
      {
        name: "task_event",
        run: async () =>
          (await prisma.taskEvent.findMany({
            where: { goalId, ...created },
            select: { id: true, kind: true, createdAt: true, task: { select: { title: true } } },
            ...desc,
          })).map((e) => ({ at: e.createdAt, kind: "task_event", source: "task", title: `${clip(e.task?.title, 100)}: ${e.kind}`, ref: { table: "TaskEvent", id: e.id } })),
      },
      tasks({ OR: [{ goalId }, { goalId: null, mission: { lifeGoalId: goalId } }] }, (g) => (g ? "task" : "task via mission")),
      ...journal("goalId", goalId),
    );
  }
  if (missionId) {
    reads.push(
      tasks({ missionId }, () => "mission task"),
      ...journal("missionId", missionId),
      {
        name: "chat",
        run: async () =>
          (await prisma.chatConversation.findMany({
            where: { missionId, updatedAt: { gte: since } },
            select: { id: true, title: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
            take,
          })).map((c) => ({ at: c.updatedAt, kind: "chat", source: "chat", title: clip(c.title) || "untitled chat", ref: { table: "ChatConversation", id: c.id } })),
      },
    );
  }
  if (personId) {
    reads.push(
      {
        name: "contact",
        // Contacts only: a chat mention or a status flip is a ledger row, not a contact (contact-rows.ts).
        run: async () =>
          contactRowsOnly(await prisma.relationshipLedger.findMany({
            where: { personId, ...created },
            select: { id: true, note: true, source: true, createdAt: true, metadata: true },
            ...desc,
          })).map((l) => ({ at: l.createdAt, kind: "contact", source: l.source, title: clip(l.note), ref: { table: "RelationshipLedger", id: l.id } })),
      },
      tasks({ personId }, () => "person task"),
    );
  }

  const settled = await Promise.allSettled(reads.map((r) => r.run()));
  const failed: string[] = [];
  const seen = new Set<string>();
  const items: RelatedItem[] = [];
  settled.forEach((s, i) => {
    if (s.status === "rejected") {
      const name = reads[i].name;
      if (!failed.includes(name)) failed.push(name);
      return;
    }
    for (const item of s.value) {
      const k = `${item.ref.table}:${item.ref.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push(item);
    }
  });
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return { items: items.slice(0, take), failed };
}
