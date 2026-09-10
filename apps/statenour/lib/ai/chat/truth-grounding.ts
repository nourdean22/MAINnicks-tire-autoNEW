/**
 * Entity truth-grounding · v10.0.163 · proactive anti-fabrication
 *
 * Reads the user's incoming message + recent assistant history,
 * extracts named entities (project / task / mission names), looks
 * up their actual current state in the DB, and returns a system-
 * fact block to inject into the model's context.
 *
 * Why this layer exists:
 *   v10.0.160 + v10.0.162 catch fabrication AFTER the model emits
 *   it. This catches the underlying CAUSE — the model claiming
 *   "Bay 5 has 15 tasks" because nothing in its context contradicts
 *   that. Now: if "Bay 5" appears in the conversation, we pre-fetch
 *   "Bay 5 currently has 0 tasks · last touched 3d ago" and inject
 *   it as ground truth. The model can't claim 15 with a contradicting
 *   fact in its system context.
 *
 * Pure-ish — DB read, no DB writes. Fail-soft: returns empty string
 * on any error so the chat path never breaks.
 */

import { prisma } from "@/lib/prisma";
import { isInboxMission } from "@/lib/services/mission-helpers";

interface GroundFact {
  entity: string;
  fact: string;
}

/**
 * Re-uses the entity extractor from suggestion-cache (where it was
 * shipped in v10.0.160 for smart replies). Same regex + stop set.
 * Could be promoted to a shared module if a third caller appears,
 * but per JIT we leave it inlined here for now.
 */
const ENTITY_PATTERN =
  /(?:^|(?<=[.!?,:;\s]))(?:[A-Z][\w&]*(?:\s+\d+)?(?:\s+[A-Z][\w&]*){0,3})/g;

const STOP_WORDS = new Set([
  "I", "Nick", "Nour", "The", "A", "An", "This", "That", "These", "Those",
  "If", "When", "While", "Once", "Today", "Yesterday", "Tomorrow",
  "Yes", "No", "Sure", "Done", "Total", "Next", "Hi", "Hello", "Okay", "Hey", "Ok",
  "Added", "Created", "Made", "Sent", "Scheduled", "Saved", "Pinned",
  "Linked", "Moved", "Marked", "Completed", "Removed", "Deleted",
  "Started", "Stopped", "Updated", "Posted", "Published", "Closed",
  "Opened", "Contacted", "Drafted", "Resolved",
]);

function extractEntities(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  // ENTITY_PATTERN is a module-level /g regex — .exec() advances its
  // lastIndex, and the `out.length >= 5` break below exits the loop
  // mid-string, leaving lastIndex non-zero. Without this reset the next
  // call resumes scanning from that stale offset and misses leading
  // entities — silently disabling truth-grounding for that turn.
  ENTITY_PATTERN.lastIndex = 0;
  while ((m = ENTITY_PATTERN.exec(text)) !== null) {
    const phrase = m[0].trim();
    if (!phrase || phrase.length < 3) continue;
    const head = phrase.split(/\s+/)[0];
    if (STOP_WORDS.has(head)) continue;
    if (/^\d+$/.test(phrase)) continue;
    if (out.includes(phrase)) continue;
    out.push(phrase);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Look up project / mission state by name. Case-insensitive partial
 * match. Returns the actual task counts so the model can't claim a
 * different number. Skips Inbox missions (catch-alls, not user
 * projects) to keep grounding focused on real entities.
 */
/**
 * 2026-09-10 · "no fact" had THREE causes and one spelling.
 *
 * `null` meant all of: this entity is not a project (by far the common
 * case -- ENTITY_PATTERN matches any capitalised run, so most turns
 * produce entities that were never missions), this is an Inbox
 * catch-all, and THE DATABASE READ THREW.
 *
 * Only the third is a signal, and it is the one that silently removes
 * the protection this whole module exists to provide: the header
 * promises "the model can't claim 15 with a contradicting fact in its
 * system context", and on a failed read there is no contradicting fact
 * and nothing anywhere says so.
 *
 * The distinction has to be made HERE, because by the time the caller
 * sees an empty list the reason is gone.
 */
/**
 * The one declaration used for BOTH ways grounding can go missing:
 * every per-entity lookup throwing, and the whole call timing out in
 * brain-context. One string, so the two paths cannot drift into saying
 * different things about the same condition.
 */
export const TRUTH_GROUNDING_UNAVAILABLE = [
  "## TRUTH GROUNDING - UNAVAILABLE this turn",
  "The verified-state lookup did not complete, so no database facts are in this context.",
  "Their absence is NOT evidence that a project has no tasks, or does not exist.",
  "Do not state a task count, a project status, or whether something exists from memory.",
  "Call the relevant tool, or say plainly that you could not verify it.",
  "",
].join("\n");

type GroundOutcome =
  /** Looked it up; here is the verified state. */
  | { kind: "fact"; fact: GroundFact }
  /** Looked it up; this entity is simply not a groundable project. */
  | { kind: "none" }
  /** Could NOT look it up. Says nothing about whether the project exists. */
  | { kind: "failed" };

async function groundMissionByName(name: string): Promise<GroundOutcome> {
  try {
    const mission = await prisma.mission.findFirst({
      where: {
        title: { contains: name, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true, title: true, status: true },
    });
    if (!mission) return { kind: "none" };
    if (isInboxMission(mission.title)) return { kind: "none" };
    const [open, done, total] = await Promise.all([
      prisma.task.count({
        where: {
          missionId: mission.id,
          deletedAt: null,
          status: { notIn: ["DONE", "ARCHIVED"] },
        },
      }),
      prisma.task.count({
        where: { missionId: mission.id, deletedAt: null, status: "DONE" },
      }),
      prisma.task.count({
        where: { missionId: mission.id, deletedAt: null },
      }),
    ]);
    return {
      kind: "fact",
      fact: {
        entity: mission.title,
        fact: `Project "${mission.title}" (${mission.status}) currently has ${total} task${total === 1 ? "" : "s"} (${open} open, ${done} done). Verified at the start of this turn.`,
      },
    };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Build a system-fact block for the model's context window. Returns
 * an empty string when no groundable entities found — caller can
 * concat unconditionally without checking.
 *
 * Reads the LAST ~3 messages to find entities. Older history is
 * less relevant and risks blowing the context budget.
 */
export async function buildTruthGroundingBlock(
  messages: ReadonlyArray<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>,
): Promise<string> {
  if (!messages || messages.length === 0) return "";
  const recent = messages.slice(-3);
  const seen = new Set<string>();
  const allEntities: string[] = [];
  for (const m of recent) {
    if (!Array.isArray(m.parts)) continue;
    for (const part of m.parts) {
      if (part?.type !== "text" || typeof part.text !== "string") continue;
      for (const e of extractEntities(part.text)) {
        const k = e.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        allEntities.push(e);
        if (allEntities.length >= 5) break;
      }
      if (allEntities.length >= 5) break;
    }
    if (allEntities.length >= 5) break;
  }

  if (allEntities.length === 0) return "";

  // Run the (up to 5) entity lookups in parallel — each does ~3
  // prisma.task.count queries, so serially this was up to 15 sequential
  // round-trips on the hot chat path. Settle all, then apply the
  // same cap (3) AFTER, preserving the prior `facts` shape + ordering.
  const outcomes = await Promise.all(allEntities.map(groundMissionByName));
  const facts: GroundFact[] = outcomes
    .filter((o): o is { kind: "fact"; fact: GroundFact } => o.kind === "fact")
    .map((o) => o.fact)
    .slice(0, 3);
  /**
   * A lookup that THREW is the only outcome worth declaring. "Not a
   * project" is the ordinary case on most turns -- ENTITY_PATTERN
   * matches any capitalised run, so announcing it would make this block
   * fire constantly and teach the model to skip it, which is how a
   * warning stops being one.
   */
  const lookupFailed = outcomes.some((o) => o.kind === "failed");

  if (facts.length === 0 && !lookupFailed) return "";

  if (facts.length === 0) {
    // Nothing verified, and the reason is that verification could not
    // run. The silence here is what let the model answer a "how many
    // tasks" question from memory with nothing to contradict it -- the
    // exact scenario this module's header describes preventing.
    return TRUTH_GROUNDING_UNAVAILABLE;
  }

  return [
    "## TRUTH GROUNDING — verified state at turn start",
    "These facts come straight from the database. If you're tempted to claim a different number, STOP and re-read.",
    ...facts.map((f) => `· ${f.fact}`),
    // Partial failure: what IS here is verified; what is missing proves
    // nothing. The same distinction the recall path draws between a
    // degraded read and a failed one.
    ...(lookupFailed
      ? [
          "",
          "PARTIAL: one or more lookups failed this turn. The facts above are verified; anything NOT listed was not checked and must not be asserted from memory.",
        ]
      : []),
    "",
  ].join("\n");
}
