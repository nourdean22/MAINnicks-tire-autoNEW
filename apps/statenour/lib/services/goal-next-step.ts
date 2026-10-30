/**
 * Suggested next step for a goal with none (2026-10-30, job goals-system W3).
 *
 * The GTD weekly review wants one current action on every outcome. The journal already
 * extracts action items from each entry (journal-ingest.ts, extractedItems.actionItems), and
 * the grounding pass links entries to goals (brain_dumps.goal_id). This picks the newest such
 * item, from a confidently linked entry, that is not already a task. The goal card offers it
 * with one tap; nothing is created on its own.
 */

/** A goal "has a next step" when one linked task is open, including a waiting-for (GTD). One list
 *  for the goal card, Nick's goal line and the Monday brief. */
export const NEXT_STEP_STATUSES = ["INBOX", "READY", "DOING", "WAITING"] as const;

/** journal-ingest stores sanitizeForPrompt(title, 150): trimmed, newlines to spaces, cut to 150 + "…". */
function normTitle(t: string): string {
  return t.replace(/\s+/g, " ").trim().replace(/…$/, "").slice(0, 150).trim().toLowerCase();
}

export interface JournalEntryRow {
  id: string;
  createdAt: Date;
  extractedItems: string | null;
}

export function pickJournalStep(
  entries: JournalEntryRow[],
  existingTaskTitles: string[],
): { title: string; dumpId: string } | null {
  const taken = new Set(existingTaskTitles.map(normTitle));
  const newestFirst = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const e of newestFirst) {
    let items: unknown;
    try {
      items = e.extractedItems ? (JSON.parse(e.extractedItems) as { actionItems?: unknown }).actionItems : null;
    } catch {
      continue; // an unreadable entry offers nothing
    }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const title = typeof (item as { title?: unknown })?.title === "string" ? (item as { title: string }).title.trim() : "";
      if (title.length > 3 && !taken.has(normTitle(title))) return { title: title.slice(0, 150), dumpId: e.id };
    }
  }
  return null;
}
