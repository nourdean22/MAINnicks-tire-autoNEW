import { workingNicknames, type NicknamedPerson } from "@/lib/people/nicknames";

type PromiseToMatch = { promiseTo: { equals: string; mode: "insensitive" } };

/** Legacy free-text links apply only when no explicit personId owns the task. */
export function legacyPromisePersonMatchWhere<T extends NicknamedPerson>(
  person: T,
  livePeople: readonly T[],
): { personId: null; OR: PromiseToMatch[] } | null {
  const matches: PromiseToMatch[] = [];
  const name = person.name.trim();
  if (name.length >= 2) matches.push({ promiseTo: { equals: name, mode: "insensitive" } });
  matches.push(...workingNicknames(person, livePeople).map((nickname) => ({ promiseTo: { equals: nickname, mode: "insensitive" as const } })));
  return matches.length > 0 ? { personId: null, OR: matches } : null;
}
