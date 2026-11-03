/**
 * Recall keyed by goals and people (job 2026-11-02-nour-os-interconnect W6; research map gap 7: the brain was
 * keyed by chat topic, not by goals or people). contextual-recall.ts calls these; they never throw into it.
 *
 *  - Goal lines: only on a turn that names a goal's title or talks about goals, at most GOAL_RECALL_LINES, each
 *    with the id (so Nick can call getRelated / logGoalCheckIn) and the same health and pace the card shows
 *    (activeGoalsWithHealth, the getGoals read; never a second goals query).
 *  - One maxim from his books for the worst touched goal that is off track or behind pace (maximForGoalMoment,
 *    the goal card's own pick). It takes a wisdom slot (selectWisdomSlots goalMaximSlots), so wisdom never grows.
 *  - People: each recalled person's newest journal line (brain_dumps.person_ids) and last contact
 *    (relationship_ledger, contacts only), read by id, so a reply about a person starts from the newest fact.
 */
import { prisma } from "@/lib/prisma";
import { activeGoalsWithHealth, type ActiveGoalHealth } from "@/lib/services/goal-health";
import { goalMomentState, maximForGoalMoment, type GoalMaxim, type GoalMomentState } from "@/lib/brain/goal-maxim";
import { contactRowsOnly } from "@/lib/services/people/contact-rows";
import { MAXIM_POOL } from "@/lib/wisdom/maxim-pool";
import type { Maxim } from "@/lib/wisdom/maxims";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("brain/goal-people-recall");

/** The most goal lines one turn's recall carries (3 active goals in prod, 2026-11-02). */
export const GOAL_RECALL_LINES = 3;
/** The goal states that earn a maxim in recall (the card shows one for every moment state). */
const RECALL_MAXIM_STATES: readonly GoalMomentState[] = ["off_track", "behind_pace"];
/** Also RECALL_ADDENDUM_HEADINGS.goals (contextual-recall.ts imports it from here). */
export const GOAL_RECALL_HEADING = "### Goals in this turn";

// Read against the RAW last message (topics are single words, so a phrase could never match). Not "behind", "pace"
// or "progress" ("behind on emails"), and not "target" (the store): W6 self-review and second reader.
const GOAL_WORDS = /\b(goals?|on track|off track|check[- ]?ins?)\b/i;
/** Rendered when the goals read fails on a goal turn: the goals are unknown this turn, not absent. */
export const GOAL_READ_FAILED_LINE = "- Goals: couldn't read this turn (unknown, not none)";

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
};

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);

/** A goal title is touched when a topic shares a whole word of 4+ letters with it ("work" never matches "workout"). */
function touches(title: string, topicLower: string[]): boolean {
  const titleWords = new Set(words(title));
  return topicLower.some((t) => words(t).some((w) => titleWords.has(w)));
}

export interface GoalRecall {
  lines: string[];
  maxim: GoalMaxim | null;
  /** The goals read failed this turn: the lines say so on a goal turn, and the [brain-recall] log carries it. */
  failed?: true;
}

export function goalRecallBlock(
  goals: readonly ActiveGoalHealth[],
  topicLower: string[],
  /** The raw last message: goal phrases are read from it, not from the single-word topics. */
  query: string,
  pool: readonly Maxim[] = MAXIM_POOL,
  day?: string,
): GoalRecall {
  const all = GOAL_WORDS.test(query);
  const touched = (all ? goals : goals.filter((g) => touches(g.title, topicLower))).slice(0, GOAL_RECALL_LINES);
  if (touched.length === 0) return { lines: [], maxim: null };
  const lines = [
    GOAL_RECALL_HEADING,
    ...touched.map((g) => {
      const since = g.health.at ? ` since ${g.health.at.slice(0, 10)}` : "";
      const pace = g.pace ? ` · ${clip(g.pace, 80)}` : "";
      return `- ${clip(g.title, 100)} [id:${g.id}] · health ${g.health.state}${since}${pace}`;
    }),
  ];
  const moment = (g: ActiveGoalHealth) =>
    goalMomentState({ status: g.status, health: g.health.state, pace: g.paceKind ? { kind: g.paceKind } : null });
  const worst = RECALL_MAXIM_STATES.map((s) => touched.find((g) => moment(g) === s)).find(Boolean);
  const maxim = worst
    ? maximForGoalMoment({ id: worst.id, status: worst.status, health: worst.health.state, pace: worst.paceKind ? { kind: worst.paceKind } : null }, pool, day)
    : null;
  if (worst && maxim) lines.push(`- Maxim for "${clip(worst.title, 100)}" (${maxim.state.replace("_", " ")}): ${maxim.text} (${maxim.origin})`);
  return { lines, maxim };
}

export async function readGoalRecall(topicLower: string[], query: string): Promise<GoalRecall> {
  try {
    const { goals } = await activeGoalsWithHealth();
    return goalRecallBlock(goals, topicLower, query);
  } catch (err) {
    log.warn("goal_recall_failed", { err: err instanceof Error ? err.message : String(err) });
    // A goal turn must not read like a turn that touched no goal (empty-vs-error).
    return { lines: GOAL_WORDS.test(query) ? [GOAL_RECALL_HEADING, GOAL_READ_FAILED_LINE] : [], maxim: null, failed: true };
  }
}

export interface PeopleFacts {
  journal: Map<string, { at: Date; text: string }>;
  contact: Map<string, { at: Date; note: string }>;
  failed: Set<"journal" | "contact">;
}

export async function readPeopleFacts(personIds: string[]): Promise<PeopleFacts> {
  const facts: PeopleFacts = { journal: new Map(), contact: new Map(), failed: new Set() };
  const fail = (source: "journal" | "contact", err: unknown) => {
    if (!facts.failed.has(source)) log.warn("people_facts_read_failed", { source, err: err instanceof Error ? err.message : String(err) });
    facts.failed.add(source);
  };
  // One person, one read at a time: each person gets their own newest line (a shared capped read let a busy person
  // crowd out the rest), and recall's pool peak is unchanged (contextual-recall.ts phase B note).
  for (const id of personIds) {
    try {
      const d = await prisma.brainDump.findFirst({
        where: { personIds: { has: id }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { summary: true, rawThoughts: true, createdAt: true },
      });
      if (d) facts.journal.set(id, { at: d.createdAt, text: d.summary || d.rawThoughts });
    } catch (err) {
      fail("journal", err);
    }
    try {
      const rows = await prisma.relationshipLedger.findMany({
        where: { personId: id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { personId: true, note: true, metadata: true, createdAt: true },
      });
      const c = contactRowsOnly(rows)[0];
      if (c) facts.contact.set(id, { at: c.createdAt, note: c.note ?? "" });
    } catch (err) {
      fail("contact", err);
    }
  }
  return facts;
}

/** " · last contact <date>: <note> · journal <date>: <line>", or "unread" for a source whose read failed. */
export function personFactSuffix(facts: PeopleFacts, personId: string): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const c = facts.contact.get(personId);
  const j = facts.journal.get(personId);
  const contact = facts.failed.has("contact") ? " · last contact unread" : c ? ` · last contact ${day(c.at)}${c.note.trim() ? `: ${clip(c.note, 60)}` : ""}` : "";
  const journal = facts.failed.has("journal") ? " · journal unread" : j ? ` · journal ${day(j.at)}: ${clip(j.text, 80)}` : "";
  return contact + journal;
}
