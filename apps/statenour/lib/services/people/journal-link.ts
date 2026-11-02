/**
 * Journal entry -> people · W4 of job 2026-11-02-nour-os-interconnect.
 *
 * "talked to Dania about the move" reaches Dania: the entry stores her id (brain_dumps.person_ids) and, when he
 * reports actually talking to her, ONE contact row lands in her ledger through the one writer.
 *
 * The gate decides who a line is about, so it errs toward writing nothing:
 *   · names come from the extraction's `people` list (a typed list, not free-text linkedTopics) and are resolved by
 *     the existing fuzzy resolver with createIfMissing:false, so an unknown name stays text and creates no one;
 *   · only the `exact` tier, or a `case_insensitive` hit that is the ONLY case-insensitive match, is kept. The
 *     resolver's own audit confidence is 1.0 for those; Levenshtein (0.95) and Jaro-Winkler (0.9) return the FIRST
 *     near name with no tie check, so "Dana" next to "Dania" and "Dina" would pick one at random;
 *   · a mention is not a contact (the 2026-09-16 rule in lib/brain/conversation-memory.ts): every resolved person is
 *     linked, but only one he reports interacting with gets a ledger row.
 *
 * Once per (person, entry): `at` and `noRowSince` are both the entry's createdAt, so a re-process of the same entry
 * finds its own row inside recordInteractionOnce's locked count and skips.
 */
import { prisma } from "@/lib/prisma";
import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";
import { PersonNotFoundError, recordInteractionOnce } from "@/lib/services/people/record-interaction";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/people/journal-link");

/** The ledger note: the entry's first N characters, his words. */
export const JOURNAL_LEDGER_NOTE_CHARS = 160;
/** The /people card excerpt of the newest entry naming the person. */
export const JOURNAL_EXCERPT_CHARS = 120;
/** At most this many names per entry (the extraction prompt asks for the same cap). */
export const JOURNAL_PEOPLE_MAX = 6;

export interface JournalPersonMention {
  name: string;
  /** True only when he reports actually communicating with the person. */
  interacted: boolean;
}

/** Shape the model's list; a string is a bare mention, a string "yes" is not an interaction claim. */
export function normalizeJournalPeople(raw: unknown): JournalPersonMention[] {
  if (!Array.isArray(raw)) return [];
  const out: JournalPersonMention[] = [];
  for (const item of raw) {
    if (out.length >= JOURNAL_PEOPLE_MAX) break;
    if (typeof item === "string") {
      if (item.trim()) out.push({ name: item.trim(), interacted: false });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name) out.push({ name, interacted: o.interacted === true });
  }
  return out;
}

export interface JournalLinkResult {
  personIds: string[];
  recorded: number;
  skipped: number;
  failed: number;
  /** Names the gate refused (no match, a fuzzy tier, or ambiguous). */
  rejected: number;
}

async function resolveUnique(name: string): Promise<{ id: string; tier: "exact" | "case_insensitive" } | null> {
  const r = await resolvePersonByName(name, { createIfMissing: false });
  if (!r.matched || !r.person) return null;
  if (r.matchTier === "exact") return { id: r.person.id, tier: "exact" };
  if (r.matchTier !== "case_insensitive") return null;
  const hits = await prisma.personProfile.count({
    where: { name: { equals: name.trim(), mode: "insensitive" }, deletedAt: null },
  });
  return hits === 1 ? { id: r.person.id, tier: "case_insensitive" } : null;
}

/** Resolve, store the ids on the entry, then write one contact row per interacted person. Throws only on the id write. */
export async function linkJournalPeople(args: {
  dumpId: string;
  createdAt: Date;
  rawText: string;
  people: JournalPersonMention[];
}): Promise<JournalLinkResult> {
  const resolved = new Map<string, { tier: "exact" | "case_insensitive"; interacted: boolean }>();
  let rejected = 0;
  for (const m of args.people.slice(0, JOURNAL_PEOPLE_MAX)) {
    const hit = await resolveUnique(m.name);
    if (!hit) {
      rejected++;
      continue;
    }
    const prev = resolved.get(hit.id);
    resolved.set(hit.id, { tier: prev?.tier ?? hit.tier, interacted: (prev?.interacted ?? false) || m.interacted });
  }
  const personIds = [...resolved.keys()];
  // Always written, even empty: a re-process that resolves no one clears ids the last pass set.
  await prisma.brainDump.update({ where: { id: args.dumpId }, data: { personIds } });

  let recorded = 0;
  let skipped = 0;
  let failed = 0;
  // The note is embedded and read back into prompts, so it is fenced like every other journal-derived string.
  const note = sanitizeForPrompt(args.rawText.trim()).slice(0, JOURNAL_LEDGER_NOTE_CHARS).trimEnd();
  for (const [personId, r] of resolved) {
    if (!r.interacted) continue;
    try {
      const outcome = await recordInteractionOnce({
        personId,
        amount: 1,
        note,
        source: "journal",
        at: args.createdAt,
        noRowSince: args.createdAt,
        creditXp: false,
        metadata: { auto: true, via: "journal_ingest", dumpId: args.dumpId, matchTier: r.tier },
      });
      if (outcome.skipped) skipped++;
      else recorded++;
    } catch (err) {
      failed++;
      log.warn(err instanceof PersonNotFoundError ? "journal_person_gone" : "journal_contact_failed", {
        dumpId: args.dumpId,
        personId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  log.info("journal_people_linked", { dumpId: args.dumpId, linked: personIds.length, recorded, skipped, failed, rejected });
  return { personIds, recorded, skipped, failed, rejected };
}

export interface LatestJournal {
  at: string;
  excerpt: string;
  dumpId: string;
}

/** Newest-first rows in; the newest entry naming each person out (absent = no entry names them in the rows read). */
export function latestJournalByPerson(
  rows: ReadonlyArray<{ id: string; createdAt: Date; rawThoughts: string; personIds: string[] }>,
): Map<string, LatestJournal> {
  const out = new Map<string, LatestJournal>();
  for (const row of rows) {
    for (const pid of row.personIds) {
      if (out.has(pid)) continue;
      const t = row.rawThoughts.trim();
      out.set(pid, {
        at: row.createdAt.toISOString(),
        excerpt: t.length > JOURNAL_EXCERPT_CHARS ? `${t.slice(0, JOURNAL_EXCERPT_CHARS).trimEnd()}…` : t,
        dumpId: row.id,
      });
    }
  }
  return out;
}
