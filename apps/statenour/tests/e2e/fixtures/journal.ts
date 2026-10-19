/**
 * DEMO fixtures for Journal (/journal), UI v3 W4 gate (2026-10-19). Typed against the routers' outputs.
 *
 * The reads /journal makes on load (the page, ReflectComposer and JournalInsightsView, which mounts its
 * panels at every width; at 390px they sit inside a closed <details>, still mounted):
 *   journal.feed                 the entry list (use-journal-feed.ts, an infinite query: one page, no next cursor)
 *   journal.ghostCounterQuestion the composer's one-line question (null renders nothing)
 *   journal.insightsPreview      Nick's takes ([] is a measured empty)
 *   journal.metacognition        the learning-journal card (null renders nothing)
 *   journal.threads              the threads strip and the thread rail ([] measured empty)
 *   journal.convergence          the thread radar ([] measured empty)
 *   journal.suggestions          borderline thread joins ([] measured empty)
 *   task.missions                the mission breadcrumb (already answered by MISSIONS, ./missions.ts)
 * The feed carries the page's content; the side panels answer in their measured-empty shape so the render
 * is the loaded page, never an error state. The journal brief is a POST (never stubbed; it self-hides).
 * Entry rows fetch receipts and contradictions only when expanded; the render expands none.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc/root";

import { NOW_MS } from "./time";
import type { Wire } from "./wire";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Feed = Wire<RouterOutputs["journal"]["feed"]>;
type Entry = Feed["entries"][number];

/** The newest entry's title: the Journal anchor. Exists only in these fixtures. */
export const JOURNAL_ENTRY_TITLE = "Demo reflection: the demo bay decision felt rushed";

const hoursAgo = (hours: number): string => new Date(NOW_MS - hours * 3_600_000).toISOString();

const entry = (id: string, source: Entry["source"], hours: number, date: string, title: string, body: string, extra: Partial<Entry> = {}): Entry => ({
  id,
  source,
  createdAt: hoursAgo(hours),
  date,
  title,
  body,
  summary: null,
  mood: null,
  domains: [],
  linkedTopics: [],
  tasksCreated: 0,
  ...extra,
});

// FIXED_TIME is 2026-10-15 14:00 ET: hours 2 and 5 are that day, 21 and 27 the day before.
const ENTRIES: Entry[] = [
  entry("demo-journal-1", "reflection", 2, "2026-10-15", JOURNAL_ENTRY_TITLE, "Demo body: I said yes to the demo bay before the demo numbers were in. Next time, one night of sleep first.", {
    mood: "uneasy",
    domains: ["business"],
    linkedTopics: ["demo bay"],
  }),
  entry("demo-journal-2", "decision", 5, "2026-10-15", "Demo decision: hold the demo weekend hire until spring", "Demo body: two longer weekdays cover the demo Saturday load for now.", {
    domains: ["business"],
    tasksCreated: 1,
  }),
  entry("demo-journal-3", "dump", 21, "2026-10-14", "Demo thought: the demo morning routine slipped three days running", "Demo body: phone first, demo walk second. Swap them.", {
    mood: "flat",
    domains: ["health"],
  }),
  entry("demo-journal-4", "situation", 27, "2026-10-14", "Demo situation: the demo supplier pushed the order a week", "Demo body: called the demo supplier, agreed a partial delivery Friday.", {
    domains: ["business"],
    linkedTopics: ["demo supplier"],
  }),
];

export const JOURNAL_FEED: Feed = {
  entries: ENTRIES,
  counts: {
    total: ENTRIES.length,
    shown: ENTRIES.length,
    hasMore: false,
    bySource: {
      dump: ENTRIES.filter((e) => e.source === "dump").length,
      reflection: ENTRIES.filter((e) => e.source === "reflection").length,
      situation: ENTRIES.filter((e) => e.source === "situation").length,
      decision: ENTRIES.filter((e) => e.source === "decision").length,
      retro: ENTRIES.filter((e) => e.source === "retro").length,
    },
    byType: {},
  },
  nextCursor: null,
  degraded: [],
};

export const JOURNAL_GHOST_QUESTION: Wire<RouterOutputs["journal"]["ghostCounterQuestion"]> = null;
export const JOURNAL_INSIGHTS: Wire<RouterOutputs["journal"]["insightsPreview"]> = [];
export const JOURNAL_METACOGNITION: Wire<RouterOutputs["journal"]["metacognition"]> = null;
export const JOURNAL_THREADS: Wire<RouterOutputs["journal"]["threads"]> = [];
export const JOURNAL_CONVERGENCE: Wire<RouterOutputs["journal"]["convergence"]> = [];
export const JOURNAL_SUGGESTIONS: Wire<RouterOutputs["journal"]["suggestions"]> = [];
