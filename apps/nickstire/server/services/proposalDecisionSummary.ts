/**
 * proposals.decisionSummary -- how the owner has been deciding the approval queue.
 *
 * Source: the audit log rows `proposal.approved` / `proposal.rejected` that `auditTransition` writes
 * (services/proposals.ts). They are the immutable decision record: `created_at` is when the decision
 * happened and never moves. `admin_proposals.reviewed_at` is NOT that time -- `casTransition` rewrites it
 * on every transition that names a reviewer, so a retry or a resolved-ambiguous move an old approval
 * into the current window. `proposals.list` is also capped (500, newest created first) and carries
 * payload and context rows (customer names, phones); this read selects none of them.
 *
 * A failed read is `available: false`, never a zero-filled success (empty-vs-error).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { adminProposals, auditLog } from "../../drizzle/schema";
import { PROPOSAL_REASON_CHIPS } from "../../shared/proposalReasons";
import { db } from "../lib/db-helper";
import { logSafeErrorMessage } from "../lib/dbErrors";
import { createLogger } from "../lib/logger";

const log = createLogger("proposalDecisionSummary");

const DECISION_ACTIONS = ["proposal.approved", "proposal.rejected"] as const;
type Decision = "approved" | "turned_down";
const DECISION_OF: Record<(typeof DECISION_ACTIONS)[number], Decision> = {
  "proposal.approved": "approved",
  "proposal.rejected": "turned_down",
};

const NO_REASON = "No reason given";
const UNKNOWN_TYPE = "unknown";
const REASON_MAX = 80;
const TOP_REASONS = 3;
const DAY_MS = 86_400_000;
/** The sheet writes a chip, then a spaced middle dot, then typed text. */
const CHIP_TEXT_SEPARATOR = " \u00b7";

export type ProposalDecisionSummary =
  | {
      available: true;
      days: number;
      /** ISO start of the window. A label: the filtering itself runs in SQL (DATE_SUB(NOW(), ...)). */
      since: string;
      byType: Array<{ actionType: string; approved: number; turnedDown: number }>;
      /** Top 3 reasons over the turned-down decisions in the window. */
      topReasons: Array<{ reason: string; count: number }>;
      /** The newest decision event of ALL time (not windowed); null only when there has never been one. */
      lastDecision: { at: string; decision: Decision; actionType: string | null } | null;
    }
  | { available: false; reason: "error" | "no_db"; message: string };

interface WindowRow {
  entityId: string | null;
  action: string;
  createdAt: Date;
  note: string | null;
  actionType: string | null;
}
interface LastRow {
  action: string;
  createdAt: Date;
  actionType: string | null;
}

/** Rows may arrive as Dates (drizzle maps TIMESTAMP) or UTC text; one place turns either into ISO, or throws. */
function toIso(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "string" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(" ", "T")}Z` : String(value));
  if (Number.isNaN(date.getTime())) throw new Error("audit_log.created_at is not a readable time");
  return date.toISOString();
}

function normalizeReason(note: string | null | undefined): string {
  const text = (note ?? "").trim();
  if (!text) return NO_REASON;
  const lower = text.toLowerCase();
  for (const chip of PROPOSAL_REASON_CHIPS) {
    const c = chip.toLowerCase();
    if (lower === c || lower.startsWith(`${c}${CHIP_TEXT_SEPARATOR}`)) return chip;
  }
  return text.slice(0, REASON_MAX);
}

export async function getDecisionSummary({ days }: { days: number }): Promise<ProposalDecisionSummary> {
  try {
    const d = await db();
    if (!d) return { available: false, reason: "no_db", message: "The decision history could not be read: no database." };

    const decisionRows = and(eq(auditLog.entityType, "proposal"), inArray(auditLog.action, [...DECISION_ACTIONS]));

    // A plain select of the window's decision rows, aggregated below: only_full_group_by is on, and the window is small.
    const windowRows: WindowRow[] = await d
      .select({
        entityId: auditLog.entityId,
        action: auditLog.action,
        createdAt: auditLog.createdAt,
        // The rejection reason lives in after_json.note (recordActivity's `after`). Only a JSON string counts as a note.
        note: sql<string | null>`CASE WHEN JSON_TYPE(JSON_EXTRACT(${auditLog.afterJson}, '$.note')) = 'STRING' THEN JSON_UNQUOTE(JSON_EXTRACT(${auditLog.afterJson}, '$.note')) END`,
        actionType: adminProposals.actionType,
      })
      .from(auditLog)
      .leftJoin(adminProposals, eq(adminProposals.id, auditLog.entityId))
      .where(and(decisionRows, sql`${auditLog.createdAt} >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`))
      .orderBy(asc(auditLog.createdAt));

    const [last]: LastRow[] = await d
      .select({ action: auditLog.action, createdAt: auditLog.createdAt, actionType: adminProposals.actionType })
      .from(auditLog)
      .leftJoin(adminProposals, eq(adminProposals.id, auditLog.entityId))
      .where(decisionRows)
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    // Each proposal counts once, by its latest decision event in the window.
    const latest = new Map<string, { at: number; decision: Decision; note: string | null; actionType: string }>();
    windowRows.forEach((r, i) => {
      const decision = DECISION_OF[r.action as keyof typeof DECISION_OF];
      if (!decision) return; // belt: only approve / reject events are decisions (executed, submitted, ... are not)
      const at = Date.parse(toIso(r.createdAt));
      const key = r.entityId ?? `row:${i}`;
      const prev = latest.get(key);
      if (!prev || at >= prev.at) {
        latest.set(key, { at, decision, note: r.note ?? null, actionType: r.actionType ?? UNKNOWN_TYPE });
      }
    });

    const types = new Map<string, { approved: number; turnedDown: number }>();
    const reasons = new Map<string, number>();
    for (const v of latest.values()) {
      const t = types.get(v.actionType) ?? { approved: 0, turnedDown: 0 };
      if (v.decision === "approved") t.approved += 1;
      else {
        t.turnedDown += 1;
        const reason = normalizeReason(v.note);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      types.set(v.actionType, t);
    }

    const byType = [...types.entries()]
      .map(([actionType, t]) => ({ actionType, ...t }))
      .sort((a, b) => b.approved + b.turnedDown - (a.approved + a.turnedDown) || (a.actionType < b.actionType ? -1 : 1));
    const topReasons = [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1))
      .slice(0, TOP_REASONS);

    let lastDecision: Extract<ProposalDecisionSummary, { available: true }>["lastDecision"] = null;
    if (last) {
      const decision = DECISION_OF[last.action as keyof typeof DECISION_OF];
      if (!decision) throw new Error(`unexpected audit action ${last.action}`);
      lastDecision = { at: toIso(last.createdAt), decision, actionType: last.actionType ?? null };
    }

    return {
      available: true,
      days,
      since: new Date(Date.now() - days * DAY_MS).toISOString(),
      byType,
      topReasons,
      lastDecision,
    };
  } catch (err) {
    const message = logSafeErrorMessage(err);
    log.error("decision summary read failed", { error: message });
    return { available: false, reason: "error", message: `The decision history could not be read: ${message}` };
  }
}
