/**
 * Weekly-Review Context · "Nick remembers the week"
 *
 * The weekly review is computed every Sunday (cron `weekly-review` ·
 * wins/misses/patterns/focus persisted to BrainMemory category
 * `weekly_review`) and the operator's own ReviewWizard writes a
 * forward commitment row (serve/surprise) into the same category —
 * but neither was ever deterministically injected into the chat
 * system prompt. Nick could only "remember the week" if vector
 * recall happened to surface the row (evolution audit 2026-06-10:
 * "Reactive Nick" — weekly pattern data computed every Sunday and
 * never injected; Nick cannot open Monday with 'this is the second
 * week in a row you skipped X').
 *
 * This engine closes that gap: a pure DB read (no AI call at prompt
 * time) over the most recent weekly_review rows (14-day window so
 * "this week + last week" are both visible), rendered as a compact
 * block. Loaded on the CORE tier — the felt moment ("good morning"
 * on Monday) classifies as core, so a gated tier would hide it
 * exactly when it matters.
 *
 * Honesty: no rows in the window → "" (section silently absent,
 * same contract as every other engine). The tail instruction
 * forbids claiming week-over-week patterns beyond what is shown.
 */

import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/utils/error-log";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** Window: covers the latest two Sunday cron reviews plus any wizard row. */
const LOOKBACK_DAYS = 14;

/** Most rows ever rendered (2 cron weeks + 1 wizard commitment). */
const MAX_ROWS = 3;

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function ageLabel(updatedAt: Date): string {
  const days = Math.floor((Date.now() - updatedAt.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  return `${days}d ago`;
}

interface ReviewRow {
  key: string;
  content: string;
  metadata: unknown;
  source: string | null;
  updatedAt: Date;
}

/**
 * Render one weekly_review row. Two known shapes:
 *  · cron `weekly-review` — metadata { weekStart, wins, misses, patterns, focus }
 *  · ReviewWizard `saveWeeklyReview` — metadata { weekKey, serveText, surpriseText }
 * Unknown/malformed metadata falls back to the row's content summary.
 * `primary` rows (most recent) get the full field set; older rows get
 * focus + patterns only, keeping the block inside its ~800-char cap.
 */
function renderRow(row: ReviewRow, primary: boolean): string[] {
  const meta = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>;
  const age = ageLabel(row.updatedAt);

  const weekStart = str(meta.weekStart);
  const focus = str(meta.focus);
  const patterns = str(meta.patterns);
  if (weekStart || focus || patterns) {
    // Cron retrospective shape.
    const lines = [`Week of ${weekStart ?? row.key.replace(/^weekly:/, "")} (auto review · ${age}):`];
    if (focus) lines.push(`  Focus set: ${clip(focus, 140)}`);
    if (patterns) lines.push(`  Patterns: ${clip(patterns, 140)}`);
    if (primary) {
      const wins = str(meta.wins);
      const misses = str(meta.misses);
      if (wins || misses) {
        lines.push(`  ${wins ? `Wins: ${clip(wins, 90)}` : ""}${wins && misses ? " | " : ""}${misses ? `Misses: ${clip(misses, 90)}` : ""}`);
      }
    }
    return lines;
  }

  if (str(meta.serveText) || str(meta.surpriseText) || str(meta.weekKey)) {
    // ReviewWizard forward-commitment shape · content is already a compact summary.
    return [`Operator's own commitment (week ${str(meta.weekKey) ?? row.key} · ${age}): ${clip(row.content, 160)}`];
  }

  // Unknown shape — honest fallback to the stored summary.
  return [`${row.key} (${age}): ${clip(row.content, 140)}`];
}

/**
 * Cross-week memory block for the system prompt. Returns "" when no
 * weekly review exists within the lookback window (honest absence —
 * never renders a stale week as if it were current).
 */
export async function getWeeklyReviewContext(): Promise<string> {
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: BRAIN_CATEGORIES.WEEKLY_REVIEW,
        deletedAt: null,
        updatedAt: { gte: daysAgo(LOOKBACK_DAYS) },
      },
      orderBy: { updatedAt: "desc" },
      take: MAX_ROWS,
      select: { key: true, content: true, metadata: true, source: true, updatedAt: true },
    })
    .catch((err) => {
      logError("brain.weekly-review-context", err, { fn: "getWeeklyReviewContext.findMany" });
      return null;
    });

  if (!rows || rows.length === 0) return "";

  const body: string[] = [];
  rows.forEach((row, i) => {
    try {
      body.push(...renderRow(row, i === 0));
    } catch (err) {
      logError("brain.weekly-review-context", err, { fn: "getWeeklyReviewContext.renderRow", key: row.key });
    }
  });
  if (body.length === 0) return "";

  return [
    `── WEEKLY REVIEWS (cross-week memory · last ${LOOKBACK_DAYS}d) ──`,
    ...body,
    `Use this for week-over-week continuity — name repeats explicitly ("second week in a row…"). Never claim a week-over-week pattern that is not visible above; if the data is missing, say it's missing.`,
  ].join("\n");
}
