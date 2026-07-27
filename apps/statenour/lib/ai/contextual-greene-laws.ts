/**
 * Contextual Greene laws · Wave AB.b · 2026-05-28.
 *
 * The bridge between the Wave Z corpus (144 entries with triggers /
 * actions / relatedKeys per law) and the operator's per-person
 * relationship state. For a given person, picks the top 3 laws Nick
 * thinks apply RIGHT NOW + extracts the concrete actions.
 *
 * Reads:
 *   · PersonProfile (role, status, lastInteraction, leverageNotes)
 *   · Last 10 RelationshipLedger entries
 *   · Last 5 KEPT_WORD rows
 *   · Wave Z corpus seeded into BrainMemory(category=greene_law) with
 *     metadata = { book, type, title, summary, triggers[], actions[],
 *     relatedKeys[], applicabilityPrompt }
 *
 * Cached per (personId, ISO date) in BrainMemory(GREENE_CONTEXTUAL_PICK)
 * for 24h so the dossier page open doesn't re-burn AI tokens.
 *
 * Cost target · <$0.004 per call. Failure mode · returns an empty list
 * so the sidebar self-hides.
 */

import "server-only";

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/contextual-greene-laws");

const DAY_MS = 1000 * 60 * 60 * 24;

export interface ContextualLaw {
  key: string;
  book: string;
  title: string;
  summary: string;
  rationale: string;
  actions: string[];
}

export interface ContextualLawsResult {
  laws: ContextualLaw[];
  source: "cache" | "fresh" | "empty";
  generatedAt: string;
}

const SYSTEM_PROMPT = `You are Robert Greene picking the TOP 3 laws from your
corpus that apply to a specific relationship RIGHT NOW. You will receive:

  · the person's snapshot (role, recent activity, leverage notes)
  · a numbered list of candidate laws with their triggers + actions

Return JSON:

{
  "picks": [
    {
      "key": "<corpus key e.g. law_10 / fearless_3 / dark_drainer>",
      "rationale": "one short sentence (max ~110 chars) calling out the
                    specific signal that makes this law apply RIGHT NOW",
      "actions": ["the 1-3 most relevant action strings from the
                   candidate's actions array · verbatim · max 3"]
    }
  ]
}

RULES:
  · Exactly 3 picks (unless fewer candidates provided).
  · Use only keys from the candidate list.
  · Rationale calls out the SPECIFIC signal · not generic restatement.
  · Action strings copied verbatim from the candidate · the operator
    will read them as concrete next moves.
  · Return ONLY the JSON · no preamble, no markdown fences.`;

export async function pickContextualLawsForPerson(
  personId: string,
): Promise<ContextualLawsResult> {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${personId}:${today}`;

  // ── Cache check ──
  try {
    const cached = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.GREENE_CONTEXTUAL_PICK,
        key: cacheKey,
      },
      select: { metadata: true, createdAt: true },
    });
    if (cached?.metadata) {
      const meta = cached.metadata as Record<string, unknown>;
      const laws = meta.laws as ContextualLaw[] | undefined;
      if (Array.isArray(laws) && laws.length > 0) {
        return {
          laws,
          source: "cache",
          generatedAt: cached.createdAt.toISOString(),
        };
      }
    }
  } catch (err) {
    log.warn("cache_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Snapshot the person ──
  let person: {
    id: string;
    name: string;
    role: string;
    status: string;
    lastInteraction: Date | null;
    leverageNotes: string | null;
    interactionCount: number;
  } | null = null;
  try {
    // Wave AM · 2026-05-28 · soft-delete safety · findFirst+deletedAt:null
    // replaces findUnique so a soft-deleted person can't bleed into the
    // chat's Greene-law injection. Operator complaint root cause: brain
    // layer never filtered deletedAt across 9 PersonProfile readers.
    person = await prisma.personProfile.findFirst({
      where: { id: personId, deletedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        status: true,
        lastInteraction: true,
        leverageNotes: true,
        interactionCount: true,
      },
    });
  } catch (err) {
    log.error("person_lookup_failed", {
      err: err instanceof Error ? err.message : String(err),
      personId,
    });
  }
  if (!person) {
    return { laws: [], source: "empty", generatedAt: new Date().toISOString() };
  }

  // Recent ledger + promises
  const [ledger, promiseRows] = await Promise.all([
    prisma.relationshipLedger.findMany({
      where: { personId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { amount: true, note: true, createdAt: true, source: true },
    }),
    prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.KEPT_WORD },
      select: { metadata: true },
      take: 200,
    }),
  ]);

  const personPromises = promiseRows.filter((r) => {
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    return String(meta.personId ?? "") === personId;
  });
  const openPromises = personPromises.filter((r) => {
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    return ["open", "broken"].includes(String(meta.status ?? "open"));
  });

  const daysSilent = person.lastInteraction
    ? Math.floor((Date.now() - person.lastInteraction.getTime()) / DAY_MS)
    : null;
  const ledger30dDelta = ledger.reduce(
    (acc, l) =>
      Date.now() - l.createdAt.getTime() < 30 * DAY_MS ? acc + l.amount : acc,
    0,
  );

  const personBlock = [
    `NAME: ${person.name}`,
    `ROLE: ${person.role}`,
    `STATUS: ${person.status}`,
    daysSilent !== null ? `DAYS_SILENT: ${daysSilent}` : "DAYS_SILENT: never_touched",
    `INTERACTION_COUNT: ${person.interactionCount}`,
    `LEDGER_DELTA_30D: ${ledger30dDelta > 0 ? "+" : ""}${ledger30dDelta}`,
    `RECENT_LEDGER_TOUCHES: ${ledger.length}`,
    openPromises.length > 0
      ? `OPEN_PROMISES: ${openPromises.length}`
      : "OPEN_PROMISES: 0",
    person.leverageNotes
      ? `LEVERAGE_NOTES: ${person.leverageNotes.slice(0, 300)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // ── Pull the Wave Z corpus from BrainMemory ──
  // Cap to 40 candidates · the prompt cost compounds linearly with this.
  // Heuristic pre-filter: laws whose `type` aligns with the person's
  // current state (e.g. mentor_role for mentors, dark_trait for tagged
  // adversarial profiles). For the broad case we sample randomly.
  let corpus: Array<{
    key: string;
    metadata: Record<string, unknown>;
  }> = [];
  try {
    const rows = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.GREENE_LAW },
      select: { key: true, metadata: true },
      take: 200,
    });
    corpus = rows
      .map((r) => ({
        key: r.key,
        metadata: (r.metadata as Record<string, unknown> | null) ?? {},
      }))
      .filter((r) => Array.isArray(r.metadata.triggers));
    // Bound the candidate set sent to the model.
    if (corpus.length > 40) {
      // Prefer laws · then strategies · then mentorship · then dark
      // traits · then principles · then seducers/victims.
      // 2026-07-27 · creative_strategy sits just under mentorship_role.
      // Unranked types fall to `?? 9` and get sliced off by the 40-row cap
      // below — the Book V strategies would have been seeded and then
      // never reach the model.
      const typePriority: Record<string, number> = {
        law: 0,
        strategy: 1,
        mentorship_role: 2,
        creative_strategy: 3,
        dark_trait: 4,
        principle: 5,
        fearless_law: 6,
        phase: 7,
        seducer_type: 8,
        victim_type: 9,
      };
      corpus.sort((a, b) => {
        const at = String(a.metadata.type ?? "principle");
        const bt = String(b.metadata.type ?? "principle");
        return (typePriority[at] ?? 10) - (typePriority[bt] ?? 10);
      });
      corpus = corpus.slice(0, 40);
    }
  } catch (err) {
    log.warn("corpus_read_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (corpus.length === 0) {
    return { laws: [], source: "empty", generatedAt: new Date().toISOString() };
  }

  const candidatesBlock = corpus
    .map((r, i) => {
      const title = String(r.metadata.title ?? r.key);
      const triggers = (r.metadata.triggers as string[] | undefined) ?? [];
      const actions = (r.metadata.actions as string[] | undefined) ?? [];
      return [
        `${i + 1}. KEY="${r.key}" TITLE="${title}"`,
        `   TRIGGERS: ${triggers.slice(0, 3).join(" | ")}`,
        `   ACTIONS: ${actions.slice(0, 3).map((a) => `"${a}"`).join(" | ")}`,
      ].join("\n");
    })
    .join("\n\n");

  // ── AI rank ──
  let picks: ContextualLaw[] = [];
  try {
    const result = await tracedAiChat(
      { label: "contextual-greene-laws", source: "tool" },
      [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `PERSON:\n${personBlock}\n\nCANDIDATE LAWS (${corpus.length}):\n${candidatesBlock}`,
        },
      ],
      "reason",
    );
    const text = (result.content ?? "")
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    if (text) {
      const parsed = JSON.parse(text) as {
        picks?: Array<{ key?: string; rationale?: string; actions?: unknown }>;
      };
      const validKeys = new Map(
        corpus.map((c) => [c.key, c.metadata] as const),
      );
      picks = (parsed.picks ?? [])
        .filter(
          (p): p is { key: string; rationale: string; actions?: unknown } =>
            !!p && typeof p.key === "string" && validKeys.has(p.key),
        )
        .map((p) => {
          const meta = validKeys.get(p.key)!;
          const actions = Array.isArray(p.actions)
            ? p.actions
                .filter((a): a is string => typeof a === "string")
                .slice(0, 3)
            : ((meta.actions as string[] | undefined) ?? []).slice(0, 3);
          return {
            key: p.key,
            book: String(meta.book ?? ""),
            title: String(meta.title ?? p.key),
            summary: String(meta.summary ?? ""),
            rationale: String(p.rationale ?? "").slice(0, 200),
            actions,
          };
        })
        .slice(0, 3);
    }
  } catch (err) {
    log.warn("ai_pick_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (picks.length === 0) {
    return { laws: [], source: "empty", generatedAt: new Date().toISOString() };
  }

  // ── Cache write ──
  try {
    const existing = await prisma.brainMemory.findFirst({
      where: {
        category: BRAIN_CATEGORIES.GREENE_CONTEXTUAL_PICK,
        key: cacheKey,
      },
      select: { id: true },
    });
    const payload = {
      content: `${person.name} · ${picks.map((p) => p.title).join(", ")}`,
      confidence: 0.9,
      source: "tool:contextual-greene-laws",
      createdBy: "ai" as const,
      metadata: {
        personId,
        laws: picks,
        generatedAt: new Date().toISOString(),
      } as never,
    };
    if (existing) {
      await prisma.brainMemory.update({
        where: { id: existing.id },
        data: { ...payload, lastSeen: new Date() },
      });
    } else {
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.GREENE_CONTEXTUAL_PICK,
          key: cacheKey,
          ...payload,
        },
      });
    }
  } catch (err) {
    log.warn("cache_write_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    laws: picks,
    source: "fresh",
    generatedAt: new Date().toISOString(),
  };
}
