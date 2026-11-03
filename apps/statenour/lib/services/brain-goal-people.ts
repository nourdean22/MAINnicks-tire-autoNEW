/**
 * The /brain memory tab's goal and person filters (job 2026-11-02-nour-os-interconnect W6; research map gap 7).
 *
 * Goal: category goal (the goal moments lib/brain/goal-brain.ts writes, plus older free-text goal facts); a picked
 * goal narrows to metadata.goalId. Person: any row whose metadata.personId is the picked person (the dossier mirror
 * and anything else that names one). Every read throws on failure, so the panel can say "couldn't load" instead of
 * rendering a failed read as an empty brain (empty-vs-error).
 */
import { prisma } from "@/lib/prisma";

export const GOAL_PEOPLE_ROW_CAP = 50;

export interface GoalPeopleRow {
  id: string;
  category: string;
  content: string;
  at: string;
  kind: string | null;
}

export async function goalPeopleMemories(input: { by: "goal" | "person"; id?: string }): Promise<{
  rows: GoalPeopleRow[];
  options: Array<{ id: string; label: string }>;
  needsPick: boolean;
}> {
  const options =
    input.by === "goal"
      ? (await prisma.lifeGoal.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true } })).map(
          (g) => ({ id: g.id, label: g.title }),
        )
      : (await prisma.personProfile.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: 100, select: { id: true, name: true } })).map(
          (p) => ({ id: p.id, label: p.name }),
        );
  if (input.by === "person" && !input.id) return { rows: [], options, needsPick: true };
  const where =
    input.by === "goal"
      ? { category: "goal", deletedAt: null, ...(input.id ? { metadata: { path: ["goalId"], equals: input.id } } : {}) }
      : { deletedAt: null, metadata: { path: ["personId"], equals: input.id! } };
  const rows = await prisma.brainMemory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: GOAL_PEOPLE_ROW_CAP,
    select: { id: true, category: true, content: true, createdAt: true, metadata: true },
  });
  return {
    rows: rows.map((r) => {
      const kind = (r.metadata as { kind?: unknown } | null)?.kind;
      return { id: r.id, category: r.category, content: r.content, at: r.createdAt.toISOString(), kind: typeof kind === "string" ? kind : null };
    }),
    options,
    needsPick: false,
  };
}
