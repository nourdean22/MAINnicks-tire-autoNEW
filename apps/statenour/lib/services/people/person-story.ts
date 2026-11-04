/**
 * The person page's story (W8b, 2026-11-03; research mechanism T1 "person-page Related", audit C8/B10): every
 * journal entry that names her and the goals she relates to, in one read for the dossier.
 *
 * Entries: brain_dumps whose person_ids carry her (W4's column), newest first, one past the cap so a cut list says so.
 * Goals: the goal of a task she owns (its own goalId, else its mission's lifeGoalId), and any goal_moment memory
 * stamped with her id (the W6 `brain-goal-people` read shape: metadata.personId). Every read throws on failure so the
 * panel renders "couldn't load", never an empty story (empty-vs-error).
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { TASK_GOAL_SELECT, taskGoalServer } from "@/lib/services/task-goal-server";
import { journalExcerpt } from "./journal-link";

/** Entries shown on the dossier before "more in the journal". */
export const PERSON_STORY_ENTRY_CAP = 10;

export interface PersonStoryEntry {
  id: string;
  kind: "journal" | "reflection";
  at: string;
  excerpt: string;
  href: string;
}

export interface PersonStoryGoal {
  id: string;
  title: string;
  via: "tasks" | "moment";
  href: string;
}

export interface PersonStory {
  entries: PersonStoryEntry[];
  entriesTruncated: boolean;
  goals: PersonStoryGoal[];
}

const goalHref = (id: string) => `/stats?tab=goals#goal-${id}`;

export async function personStory(input: { personId: string; personName: string }): Promise<PersonStory> {
  const [dumps, refls, tasks, moments] = await Promise.all([
    prisma.brainDump.findMany({
      where: { deletedAt: null, personIds: { has: input.personId } },
      orderBy: { createdAt: "desc" },
      take: PERSON_STORY_ENTRY_CAP + 1,
      select: { id: true, createdAt: true, rawThoughts: true },
    }),
    // The /journal composer's reflections carry person_ids too (W8b).
    prisma.reflection.findMany({
      where: { deletedAt: null, personIds: { has: input.personId } },
      orderBy: { createdAt: "desc" },
      take: PERSON_STORY_ENTRY_CAP + 1,
      select: { id: true, createdAt: true, insight: true },
    }),
    prisma.task.findMany({
      where: { personId: input.personId, deletedAt: null },
      select: TASK_GOAL_SELECT,
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.GOAL_MOMENT, deletedAt: null, metadata: { path: ["personId"], equals: input.personId } },
      select: { metadata: true },
    }),
  ]);

  const goals = new Map<string, PersonStoryGoal>();
  for (const t of tasks) {
    const g = taskGoalServer(t);
    if (g && !goals.has(g.id)) goals.set(g.id, { id: g.id, title: g.title, via: "tasks", href: goalHref(g.id) });
  }
  const momentGoalIds = [
    ...new Set(
      moments
        .map((m) => (m.metadata as { goalId?: unknown } | null)?.goalId)
        .filter((id): id is string => typeof id === "string" && !goals.has(id)),
    ),
  ];
  if (momentGoalIds.length > 0) {
    const rows = await prisma.lifeGoal.findMany({ where: { id: { in: momentGoalIds }, deletedAt: null }, select: { id: true, title: true } });
    for (const g of rows) goals.set(g.id, { id: g.id, title: g.title, via: "moment", href: goalHref(g.id) });
  }

  const all = [
    ...dumps.map((d) => ({ id: d.id, kind: "journal" as const, createdAt: d.createdAt, text: d.rawThoughts })),
    ...refls.map((r) => ({ id: r.id, kind: "reflection" as const, createdAt: r.createdAt, text: r.insight })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return {
    entries: all.slice(0, PERSON_STORY_ENTRY_CAP).map((e) => ({
      id: e.id,
      kind: e.kind,
      at: e.createdAt.toISOString(),
      excerpt: journalExcerpt(e.text.replace(/\s+/g, " "), input.personName),
      // The feed anchors every entry as bd-<id>, whatever its table (entry-row.tsx).
      href: `/journal#bd-${e.id}`,
    })),
    entriesTruncated: all.length > PERSON_STORY_ENTRY_CAP,
    goals: [...goals.values()],
  };
}
