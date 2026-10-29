/**
 * lib/automation/live-decisions.ts · 2026-10-29 sync audit, finding 2.
 *
 * The one count of decisions waiting on the operator, read by Home (lib/home/operator-brief.ts),
 * the app badge (components/hud/app-badge.tsx) and /system/actions. Live = an approval request or
 * an autonomous action that can still be approved now; expired = the window passed (listed, not
 * waiting). Pure, so the server brief and the client pages share it.
 */

export function countLiveDecisions(
  requests: ReadonlyArray<{ expired?: boolean }>,
  actions: ReadonlyArray<{ expired?: boolean }>,
): { live: number; expired: number } {
  const expired = requests.filter((r) => r.expired === true).length + actions.filter((a) => a.expired === true).length;
  return { live: requests.length + actions.length - expired, expired };
}

/** The same "live" for a server count query on approval_requests: pending, and not past its own expiresAt. */
export function liveApprovalRequestWhere(now: Date = new Date()) {
  return { status: "pending_approval", expiresAt: { gt: now } };
}
