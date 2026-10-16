/**
 * `?tab=` on /system/actions (UI v3 W1b). Home's approval links carry `?tab=approvals` so "approve"
 * lands on the queue; anything else, including a missing or garbage value, is the log, the default.
 */
export type ActionsTab = "logs" | "approvals";

export const ACTIONS_TAB_PARAM = "tab";

export function resolveActionsTab(param: string | null | undefined): ActionsTab {
  return param === "approvals" ? "approvals" : "logs";
}
