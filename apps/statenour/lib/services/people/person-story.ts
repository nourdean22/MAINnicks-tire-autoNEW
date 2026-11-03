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
import { journalExcerpt } from "./journal-link";

/** Entries shown on the dossier before "more in the journal". */
export const PERSON_STORY_ENTRY_CAP = 10;

export interface PersonStoryEntry {
  id: string;
  kind: "journal";
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
  const [dumps, tasks, moments] = await Promise.all([
    prisma.brainDump.findMany({
      where: { deletedAt: null, personIds: { has: input.personId } },
      orderBy: { createdAt: "desc" },
      take: PERSON_STORY_ENTRY_CAP + 1,
      select: { id: true, createdAt: true, rawThoughts: true },
    }),
    prisma.task.findMany({
      where: { personId: input.personId, deletedAt: null },
      select: {
        goalId: true,
        goal: { select: { id: true, title: true, deletedAt: true } },
        mission: { select: { lifeGoalId: true, lifeGoal: { select: { id: true, title: true, deletedAt: true } } } },
      },
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.GOAL_MOMENT, deletedAt: null, metadata: { path: ["personId"], equals: input.personId } },
      select: { metadata: true },
    }),
  ]);

  const goals = new Map<string, PersonStoryGoal>();
  for (const t of tasks) {
    const g = t.goal ?? t.mission?.lifeGoal ?? null;
    if (g && !g.deletedAt && !goals.has(g.id)) goals.set(g.id, { id: g.id, title: g.title, via: "tasks", href: goalHref(g.id) });
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

  return {
    entries: dumps.slice(0, PERSON_STORY_ENTRY_CAP).map((d) => ({
      id: d.id,
      kind: "journal" as const,
      at: d.createdAt.toISOString(),
      excerpt: journalExcerpt(d.rawThoughts.replace(/\s+/g, " "), input.personName),
      href: `/journal#bd-${d.id}`,
    })),
    entriesTruncated: dumps.length > PERSON_STORY_ENTRY_CAP,
    goals: [...goals.values()],
  };
}
