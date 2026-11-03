/**
 * The /brain memory tab's goal and person filters (job 2026-11-02-nour-os-interconnect W6; research map gap 7).
 *
 * Goal: goal moments (category goal_moment, lib/brain/goal-brain.ts) plus the extractors' free-text goal facts
 * (category goal); a picked goal narrows to that goal's moments (metadata.goalId; the free-text facts carry no id).
 * Person: any row whose metadata.personId is the picked person (the dossier mirror and anything else that names
 * one). Every read throws on failure, so the panel can say "couldn't load" instead of rendering a failed read as an
 * empty brain (empty-vs-error). Each list reads one past its cap, so a cut list says it was cut.
 */
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const GOAL_PEOPLE_ROW_CAP = 50;
export const GOAL_OPTION_CAP = 30;
export const PERSON_OPTION_CAP = 100;

export interface GoalPeopleRow {
  id: string;
  category: string;
  content: string;
  at: string;
  kind: string | null;
}

export async function goalPeopleMemories(input: { by: "goal" | "person"; id?: string }): Promise<{
  rows: GoalPeopleRow[];
  rowsTruncated: boolean;
  options: Array<{ id: string; label: string }>;
  optionsTruncated: boolean;
  needsPick: boolean;
}> {
  const optionCap = input.by === "goal" ? GOAL_OPTION_CAP : PERSON_OPTION_CAP;
  const allOptions =
    input.by === "goal"
      ? (await prisma.lifeGoal.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" }, take: optionCap + 1, select: { id: true, title: true } })).map(
          (g) => ({ id: g.id, label: g.title }),
        )
      : (await prisma.personProfile.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, take: optionCap + 1, select: { id: true, name: true } })).map(
          (p) => ({ id: p.id, label: p.name }),
        );
  const options = allOptions.slice(0, optionCap);
  const optionsTruncated = allOptions.length > optionCap;
  if (input.by === "person" && !input.id) return { rows: [], rowsTruncated: false, options, optionsTruncated, needsPick: true };
  const where =
    input.by === "goal"
      ? input.id
        // W8a (C4): any row that names the goal (goal moments and pinned memories alike), by metadata.goalId.
        ? { deletedAt: null, metadata: { path: ["goalId"], equals: input.id } }
        : { category: { in: [BRAIN_CATEGORIES.GOAL_MOMENT, BRAIN_CATEGORIES.GOAL] }, deletedAt: null }
      : { deletedAt: null, metadata: { path: ["personId"], equals: input.id! } };
  const rows = await prisma.brainMemory.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: GOAL_PEOPLE_ROW_CAP + 1,
    select: { id: true, category: true, content: true, createdAt: true, metadata: true },
  });
  return {
    rows: rows.slice(0, GOAL_PEOPLE_ROW_CAP).map((r) => {
      const kind = (r.metadata as { kind?: unknown } | null)?.kind;
      return { id: r.id, category: r.category, content: r.content, at: r.createdAt.toISOString(), kind: typeof kind === "string" ? kind : null };
    }),
    rowsTruncated: rows.length > GOAL_PEOPLE_ROW_CAP,
    options,
    optionsTruncated,
    needsPick: false,
  };
}
