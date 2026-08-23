/**
 * Mission predicate helpers · v10.0.154 · May 03
 *
 * Single source of truth for "what counts as a real user-chosen project
 * vs a system-managed Inbox catch-all". Pre-fix, three surfaces filtered
 * inboxes differently:
 *
 *   · /tasks Plan view filtered ONLY the legacy bare "Inbox" — so
 *     auto-created per-domain inboxes ("Inbox - business") leaked
 *     through and counted as user projects.
 *   · /tasks Track tile + Stats showed every active mission with no
 *     filter at all, so total count drifted.
 *   · assertActiveMissionCap counted ALL active missions including
 *     every auto-created inbox, so the user ran out of cap slots
 *     after a few domain-swap operations created inboxes silently.
 *
 * Standardizing here so every surface answers "is this a project the
 * user picked?" the same way.
 *
 * Inbox titles match either:
 *   · "Inbox"                            (legacy single-mission)
 *   · "Inbox - <domain>"                 (per-domain auto-inbox)
 *
 * Both are case-insensitive and tolerate trailing whitespace because
 * the auto-create path lowercases the domain ("Inbox - business") but
 * we want to be defensive against legacy rows.
 */

import { GENERAL_ANCHOR_KIND } from "@/lib/missions/domains";

const INBOX_PATTERN = /^\s*inbox(\s*-\s*[a-z]+)?\s*$/i;

/**
 * True when a mission is a system-managed GENERAL per-domain anchor
 * (2026-06-09 · the formalized replacement for "Inbox - <domain>"). Keyed on
 * the structured `systemKind` flag, NOT the title — so a user project named
 * with "general" is never mistaken for one. Like inboxes, anchors are
 * infrastructure: excluded from project caps/counts, protected from delete.
 */
export function isGeneralAnchor(
  mission: { systemKind?: string | null } | null | undefined,
): boolean {
  return mission?.systemKind === GENERAL_ANCHOR_KIND;
}

/**
 * True when the mission title matches an Inbox pattern (legacy or
 * per-domain). System-managed catch-alls — exclude from project caps,
 * project counts, and "active projects" surfaces.
 */
export function isInboxMission(title: string | null | undefined): boolean {
  if (!title) return false;
  return INBOX_PATTERN.test(title);
}

/**
 * Inverse helper for filter predicates — easier to read in callers
 * (`missions.filter(isUserProject)` reads better than
 *  `missions.filter(m => !isInboxMission(m.title))`).
 */
export function isUserProject<
  T extends { title: string | null | undefined; systemKind?: string | null },
>(mission: T): boolean {
  // Exclude both the legacy Inbox catch-alls (by title) AND the new GENERAL
  // anchors (by flag). Callers that want anchors excluded from caps/counts
  // must `select: { systemKind: true }` — those that don't keep prior behavior.
  return !isInboxMission(mission.title) && !isGeneralAnchor(mission);
}

/**
 * Does this mission declare an end state — a point at which it is finished?
 *
 * WHY THIS EXISTS. MissionCard rendered a completion percentage on every
 * mission holding at least one task. Measured against prod on 2026-08-23,
 * that meant a "79%" chip on GENERAL BUSINESS & NICKS TIRE, whose own
 * successMetric column reads:
 *
 *     "Catch-all for business tasks with no specific project."
 *
 * A life-area bucket has no 100%. The percentage was `done / (done + open)`
 * over every task ever filed there, so it FELL when the operator captured a
 * new task — capture and completion moved one number in opposite directions,
 * and a bucket that is working perfectly sat at ~79% forever, reading as
 * "nearly finished".
 *
 * WHAT COUNTS. A deadline or an explicit completionCriteria. Both are
 * operator-set declarations that this thing ends. Measured 2026-08-23:
 * 0 of 9 missions carry completionCriteria; 2 carry a deadline, and both of
 * those are already COMPLETE/KILLED. So today this returns false for all
 * three ACTIVE missions — which is the correct reading, not a regression.
 *
 * WHAT DOES NOT COUNT: `successMetric`. It is populated on 6 of 9, but on the
 * catch-alls its value is literally the sentence quoted above — the field is
 * being used as a description, and four of its six values say outright that
 * there is no project. Gating on it would show a completion bar on exactly
 * the missions that declare they have no completion.
 *
 * SELF-RESTORING BY DESIGN. Set a deadline and the percentage returns with no
 * code change.
 *
 * ACCURACY NOTE, corrected under review. Only `deadline` is operator-settable
 * today. `completionCriteria` has NO writer anywhere in the app — the sole
 * repo-wide reference outside this file is the ALTER TABLE that created it —
 * and its schema doc (prisma/schema.prisma:248) says it "defines what
 * sourceSystem is required for canClaimDone()", while the real canClaimDone
 * (lib/ai/receipts/action-receipt.ts:215) takes receipts and never reads the
 * column. The field is dead and its documentation is stale.
 *
 * It is still checked here rather than keying on `deadline` alone, because the
 * concept the gate needs is "a declared completion condition" and that is what
 * this column is named for. Keying on the proxy would be indistinguishable
 * today and silently wrong the moment a writer lands. Including it costs
 * nothing; omitting it buys a gate that stops working without ever failing.
 */
export function missionHasEndState(mission: {
  deadline?: string | Date | null;
  completionCriteria?: unknown;
}): boolean {
  if (mission.deadline) return true;
  return isMeaningfulCriteria(mission.completionCriteria);
}

/** A JSON column is "declared" only if it holds something. `{}`/`[]`/"" do not. */
function isMeaningfulCriteria(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return Boolean(value);
}
