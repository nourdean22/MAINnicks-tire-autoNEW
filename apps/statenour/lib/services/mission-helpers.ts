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
