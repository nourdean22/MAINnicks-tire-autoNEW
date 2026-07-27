/**
 * Tactician · "your next move" composer · AG-31 (2026-07-09)
 *
 * "Tactician" had zero repo hits before this wave — move-recommendation
 * existed only as fragments: the Greene corpus carries machine-usable
 * actions[] (rendered since AG-14), the per-person contextual-law picker
 * returns actions with rationale, and /battle was prose in MODE_PERSONAS
 * with no mechanical effect. This module composes those fragments into a
 * single directive: end the answer with exactly ONE concrete move.
 *
 * Deterministic-first (mirrors the matcher discipline):
 *   · Self-gating — returns "" unless the turn smells tactical
 *     (TACTICIAN_INTENT) or the caller relaxes thresholds (/battle).
 *   · Person detection is a whole-word name match against a small
 *     cached PersonProfile list (id+name+powerBalance only, 10-min
 *     TTL) — deliberately NOT the KEPT_WORD load-everything-filter-in-
 *     JS antipattern in contextual-greene-laws.ts.
 *   · Person hit → pickContextualLawsForPerson (24h-cached, <$0.004)
 *     for person-specific actions; otherwise the message-level
 *     Greene/dark-psych matcher picks carry the moves.
 *   · No available action from ANY source → "" (never an empty
 *     directive).
 */

import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/tactician");

/** Tactical-intent gate · aligned with chat-mode family #7 (power/
 *  leverage/Greene) plus interpersonal-conflict verbs the corpus
 *  triggers cover. */
export const TACTICIAN_INTENT =
  /\b(power (dynamics?|balance|position)|leverage (over|with)|negotiat\w+|counter[- ]?offer|undercut\w*|outmaneuver\w*|next move|my move|how (do|should) i (respond|handle|counter|play)|play (this|him|her|them)|upper hand|manipulat\w+|rival\w*|competitor is)\b/i;

interface CachedPerson {
  id: string;
  name: string;
  powerBalance: number;
}

const PERSON_TTL_MS = 10 * 60 * 1000;
let personCache: { rows: CachedPerson[]; loadedAt: number } | null = null;

async function loadPeople(): Promise<CachedPerson[]> {
  const now = Date.now();
  if (personCache && now - personCache.loadedAt < PERSON_TTL_MS) {
    return personCache.rows;
  }
  try {
    const rows = await prisma.personProfile.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, powerBalance: true },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    personCache = {
      rows: rows.map((r) => ({ id: r.id, name: r.name, powerBalance: r.powerBalance })),
      loadedAt: now,
    };
    return personCache.rows;
  } catch (err) {
    log.warn("person_cache_load_failed", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    personCache = { rows: [], loadedAt: now };
    return [];
  }
}

/** Test hook. */
export function _resetTacticianCaches(): void {
  personCache = null;
}

function matchPerson(message: string, people: CachedPerson[]): CachedPerson | null {
  const lower = message.toLowerCase();
  for (const p of people) {
    const name = p.name.trim();
    if (name.length < 3) continue; // 1-2 char names false-positive constantly
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").toLowerCase()}\\b`);
    if (re.test(lower)) return p;
  }
  return null;
}

/**
 * Compose the NEXT MOVE prompt block for a turn, or "" when there is
 * no tactical signal / no concrete move available. Best-effort — any
 * failure returns "" (chat path never blocks on the tactician).
 */
export async function buildNextMoveBlock(
  userMessage: string,
  opts: { relaxed?: boolean } = {},
): Promise<string> {
  if (!userMessage || userMessage.length < 12) return "";
  if (!opts.relaxed && !TACTICIAN_INTENT.test(userMessage)) return "";

  try {
    const [{ pickContextualLawsForMessage }, { pickDarkPsychologyForMessage }, people] =
      await Promise.all([
        import("@/lib/ai/greene-message-matcher"),
        import("@/lib/ai/dark-psychology-matcher"),
        loadPeople(),
      ]);

    const minScore = opts.relaxed ? 1 : 2;
    const maxLaws = opts.relaxed ? 3 : 2;
    const person = matchPerson(userMessage, people);

    const [greenePicks, darkPicks, personLaws] = await Promise.all([
      // 2026-07-27 · embedOnMiss · no prefetched embedding at this call
      // site, so AG-31's vector fallback was unreachable. Bounded: this
      // whole function is already gated behind TACTICIAN_INTENT (or an
      // explicit relaxed call), and the embed is paid only on a miss.
      pickContextualLawsForMessage(userMessage, {
        minScore,
        maxLaws,
        embedOnMiss: true,
      }).catch(() => []),
      pickDarkPsychologyForMessage(userMessage, { minScore, maxResults: 2 }).catch(() => []),
      person
        ? import("@/lib/ai/contextual-greene-laws")
            .then(({ pickContextualLawsForPerson }) => pickContextualLawsForPerson(person.id))
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    // Move candidates in preference order: person-specific contextual
    // laws (grounded in the live relationship state) > message-level
    // Greene picks > dark-psych picks.
    const moves: Array<{ move: string; cite: string }> = [];
    for (const law of personLaws?.laws ?? []) {
      for (const a of law.actions.slice(0, 2)) {
        moves.push({ move: a, cite: `${law.book} · ${law.title}` });
      }
    }
    for (const p of greenePicks) {
      for (const a of p.actions ?? []) {
        moves.push({ move: a, cite: `${p.book} · ${p.title}` });
      }
    }
    for (const p of darkPicks) {
      for (const a of p.actions ?? []) {
        moves.push({ move: a, cite: `${p.sourceBook} · ${p.title}` });
      }
    }
    if (moves.length === 0) return "";

    const lines: string[] = [
      "## NEXT MOVE (tactician directive)",
      "",
    ];
    if (person) {
      const lean =
        person.powerBalance > 0.2 ? "you hold the leverage" :
        person.powerBalance < -0.2 ? "they hold the leverage" : "balance is even";
      lines.push(`Tracked person in play: **${person.name}** · power balance ${person.powerBalance.toFixed(1)} (${lean}).`);
      lines.push("");
    }
    lines.push("Candidate moves from the corpus (verbatim · pick what fits, adapt names/numbers):");
    for (const m of moves.slice(0, 4)) {
      lines.push(`- ${m.move} [${m.cite}]`);
    }
    lines.push("");
    lines.push(
      "End your answer with exactly ONE concrete move — verb first, target named, executable within 48 hours, cited [Book · Law] when it comes from the corpus. One move, not a menu.",
    );
    return lines.join("\n");
  } catch (err) {
    log.warn("next_move_failed", {
      err: err instanceof Error ? err.message.slice(0, 160) : String(err),
    });
    return "";
  }
}
