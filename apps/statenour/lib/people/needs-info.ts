/**
 * "Needs info" on /people (truth sweep 2026-10-23).
 *
 * The verdict line printed a count (`totals.sparse`) and its button called the unfiltered
 * revealBrowse(): it showed everyone, not the people counted. The rule below is the one the count
 * uses (app/api/people/route.ts) and the one the button now filters by, so the number and the list
 * cannot drift apart.
 */
export interface NeedsInfoPerson {
  role: string;
  leverageNotes: string | null;
}

/** A person is sparse when nothing is written about leverage, or their role is unknown. */
export const isSparsePerson = (p: NeedsInfoPerson): boolean => !p.leverageNotes || p.role === "unknown";

/** The rows the people list shows: optionally only the sparse ones, then the cap unless revealed. */
export function visiblePeopleRows<T extends NeedsInfoPerson>(
  people: readonly T[],
  opts: { needsInfoOnly: boolean; showAll: boolean; cap: number },
): T[] {
  const pool = opts.needsInfoOnly ? people.filter(isSparsePerson) : [...people];
  return opts.showAll ? pool : pool.slice(0, opts.cap);
}
