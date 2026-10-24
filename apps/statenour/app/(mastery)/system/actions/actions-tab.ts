/**
 * `?tab=` on /system/actions. Wave E1 (2026-10-24) removed the tab buttons: the pending queue is the
 * page, and the log (success rings, rule leaderboard, recent feed) sits in a closed "History" fold.
 * `?tab=logs` opens that fold on load; anything else, including a missing or garbage value and Home's
 * `?tab=approvals` links, leaves it closed with the queue on top.
 */
export type ActionsTab = "logs" | "approvals";

export const ACTIONS_TAB_PARAM = "tab";

export function resolveActionsTab(param: string | null | undefined): ActionsTab {
  return param === "logs" ? "logs" : "approvals";
}
