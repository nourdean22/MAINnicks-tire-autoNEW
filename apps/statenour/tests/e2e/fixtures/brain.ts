/**
 * DEMO fixtures for Brain (/brain), UI v3 W4 gate (2026-10-19). Typed against the router's own output.
 *
 * WHICH TAB. The six-feet render opens /brain?tab=board, not the default Map tab. The Map is a
 * <canvas> force layout with random start positions (home-brain-graph.tsx syncSimSets): two renders of the
 * same payload place the nodes differently, and its node labels are canvas pixels, so no DOM anchor
 * can prove the render came from the fixtures. Board is a DOM tab with one read and real content, and
 * it carries the W4 change Brain got (the compact lens bar, components/layout/page-tabs.tsx).
 *
 * The one read the Board tab makes on load: brain.recentBoardConsultations (board-tab.tsx). Its
 * consult mutation never runs in a render.
 */
import type { inferRouterOutputs } from "@trpc/server";

import type { AppRouter } from "@/lib/trpc/root";

import { NOW_MS } from "./time";
import type { Wire } from "./wire";

type RouterOutputs = inferRouterOutputs<AppRouter>;

const hoursAgo = (hours: number): string => new Date(NOW_MS - hours * 3_600_000).toISOString();

/** The newest consultation's question: the Brain anchor. Exists only in these fixtures. */
export const BRAIN_BOARD_QUESTION = "Demo question: should the demo workshop take the second demo bay this quarter?";

const consult = (
  id: string,
  hours: number,
  question: string,
  recommendation: string,
  extra: Partial<Wire<RouterOutputs["brain"]["recentBoardConsultations"]["consultations"][number]>> = {},
): Wire<RouterOutputs["brain"]["recentBoardConsultations"]["consultations"][number]> => ({
  id,
  boardId: "strategic",
  boardName: "Demo strategic board",
  question,
  ranAt: hoursAgo(hours),
  recommendation,
  consensusCount: 3,
  divergenceCount: 1,
  confidence: 0.72,
  tension: "Demo tension: speed against cash on hand",
  advisorCount: 5,
  erroredCount: 0,
  droppedAdvisorIds: [],
  moodAtConsult: null,
  createdAt: hoursAgo(hours),
  ...extra,
});

export const BRAIN_BOARD_RECENTS: Wire<RouterOutputs["brain"]["recentBoardConsultations"]> = {
  consultations: [
    consult("demo-board-1", 3, BRAIN_BOARD_QUESTION, "Demo recommendation: take the bay on a three-month trial and review the demo numbers in week six."),
    consult("demo-board-2", 26, "Demo question: is the demo weekend schedule worth a second hire?", "Demo recommendation: not yet; move the demo Saturday work to two longer weekdays first.", {
      divergenceCount: 0,
      confidence: 0.81,
      tension: null,
    }),
    consult("demo-board-3", 74, "Demo question: which demo supplier should hold the default order?", "Demo recommendation: keep the current demo supplier and re-quote in thirty days.", {
      droppedAdvisorIds: ["contrarian", "risk"],
      moodAtConsult: "depleted",
      advisorCount: 3,
      confidence: 0.64,
    }),
  ],
  unreadable: 0,
};
