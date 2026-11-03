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

// Not "behind", "pace" or "progress": "behind on emails" is not about a goal (self-review, W6).
const GOAL_WORDS = /\b(goals?|targets?|on track|off track|check[- ]?ins?)\b/i;

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}...` : t;
};

/** The same loose match appendRelatedContext uses for commitments, tasks and people. */
function touches(text: string, topicLower: string[]): boolean {
  const lower = text.toLowerCase();
  return topicLower.some((t) => lower.includes(t) || t.split(/\s+/).some((w) => w.length > 3 && lower.includes(w)));
}

export interface GoalRecall {
  lines: string[];
  maxim: GoalMaxim | null;
}

export function goalRecallBlock(
  goals: readonly ActiveGoalHealth[],
  topicLower: string[],
  query: string,
  pool: readonly Maxim[] = MAXIM_POOL,
  day?: string,
): GoalRecall {
  const all = GOAL_WORDS.test(query) || topicLower.some((t) => GOAL_WORDS.test(t));
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
    return { lines: [], maxim: null };
  }
}

export interface PeopleFacts {
  journal: Map<string, { at: Date; text: string }>;
  contact: Map<string, { at: Date; note: string }>;
  failed: Set<"journal" | "contact">;
}

export async function readPeopleFacts(personIds: string[]): Promise<PeopleFacts> {
  const facts: PeopleFacts = { journal: new Map(), contact: new Map(), failed: new Set() };
  if (personIds.length === 0) return facts;
  const [dumps, ledger] = await Promise.allSettled([
    prisma.brainDump.findMany({
      where: { personIds: { hasSome: personIds }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { personIds: true, summary: true, rawThoughts: true, createdAt: true },
    }),
    prisma.relationshipLedger.findMany({
      where: { personId: { in: personIds } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { personId: true, note: true, metadata: true, createdAt: true },
    }),
  ]);
  if (dumps.status === "fulfilled") {
    for (const d of dumps.value) {
      for (const id of d.personIds) {
        if (personIds.includes(id) && !facts.journal.has(id)) facts.journal.set(id, { at: d.createdAt, text: d.summary || d.rawThoughts });
      }
    }
  } else {
    facts.failed.add("journal");
    log.warn("people_facts_read_failed", { source: "journal", err: String(dumps.reason instanceof Error ? dumps.reason.message : dumps.reason) });
  }
  if (ledger.status === "fulfilled") {
    for (const l of contactRowsOnly(ledger.value)) {
      if (l.personId && !facts.contact.has(l.personId)) facts.contact.set(l.personId, { at: l.createdAt, note: l.note ?? "" });
    }
  } else {
    facts.failed.add("contact");
    log.warn("people_facts_read_failed", { source: "contact", err: String(ledger.reason instanceof Error ? ledger.reason.message : ledger.reason) });
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
