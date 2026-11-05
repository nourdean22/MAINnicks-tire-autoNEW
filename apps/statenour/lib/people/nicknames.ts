/**
 * A person's nicknames: PersonProfile.metadata.nicknames, a string list in his spelling. Pure (the client reads it too).
 *
 * The one rule every matching path shares: a nickname points at a person only when exactly one live person uses it and
 * no live person is named it. A shared nickname links nobody; a nickname equal to a name loses to that name.
 */
export const NICKNAME_MAX_CHARS = 40;
export const NICKNAMES_PER_PERSON = 12;

export interface NicknamedPerson {
  id: string;
  name: string;
  metadata?: unknown;
}

/** Trimmed, single-spaced, 2 to 40 characters, one per spelling in any case, capped. */
export function cleanNicknames(raw: readonly string[]): string[] {
  const out = new Map<string, string>();
  for (const item of raw) {
    const nick = item.trim().replace(/\s+/g, " ");
    const key = nick.toLowerCase();
    if (nick.length >= 2 && nick.length <= NICKNAME_MAX_CHARS && !out.has(key)) out.set(key, nick);
  }
  return [...out.values()].slice(0, NICKNAMES_PER_PERSON);
}

export function readNicknames(metadata: unknown): string[] {
  const list = (metadata as { nicknames?: unknown } | null | undefined)?.nicknames;
  if (!Array.isArray(list)) return [];
  return cleanNicknames(list.filter((n): n is string => typeof n === "string"));
}

/** Lower-cased nickname -> the people who use it. A nickname equal to any listed person's name is left out. */
export function nicknameOwners<T extends NicknamedPerson>(people: readonly T[]): Map<string, T[]> {
  const names = new Set(people.map((p) => p.name.trim().toLowerCase()));
  const owners = new Map<string, T[]>();
  for (const p of people) {
    for (const nick of readNicknames(p.metadata)) {
      const key = nick.toLowerCase();
      if (!names.has(key)) owners.set(key, [...(owners.get(key) ?? []), p]);
    }
  }
  return owners;
}

/** This person's nicknames that actually point at them among `people`. */
export function workingNicknames(person: NicknamedPerson, people: readonly NicknamedPerson[]): string[] {
  const owners = nicknameOwners(people);
  return readNicknames(person.metadata).filter((n) => owners.get(n.toLowerCase())?.length === 1);
}
