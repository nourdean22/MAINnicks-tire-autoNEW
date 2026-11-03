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
 * Once per (person, ET day): `at` is the entry's createdAt and the window is that entry's ET day (W8b, audit B8), so a
 * 9 am digest and a 9 pm line are one contact in either order, a re-process of the same entry finds its own row inside
 * recordInteractionOnce's locked count and skips, and a contact he logs the next day never locks the journal line out.
 */
import { prisma } from "@/lib/prisma";
import { resolvePersonByName } from "@/lib/brain/person-profile-fuzzy";
import { PersonNotFoundError, recordInteractionOnce } from "@/lib/services/people/record-interaction";
import { nameMatcher } from "@/lib/services/people/backfill-plan";
import { sanitizeForPrompt } from "@/lib/ai/prompt/sanitize";
import { endOfDayET, startOfDayET } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";
import { recordError } from "@/lib/errors/record-error";

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
  /** The people's names as they stand on People (W8b): the reply says who the line reached. */
  linkedNames: string[];
  /** The refused names as he wrote them (W8b, audit B9): the reply says "not on People: Mo". */
  rejectedNames: string[];
}

async function resolveUnique(name: string): Promise<{ id: string; name: string; tier: "exact" | "case_insensitive" } | null> {
  // fuzzy:false: the gate refuses the Levenshtein and Jaro-Winkler tiers, so they never run (and never log an Auto-merged row).
  const r = await resolvePersonByName(name, { createIfMissing: false, fuzzy: false });
  if (!r.matched || !r.person) return null;
  if (r.matchTier === "exact") return { id: r.person.id, name: r.person.name, tier: "exact" };
  if (r.matchTier !== "case_insensitive") return null;
  const hits = await prisma.personProfile.count({
    where: { name: { equals: name.trim(), mode: "insensitive" }, deletedAt: null },
  });
  return hits === 1 ? { id: r.person.id, name: r.person.name, tier: "case_insensitive" } : null;
}

/** Resolve, store the ids on the entry, then write one contact row per interacted person. Throws only on the id write. */
export async function linkJournalPeople(args: {
  /** The entry's table (W8b): brain_dumps by default; the /journal composer's reflections carry person_ids too. */
  silo?: "brain_dump" | "reflection";
  /** Keep the ids already on the row and add to them (W8b): the model pass must never un-link the save-time exact matches. */
  merge?: boolean;
  /** The entry's id in its silo (named for the first silo; a reflection id goes here too). */
  dumpId: string;
  createdAt: Date;
  rawText: string;
  people: JournalPersonMention[];
}): Promise<JournalLinkResult> {
  const silo = args.silo ?? "brain_dump";
  const resolved = new Map<string, { name: string; tier: "exact" | "case_insensitive"; interacted: boolean }>();
  const rejectedNames: string[] = [];
  for (const m of args.people.slice(0, JOURNAL_PEOPLE_MAX)) {
    const hit = await resolveUnique(m.name);
    if (!hit) {
      rejectedNames.push(m.name);
      continue;
    }
    const prev = resolved.get(hit.id);
    resolved.set(hit.id, { name: hit.name, tier: prev?.tier ?? hit.tier, interacted: (prev?.interacted ?? false) || m.interacted });
  }
  const rejected = rejectedNames.length;
  let personIds = [...resolved.keys()];
  const linkedNames = [...resolved.values()].map((r) => r.name);
  if (args.merge) {
    const row =
      silo === "reflection"
        ? await prisma.reflection.findUnique({ where: { id: args.dumpId }, select: { personIds: true } })
        : await prisma.brainDump.findUnique({ where: { id: args.dumpId }, select: { personIds: true } });
    personIds = [...new Set([...(row?.personIds ?? []), ...personIds])];
  }
  // Always written, even empty (unless merging): a re-process that resolves no one clears ids the last pass set.
  if (silo === "reflection") await prisma.reflection.update({ where: { id: args.dumpId }, data: { personIds } });
  else await prisma.brainDump.update({ where: { id: args.dumpId }, data: { personIds } });
  const via = silo === "reflection" ? { via: "journal_reflect", reflectionId: args.dumpId } : { via: "journal_ingest", dumpId: args.dumpId };

  let recorded = 0;
  let skipped = 0;
  const failedIds: string[] = [];
  let firstError: unknown = null;
  // The note is embedded and read back into prompts, so it is fenced like every other journal-derived string.
  const note = sanitizeForPrompt(args.rawText.trim()).slice(0, JOURNAL_LEDGER_NOTE_CHARS).trimEnd();
  for (const [personId, r] of resolved) {
    if (!r.interacted) continue;
    const write = () =>
      recordInteractionOnce({
        personId,
        amount: 1,
        note,
        source: "journal",
        at: args.createdAt,
        // Bounded to the entry's ET day: a contact already logged that day wins, in either order; the next day's does not block.
        noRowSince: startOfDayET(args.createdAt),
        noRowBefore: endOfDayET(args.createdAt),
        creditXp: false,
        metadata: { auto: true, ...via, matchTier: r.tier },
      });
    try {
      let outcome = await write();
      // The journal has no later compile to retry a deadlock abort, so it retries once here.
      if (outcome.skipped && outcome.reason === "lost_race") outcome = await write();
      if (outcome.skipped && outcome.reason === "lost_race") throw new Error("journal contact lost the race twice");
      if (outcome.skipped) skipped++;
      else recorded++;
    } catch (err) {
      failedIds.push(personId);
      firstError ??= err;
      log.warn(err instanceof PersonNotFoundError ? "journal_person_gone" : "journal_contact_failed", {
        dumpId: args.dumpId,
        personId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const failed = failedIds.length;
  // Ids written but a contact row not: never a quiet success.
  if (failed > 0) {
    recordError("brain:journal-ingest", firstError, {
      phase: "people-contact",
      brainDumpId: args.dumpId,
      failed,
      personIdSuffixes: failedIds.map((id) => id.slice(-6)),
    });
  }
  log.info("journal_people_linked", { dumpId: args.dumpId, linked: personIds.length, recorded, skipped, failed, rejected });
  return { personIds, recorded, skipped, failed, rejected, linkedNames, rejectedNames };
}

/**
 * The save-time link with no model (W8b): every live person whose name appears whole-word in the text is linked as a
 * MENTION (never a contact: only the extraction knows "interacted"). The /journal composer and the weekly review's
 * notes use it so a saved line reaches People before any model runs. Returns the names linked; throws on a failed read.
 */
export async function linkNamedPeople(args: {
  silo: "brain_dump" | "reflection";
  dumpId: string;
  createdAt: Date;
  rawText: string;
}): Promise<{ names: string[] }> {
  const people = await prisma.personProfile.findMany({ where: { deletedAt: null }, select: { id: true, name: true } });
  const named = people.filter((p) => p.name.trim().length >= 2 && nameMatcher(p.name).test(args.rawText)).map((p) => p.name);
  if (named.length === 0) return { names: [] };
  const linked = await linkJournalPeople({ ...args, people: named.map((name) => ({ name, interacted: false })) });
  return { names: linked.linkedNames };
}

export interface LatestJournal {
  at: string;
  excerpt: string;
  /** The entry's id in its table; the feed anchors every entry as bd-<id>, whatever the table. */
  dumpId: string;
  /** W8b: which table the newest entry came from. */
  kind: "journal" | "reflection";
}

/**
 * The card excerpt: whole up to JOURNAL_EXCERPT_CHARS, else JOURNAL_EXCERPT_CHARS characters (trailing space trimmed)
 * plus an ellipsis. With a `name`, the window opens a little before the first whole-word match of that name (W8b,
 * audit B12, the chatSnippets shape), so the line shows the sentence about the person, not an unrelated prefix.
 */
export function journalExcerpt(raw: string, name?: string): string {
  const t = raw.trim();
  if (t.length <= JOURNAL_EXCERPT_CHARS) return t;
  const m = name ? nameMatcher(name).exec(t) : null;
  const from = m ? Math.max(0, m.index - 40) : 0;
  const lead = from > 0 ? "…" : "";
  return `${lead}${t.slice(from, from + JOURNAL_EXCERPT_CHARS).trim()}…`;
}
