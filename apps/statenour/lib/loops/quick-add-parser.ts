/**
 * Quick-add parser — turns a raw one-liner into a Task payload
 * with the right loopKind + metadata. Used by the CommandDeck's
 * universal input on the Actions page.
 *
 * Syntax rules (all optional, parsed in any order):
 *
 *   Daily loop:
 *     "every day: <title>"
 *     "daily: <title>"
 *     "every morning <title>"       (morning|evening|night alias)
 *     "habit: <title>"
 *
 *   Promise:
 *     "promise @dania <title> by friday"
 *     "promise myself <title>"
 *     "@dania <title>"             (@mention anywhere ⇒ promise)
 *     "commit: <title> by <when>"
 *
 *   Once (default):
 *     "<title>"
 *     "<title> by <when>"          (bare due date still parsed)
 *
 *   Done (log a task already finished — created, then completed):
 *     "done: <title>"
 *     "did: <title>"
 *
 *   Token suffixes (any kind):
 *     "<title> /M30"               (effort band)
 *     "<title> @health"            (domain tag, when no @<name>)
 *
 * The parser is intentionally shallow — false positives for
 * "promise" syntax are fine because the user can always click the
 * kind toggle to correct them before saving. It just biases the
 * initial guess.
 */

import { parseQuickAdd as parseTokens } from "@/components/actions/shared";
import { weekdayET } from "@/lib/utils/datetime";

export type LoopKind = "ONCE" | "DAILY" | "PROMISE";

export interface QuickAddResult {
  title: string;
  loopKind: LoopKind;
  promiseTo?: string;
  dueDate?: Date;
  domain?: string;
  effort?: string;
  /**
   * `done:` / `did:` prefix — the operator finished this earlier and
   * is logging it for the record. The caller creates the task, then
   * immediately completes it.
   */
  markDone?: boolean;
}

/**
 * Parse a natural-language "by <when>" clause into a Date. Accepts
 * relative days (today, tomorrow, monday…sunday, friday) and a
 * handful of common short forms. Returns null if it can't parse.
 */
function parseByClause(raw: string): Date | null {
  const s = raw.trim().toLowerCase();
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  if (s === "today") return endOfDay(now);
  if (s === "tomorrow") return endOfDay(addDays(now, 1));
  if (s === "next week") return endOfDay(addDays(now, 7));
  if (s === "end of week" || s === "eow") {
    const daysUntilFriday = (5 - weekdayET(now) + 7) % 7 || 7;
    return endOfDay(addDays(now, daysUntilFriday));
  }

  // Day-of-week: "friday", "next friday" → next occurrence
  const dayMatch = s.match(/^(next\s+)?(\w+)$/);
  if (dayMatch) {
    const targetIdx = dayNames.indexOf(dayMatch[2]);
    if (targetIdx >= 0) {
      let diff = (targetIdx - weekdayET(now) + 7) % 7;
      if (diff === 0) diff = 7; // always future
      if (dayMatch[1]) diff += 7; // "next friday" = +7 days past next occurrence
      return endOfDay(addDays(now, diff));
    }
  }

  // Numeric: "3 days", "2 weeks"
  const numMatch = s.match(/^(\d+)\s*(day|days|week|weeks)$/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    const mult = numMatch[2].startsWith("week") ? 7 : 1;
    return endOfDay(addDays(now, n * mult));
  }

  return null;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function endOfDay(d: Date): Date {
  const next = new Date(d);
  next.setHours(23, 59, 59, 999);
  return next;
}

export function parseQuickAdd(raw: string): QuickAddResult | null {
  const input = raw.trim();
  if (!input) return null;

  let working = input;
  let loopKind: LoopKind = "ONCE";
  let promiseTo: string | undefined;
  let dueDate: Date | undefined;

  // ── DONE prefix ──
  // "done: cleaned the garage" / "did: oil change" → log a task the
  // operator already finished. Stripped first so the remainder still
  // parses for kind / @domain / /effort / "by <when>". The colon is
  // REQUIRED (unlike daily:) — a bare "did X" collides too easily with
  // a genuine to-do ("did I lock the door?").
  let markDone = false;
  const doneMatch = working.match(/^(?:done|did)\s*:\s*(.+)$/i);
  if (doneMatch) {
    markDone = true;
    working = doneMatch[1];
  }

  // ── DAILY detection ──
  // "every day: X" / "daily: X" / "habit: X" / "every morning X"
  const dailyMatch = working.match(
    /^(every\s+day|daily|habit|every\s+morning|every\s+evening|every\s+night)\s*:?\s+(.+)$/i
  );
  if (dailyMatch) {
    loopKind = "DAILY";
    working = dailyMatch[2];
  }

  // ── PROMISE detection ──
  //   "promise @name ..." / "promise myself ..."
  //   "commit: ..." / "commitment: ..."
  //   "@name ..." (leading @mention)
  const explicitPromise = working.match(
    /^(promise\s+)?(@(\w+)|myself|dania|nour)\s+(.+)$/i
  );
  const commitPrefix = working.match(/^(commit|commitment)\s*:?\s+(.+)$/i);
  if (loopKind !== "DAILY") {
    if (explicitPromise) {
      loopKind = "PROMISE";
      promiseTo = explicitPromise[3] || explicitPromise[2].replace(/^@/, "");
      working = explicitPromise[4];
    } else if (commitPrefix) {
      loopKind = "PROMISE";
      promiseTo = "myself";
      working = commitPrefix[2];
    }
  }

  // ── "by <when>" clause (valid for ONCE + PROMISE) ──
  // Match from the end so title doesn't get overrun if "by" appears
  // mid-sentence ("pay by credit card" must NOT parse as dueDate).
  // We only consume "by" that's close to the END of the string.
  const byMatch = working.match(/\s+by\s+(.+?)$/i);
  if (byMatch && loopKind !== "DAILY") {
    const parsed = parseByClause(byMatch[1]);
    if (parsed) {
      dueDate = parsed;
      working = working.slice(0, byMatch.index).trim();
    }
  }

  // ── Strip trailing punctuation ──
  working = working.replace(/[.!?]+$/, "").trim();

  // ── Reuse existing token parser for @domain + /effort tokens ──
  const tokenParsed = parseTokens(working);
  const title = tokenParsed.title || working;
  const domain = tokenParsed.domain;
  const effort = tokenParsed.effort;

  if (!title || title.length < 2) return null;

  return {
    title,
    loopKind,
    promiseTo,
    dueDate,
    domain,
    effort,
    markDone,
  };
}
