/**
 * The one nickname writer: the /people card and Nick's person.update both land here.
 *
 * metadata is one JSON object the people engine also stamps, so this is a compare-and-swap on the object it read. A
 * lost swap re-reads once; a second one throws, because a quiet drop is the failure this exists to prevent.
 */
import { prisma } from "@/lib/prisma";
import { NICKNAME_MAX_CHARS, NICKNAMES_PER_PERSON, cleanNicknames, readNicknames, workingNicknames } from "@/lib/people/nicknames";
import { Prisma } from "@prisma/client";

const SAME = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export interface NicknameEdit {
  add?: readonly string[];
  remove?: readonly string[];
}

export interface NicknameResult {
  nicknames: string[];
  /** Saved, but matching nobody: another person shares it or is named it. */
  dead: string[];
}

/** The person a term names as a nickname and nothing else; for a lookup that already matched on the name. */
export async function personIdByNickname(term: string): Promise<string | null> {
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const r = await resolvePersonByName(term, { createIfMissing: false, fuzzy: false });
  return r.matchTier === "nickname" ? (r.person?.id ?? null) : null;
}

/** Resolve an exact name or unique exact nickname before a caller tries partial-name search. */
export async function resolvePersonForBusinessSearch(term: string): Promise<{
  person: { id: string; name: string } | null;
  ambiguous: boolean;
}> {
  const { resolvePersonByName } = await import("@/lib/brain/person-profile-fuzzy");
  const result = await resolvePersonByName(term, { createIfMissing: false, fuzzy: false });
  return {
    person: result.person,
    ambiguous: result.matchTier === "shared_nickname",
  };
}

/**
 * `refuseTaken` is for a caller model text can reach: a nickname someone else uses or is named stops the whole edit, so
 * words Nick read somewhere cannot mark a nickname shared and unlink its owner. The /people drawer may still share one.
 */
export async function editNicknames(personId: string, edit: NicknameEdit, opts: { refuseTaken?: boolean } = {}): Promise<NicknameResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const people = await prisma.personProfile.findMany({ where: { deletedAt: null }, select: { id: true, name: true, metadata: true } });
    const person = people.find((p) => p.id === personId);
    if (!person) throw new Error("Person not found");

    const current = readNicknames(person.metadata);
    const kept = current.filter((n) => !edit.remove?.some((r) => SAME(r, n)));
    const nicknames = cleanNicknames([...kept, ...(edit.add ?? [])]).filter((n) => !SAME(n, person.name));
    const refused = (edit.add ?? []).find((w) => !SAME(w.trim(), person.name) && !nicknames.some((n) => SAME(n, w.trim().replace(/\s+/g, " "))));
    if (refused !== undefined) {
      throw new Error(`Can't add "${refused.trim()}": a nickname is a name for one person, 2 to ${NICKNAME_MAX_CHARS} characters, ${NICKNAMES_PER_PERSON} per person.`);
    }
    if (opts.refuseTaken) {
      for (const n of nicknames.filter((w) => !current.some((c) => SAME(c, w)))) {
        const owner = people.find((p) => p.id !== personId && (SAME(p.name.trim(), n) || readNicknames(p.metadata).some((o) => SAME(o, n))));
        if (owner) throw new Error(`"${n}" already points at ${owner.name}. Nothing changed. Nour can share it from /people.`);
      }
    }
    const after = { ...person, metadata: { nicknames } };
    const others = people.map((p) => (p.id === personId ? after : p));
    const working = workingNicknames(after, others);
    const result = { nicknames, dead: nicknames.filter((n) => !working.includes(n)) };
    if (nicknames.length === current.length && nicknames.every((n, i) => n === current[i])) return result;

    const prior = person.metadata;
    const meta = prior && typeof prior === "object" && !Array.isArray(prior) ? (prior as Record<string, unknown>) : {};
    try {
      await prisma.personProfile.update({
        where: { id: personId, metadata: { equals: (prior ?? Prisma.AnyNull) as Prisma.InputJsonValue } },
        data: { metadata: { ...meta, nicknames } },
      });
      return result;
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code !== "P2025") throw err;
    }
  }
  throw new Error("Nicknames changed while saving. Try again.");
}
