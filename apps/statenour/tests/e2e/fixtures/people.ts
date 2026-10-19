/**
 * DEMO fixtures for People (/people), UI v3 W4 gate (2026-10-19).
 *
 * People reads its two lists over REST, not tRPC (app/(mastery)/people/page.tsx):
 *   GET /api/people?sort=recent&limit=100   the atlas (usePollingFetch; a bare body or a { data } envelope both work)
 *   GET /api/relationships/watchlist        who needs you now (rawFetch, which REFUSES an envelope: bare body)
 * Both are answered from REST_FIXTURES in ./index.ts, matched by method and pathname (the query string is
 * not part of the key). The two Nick reads on the page are POSTs (relationships-morning-brief,
 * relationships-pick-today): mutations are never stubbed, both self-hide on the refusal, the same in
 * every tree. task.peopleChangesSince fires only once a last-visit cursor exists; a fresh browser has none.
 *
 * The response shapes are local mirrors: the page declares PersonRow / PeopleResponse inside the page
 * module and the routes do not export theirs. WatchlistItem IS exported, so that one is the real type.
 */
import type { WatchlistItem } from "@/components/relationships/relationships-watchlist";

import { NOW_ISO, NOW_MS } from "./time";

/** Mirror of PersonRow in app/(mastery)/people/page.tsx (not exported there). */
interface PersonRow {
  id: string;
  name: string;
  role: string;
  relationship: string;
  trustScore: number;
  leverageNotes: string | null;
  lastInteraction: string | null;
  interactionCount: number;
  daysSinceInteraction: number | null;
  isNeglected: boolean;
}

/** Mirror of PeopleResponse in the same page. */
interface PeopleResponse {
  people: PersonRow[];
  totals: { total: number; neglected: number; high_trust: number; sparse: number };
  generatedAt: string;
}

const daysAgoIso = (days: number): string => new Date(NOW_MS - days * 86_400_000).toISOString();

const person = (id: string, name: string, role: string, relationship: string, trustScore: number, days: number | null, interactionCount: number, leverageNotes: string | null = null): PersonRow => ({
  id,
  name,
  role,
  relationship,
  trustScore,
  leverageNotes,
  lastInteraction: days === null ? null : daysAgoIso(days),
  interactionCount,
  daysSinceInteraction: days,
  // The route's own rule: no contact in 30+ days (or never) is neglected.
  isNeglected: days === null || days >= 30,
});

/** The neglected contact's name: the People anchor. Exists only in these fixtures. */
export const PEOPLE_NEGLECTED_NAME = "Demo Supplier B";

const PEOPLE_ROWS: PersonRow[] = [
  person("demo-person-1", "Demo Mentor", "mentor", "Demo: monthly call about the demo expansion plan", 0.86, 2, 41, "Demo: knows the demo landlord"),
  person("demo-person-2", "Demo Partner", "partner", "Demo: co-owns the demo side project", 0.74, 6, 63),
  person("demo-person-3", "Demo Accountant", "advisor", "Demo: quarterly demo tax review", 0.62, 12, 18),
  person("demo-person-4", PEOPLE_NEGLECTED_NAME, "vendor", "Demo: holds the demo parts account", 0.48, 47, 22, "Demo: can move the demo order date"),
  person("demo-person-5", "Demo Cousin", "family", "Demo: the demo family dinner thread", 0.55, 95, 9),
];

export const PEOPLE_LIST: PeopleResponse = {
  people: PEOPLE_ROWS,
  totals: {
    total: PEOPLE_ROWS.length,
    neglected: PEOPLE_ROWS.filter((p) => p.isNeglected).length,
    high_trust: PEOPLE_ROWS.filter((p) => p.trustScore >= 0.7).length,
    sparse: 1,
  },
  generatedAt: NOW_ISO,
};

export const PEOPLE_WATCHLIST: { items: WatchlistItem[]; generatedAt: string } = {
  items: [
    { kind: "stale_90d", personId: "demo-person-5", personName: "Demo Cousin", summary: "Demo: no contact in 95 days", rank: 0 },
    { kind: "promise_broken", personId: "demo-person-4", personName: PEOPLE_NEGLECTED_NAME, summary: "Demo: the promised demo parts quote is 9 days late", rank: 1 },
  ],
  generatedAt: NOW_ISO,
};
