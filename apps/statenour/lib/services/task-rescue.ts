/**
 * Task/Mission inbox rescue scanner (F3) — "show me what is unfiled, misfiled,
 * stale, or low-confidence." READ-ONLY: it suggests fixes with a reason +
 * confidence; it NEVER auto-moves anything.
 *
 * GENERAL anchors are protected: a task an operator deliberately routed to a
 * `systemKind:"GENERAL"` anchor is never flagged "misfiled" — at most we offer a
 * low-confidence "consider a specific project?" nudge for actively-worked ones.
 *
 * `classifyRescue` + `scanRescue` are PURE (testable on fixtures). The wrapper
 * does the read and maps Prisma rows to a normalized input (Json → boolean, so
 * no Prisma JsonValue leaks into the return — TS2589-safe).
 *
 * See docs/project/NEXT-INTELLIGENCE-WAVE.md (F3).
 */

import { prisma } from "@/lib/prisma";
import { isInboxMission, isGeneralAnchor } from "@/lib/services/mission-helpers";

/** Normalized, Prisma-free task shape the pure scanner reasons over. */
export interface RescueTaskInput {
  id: string;
  title: string;
  status: string; // INBOX | READY | DOING | WAITING | DONE | ARCHIVED
  loopKind: string | null; // ONCE | DAILY | PROMISE | WEEKLY
  missionTitle: string | null;
  missionSystemKind: string | null; // "GENERAL" for domain anchors
  hasNextPhysicalAction: boolean;
  hasPendingClassification: boolean;
  /** Most recent engagement; falls back to createdAt when never touched. */
  lastActivityAt: Date | null;
}

export type RescueIssue =
  | "pending_classification"
  | "legacy_inbox"
  | "stale"
  | "no_next_action"
  | "general_maybe_specific";

export interface RescueFinding {
  taskId: string;
  title: string;
  issue: RescueIssue;
  reason: string;
  confidence: number; // 0..1
  suggestedFix: string;
  missionTitle: string | null;
}

const STALE_DAYS = 30;
const ACTIVE = new Set(["READY", "DOING", "WAITING"]);
const TERMINAL = new Set(["DONE", "ARCHIVED"]);

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

/**
 * Classify ONE task into its single highest-priority rescue issue, or null if
 * it's healthy / terminal / a recurring daily. Pure.
 */
export function classifyRescue(t: RescueTaskInput, now: Date): RescueFinding | null {
  if (TERMINAL.has(t.status)) return null;
  // DAILY habits recur by design — not rescue candidates.
  if (t.loopKind === "DAILY") return null;

  const inGeneral = isGeneralAnchor({ systemKind: t.missionSystemKind });
  const base = { taskId: t.id, title: t.title, missionTitle: t.missionTitle };

  // 1 · awaiting the operator's classification approval (a parked low-confidence match)
  if (t.hasPendingClassification) {
    return { ...base, issue: "pending_classification", confidence: 0.9,
      reason: "Has a parked low-confidence classification awaiting your approval.",
      suggestedFix: "Approve or correct the suggested mission/goal." };
  }

  // 2 · sitting in a legacy Inbox mission (GENERAL anchors are NOT inbox — protected)
  if (!inGeneral && isInboxMission(t.missionTitle)) {
    return { ...base, issue: "legacy_inbox", confidence: 0.7,
      reason: "Sitting in a legacy Inbox mission instead of a domain anchor or a real project.",
      suggestedFix: "Move it to a specific project (or let the classifier route it to a domain anchor)." };
  }

  // 3 · stale — untouched for 30+ days while still open (applies in GENERAL too)
  if (ACTIVE.has(t.status) && t.lastActivityAt && daysBetween(now, t.lastActivityAt) >= STALE_DAYS) {
    return { ...base, issue: "stale", confidence: 0.6,
      reason: `Untouched for ${daysBetween(now, t.lastActivityAt)}+ days while still ${t.status.toLowerCase()}.`,
      suggestedFix: "Review: do the next action, snooze it, or archive it." };
  }

  // 4 · no concrete next physical action while actionable
  if ((t.status === "READY" || t.status === "DOING") && !t.hasNextPhysicalAction) {
    return { ...base, issue: "no_next_action", confidence: 0.5,
      reason: "Actionable but has no concrete next physical action.",
      suggestedFix: "Add a specific next action so it's executable." };
  }

  // 5 · actively worked inside a GENERAL anchor — gentle, optional, low-confidence
  if (inGeneral && t.status === "DOING") {
    return { ...base, issue: "general_maybe_specific", confidence: 0.3,
      reason: "Actively being worked inside a GENERAL domain anchor.",
      suggestedFix: "Optional: consider giving it a dedicated project. (Staying in GENERAL is fine.)" };
  }

  return null;
}

const PRIORITY: Record<RescueIssue, number> = {
  pending_classification: 5,
  legacy_inbox: 4,
  stale: 3,
  no_next_action: 2,
  general_maybe_specific: 1,
};

export interface RescueResult {
  scanned: number;
  findings: RescueFinding[];
  byIssue: Record<string, number>;
}

/** Scan a set of tasks. Pure. One finding per task (highest priority), sorted. */
export function scanRescue(tasks: RescueTaskInput[], now: Date): RescueResult {
  const findings: RescueFinding[] = [];
  for (const t of tasks) {
    const f = classifyRescue(t, now);
    if (f) findings.push(f);
  }
  findings.sort((a, b) => PRIORITY[b.issue] - PRIORITY[a.issue] || b.confidence - a.confidence);
  const byIssue: Record<string, number> = {};
  for (const f of findings) byIssue[f.issue] = (byIssue[f.issue] ?? 0) + 1;
  return { scanned: tasks.length, findings, byIssue };
}

export interface RescueDeps {
  loadTasks?: () => Promise<RescueTaskInput[]>;
  now?: Date;
}

/** Default loader: active, non-deleted tasks with their mission's title + systemKind. */
async function defaultLoadTasks(): Promise<RescueTaskInput[]> {
  const rows = await prisma.task.findMany({
    where: { deletedAt: null, status: { notIn: ["DONE", "ARCHIVED"] } },
    select: {
      id: true, title: true, status: true, loopKind: true,
      nextPhysicalAction: true, lastTouchedAt: true, createdAt: true,
      pendingClassification: true,
      mission: { select: { title: true, systemKind: true } },
    },
    take: 1000,
    orderBy: { lastTouchedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: String(r.status),
    loopKind: r.loopKind ? String(r.loopKind) : null,
    missionTitle: r.mission?.title ?? null,
    missionSystemKind: r.mission?.systemKind ?? null,
    hasNextPhysicalAction: (r.nextPhysicalAction ?? "").trim().length > 0,
    hasPendingClassification: r.pendingClassification != null,
    lastActivityAt: r.lastTouchedAt ?? r.createdAt ?? null,
  }));
}

/** Read-only rescue scan. No writes; suggestions only. */
export async function buildTaskRescue(deps: RescueDeps = {}): Promise<RescueResult> {
  const tasks = await (deps.loadTasks ?? defaultLoadTasks)();
  return scanRescue(tasks, deps.now ?? new Date());
}

// ── GENERAL-anchor visibility (Wire 2) ──────────────────────────────────
// /missions filters GENERAL anchors out of the project feed, so tasks the
// classifier routes there pile up INVISIBLY. This surfaces each anchor + its
// open-task count so the operator can see drift. Read-only. Computed
// server-side where Mission.systemKind is available.

export interface DomainAnchorSummary {
  missionId: string;
  title: string;
  domain: string | null;
  openCount: number;
}

/** One Mission row (GENERAL anchor) with its open tasks. */
export interface AnchorRow {
  id: string;
  title: string;
  canonicalDomain: string | null;
  domain: string | null;
  tasks: { id: string }[];
}

/** Map anchor rows → summaries, busiest first. Pure. */
export function summarizeAnchorRows(rows: AnchorRow[]): DomainAnchorSummary[] {
  return rows
    .map((a) => ({
      missionId: a.id,
      title: a.title,
      domain: a.canonicalDomain ?? a.domain ?? null,
      openCount: a.tasks.length,
    }))
    .sort((x, y) => y.openCount - x.openCount);
}

export interface AnchorDeps {
  loadAnchorRows?: () => Promise<AnchorRow[]>;
}

async function defaultLoadAnchorRows(): Promise<AnchorRow[]> {
  const rows = await prisma.mission.findMany({
    where: { systemKind: "GENERAL", deletedAt: null },
    select: {
      id: true,
      title: true,
      canonicalDomain: true,
      domain: true,
      tasks: {
        where: { deletedAt: null, status: { notIn: ["DONE", "ARCHIVED"] } },
        select: { id: true },
      },
    },
  });
  // domain is an enum at the type level; normalize to string|null for the flat return.
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    canonicalDomain: r.canonicalDomain ?? null,
    domain: r.domain ? String(r.domain) : null,
    tasks: r.tasks,
  }));
}

/** Read-only: GENERAL domain anchors + their open-task counts (busiest first). */
export async function buildDomainAnchors(deps: AnchorDeps = {}): Promise<DomainAnchorSummary[]> {
  const rows = await (deps.loadAnchorRows ?? defaultLoadAnchorRows)();
  return summarizeAnchorRows(rows);
}
