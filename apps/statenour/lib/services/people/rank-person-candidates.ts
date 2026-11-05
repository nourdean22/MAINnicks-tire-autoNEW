import { workingNicknames, type NicknamedPerson } from "@/lib/people/nicknames";

export interface PersonLite {
  id: string;
  name: string;
  role: string;
  nicknames?: string[];
}

/** Fuzzy-rank names and globally unambiguous nicknames for the command-palette ledger action. */
export function rankCandidates(rawName: string, people: PersonLite[]): Array<PersonLite & { score: number }> {
  const needle = rawName.toLowerCase();
  const canonicalPeople: NicknamedPerson[] = people.map((person) => ({
    id: person.id,
    name: person.name,
    metadata: { nicknames: person.nicknames ?? [] },
  }));
  return people
    .map((person, index) => {
      let score = 0;
      for (const word of [person.name, ...workingNicknames(canonicalPeople[index], canonicalPeople)]) {
        const hay = word.toLowerCase();
        if (hay === needle) score = 1;
        else if (hay.startsWith(needle)) score = Math.max(score, 0.85);
        else if (hay.includes(needle)) score = Math.max(score, 0.7);
      }
      return { ...person, score };
    })
    .filter((person) => person.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
