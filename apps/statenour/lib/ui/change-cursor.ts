/**
 * ChangeSet · "since your last visit" as a primitive · 2026-09-15 (wave 3).
 *
 * Home's ChangeLine (components/home/change-line.tsx) carried the whole
 * idea inline: a per-surface localStorage cursor that advances only after
 * the operator has had time to READ the line (settle rule), a server clamp
 * so a month-old cursor scans 7 days and says so, and three honesty rules
 * for the rendered sentence — a failed source is NAMED, "no recorded
 * errors" is claimable only when the error read succeeded, and an empty
 * set renders nothing rather than "0 changes". Brain's Changed view is the
 * second consumer, so the rules move here, pure and testable; the hook and
 * the line component wrap them.
 *
 * Storage keys keep Home's existing spelling (`nour:hq-last-visit`) so the
 * operator's cursor survives the refactor.
 */

export interface ChangePart {
  label: string;
  count: number;
}

export interface ChangeSet {
  /** Clamped window start actually used (ms epoch). */
  since: number;
  /** True when the requested cursor was older than the clamp window. */
  clamped: boolean;
  parts: ChangePart[];
  /** Sources that could not be read — named, never zeroed. */
  failedSources: string[];
  /** "no recorded errors" is only claimable when the read succeeded. */
  errors: { measured: boolean; count: number };
}

export const CHANGE_CURSOR_SETTLE_MS = 5_000;
/** Don't scan unbounded history — a cursor from a month-old visit clamps to 7 days and says so. */
export const CHANGE_CURSOR_MAX_WINDOW_MS = 7 * 86_400_000;

export interface CursorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function cursorKey(surface: string): string {
  return `nour:${surface}-last-visit`;
}

/** The stored cursor, or 0 when missing / unreadable / not a positive number. */
export function readCursor(storage: CursorStorage | null | undefined, key: string): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(key);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Best-effort write; storage full or disabled is not an error the operator needs. */
export function writeCursor(storage: CursorStorage | null | undefined, key: string, nowMs: number): void {
  if (!storage) return;
  try {
    storage.setItem(key, String(nowMs));
  } catch {
    /* ignore */
  }
}

/** Server-side clamp: the window actually scanned, and whether it was shortened. */
export function clampSince(sinceMsRaw: number, nowMs: number, maxWindowMs = CHANGE_CURSOR_MAX_WINDOW_MS): { since: number; clamped: boolean } {
  const clamped = nowMs - sinceMsRaw > maxWindowMs;
  return { since: clamped ? nowMs - maxWindowMs : sinceMsRaw, clamped };
}

/**
 * The sentence, as bits: "3 closed" · "no recorded errors" (measured only) ·
 * "memories/approvals unread". Empty when nothing changed AND nothing failed
 * — the caller renders nothing, never "0 changes".
 */
export function describeChangeSet(set: ChangeSet): string[] {
  const bits: string[] = set.parts.filter((p) => p.count > 0).map((p) => `${p.count} ${p.label}`);
  if (set.errors.measured) {
    bits.push(set.errors.count === 0 ? "no recorded errors" : `${set.errors.count} errors logged`);
  }
  if (set.failedSources.length > 0) bits.push(`${set.failedSources.join("/")} unread`);
  return bits;
}

export function formatSince(sinceMs: number): string {
  return new Date(sinceMs).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
