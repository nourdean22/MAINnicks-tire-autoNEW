/**
 * Plain-words helpers for the Approvals queue: the card as labelled lines, the 30-day summary over a
 * second read of proposals.list, and the last-decision line. Pure functions; ApprovalsSection renders them.
 *
 * Shop data: most receptionist booking requests are turned down on purpose (a walk-in shop holds no
 * slots), so a turn-down count is only useful next to its reasons.
 */
import { BUSINESS_TIME_ZONE, getBusinessDateKey } from "@/lib/businessDate";
import { fmtPhone } from "../voice/format";

const DAY_MS = 86_400_000;
const SUMMARY_WINDOW_DAYS = 30;
/** The server's own cap for proposals.list; a read that returns this many rows may have been cut short. */
export const SUMMARY_READ_LIMIT = 500;
const NO_REASON = "No reason given";
const PLACEHOLDER_NAME = "caller";

/** One-tap reasons for turning a proposal down. The note sent is the reason text itself. */
export const REJECT_REASONS = [
  "Walk-in, no booking needed",
  "Not a real request",
  "Already handled",
  "Duplicate",
  "Other",
] as const;

const TYPE_WORDS: Record<string, { plural: string; singular: string }> = {
  create_booking_request: { plural: "Booking requests", singular: "booking request" },
  create_callback: { plural: "Callback requests", singular: "callback request" },
};
export const typePlural = (actionType: string) => TYPE_WORDS[actionType]?.plural ?? actionType;
const typeSingular = (actionType: string) => TYPE_WORDS[actionType]?.singular ?? actionType;

/** "owner@example.com" -> "owner": the domain is noise on a card the owner already owns. */
export function localPart(who: string): string {
  const at = who.indexOf("@");
  return at > 0 ? who.slice(0, at) : who;
}

export function sourceWords(source: string, actor: string): string {
  return source === "nick_receptionist" ? "from the receptionist" : `from ${localPart(actor)}`;
}

/* ------------------------------- shop-clock dates ------------------------------- */

function parts(date: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, ...opts });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

// Built from parts with plain spaces: newer ICU puts a narrow no-break space before AM/PM.
function dayWords(date: Date, timeZone: string): string {
  const p = parts(date, timeZone, { weekday: "short", month: "short", day: "numeric" });
  return `${p.weekday} ${p.month} ${p.day}`;
}

function shopMoment(date: Date): string {
  const t = parts(date, BUSINESS_TIME_ZONE, { hour: "numeric", minute: "2-digit" });
  return `${dayWords(date, BUSINESS_TIME_ZONE)}, ${t.hour}:${t.minute} ${t.dayPeriod}`;
}

/**
 * "2026-10-25" as "Sun Oct 25", "today (...)" or "tomorrow (...)" against the shop date NOW (not the day the
 * request came in), and "Sun Oct 25 (passed)" for a day that is over.
 */
function whenWords(preferredDate: string, now: Date): string {
  const day = new Date(`${preferredDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== preferredDate) {
    return preferredDate;
  }
  const words = dayWords(day, "UTC");
  const away = Math.round((Date.parse(`${preferredDate}T00:00:00Z`) - Date.parse(`${getBusinessDateKey(now)}T00:00:00Z`)) / DAY_MS);
  if (away < 0) return `${words} (passed)`;
  if (away === 0) return `today (${words})`;
  if (away === 1) return `tomorrow (${words})`;
  return words;
}

/* ------------------------------- the card in words ------------------------------- */

interface PayloadLine {
  label: string;
  value: string;
}

const scalar = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  return typeof v === "number" && Number.isFinite(v) ? String(v) : null;
};

/** "preferredSlot" and "seat_count" -> "Preferred slot" and "Seat count". */
const keyInWords = (key: string) => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * What the executor will receive, as labelled lines. The raw JSON is not dropped: the card keeps it in
 * its Technical details fold. Shapes follow server/services/proposals.ts (createBookingRequestPayload,
 * createCallbackPayload).
 */
export function describeProposal(actionType: string, payload: unknown, now: Date): PayloadLine[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const p = payload as Record<string, unknown>;
  const lines: PayloadLine[] = [];
  const add = (label: string, value: string | null) => {
    if (value) lines.push({ label, value });
  };
  const phone = scalar(p.phone);
  const name = scalar(p.name);
  const realName = name && name.toLowerCase() !== PLACEHOLDER_NAME ? name : null;

  if (actionType === "create_booking_request") {
    add("Wants", scalar(p.service));
    const date = scalar(p.preferredDate);
    add("When", date ? whenWords(date, now) : "no date given");
    add("Note", scalar(p.note));
    add("Phone", phone && fmtPhone(phone));
    add("Name", realName);
  } else if (actionType === "create_callback") {
    add("Reason", scalar(p.reason));
    add("Phone", phone && fmtPhone(phone));
    add("Name", realName);
    add("From page", scalar(p.sourcePage));
  } else {
    for (const [key, value] of Object.entries(p)) add(keyInWords(key), scalar(value));
  }
  return lines;
}

/* ------------------------------- the 30-day summary ------------------------------- */

interface DecidedRow {
  actionType: string;
  status: string;
  createdAt: Date | string;
  reviewedAt?: Date | string | null;
  reviewNote?: string | null;
}

/**
 * Every status a human decision leaves behind. "rejected" is a no; the rest are a yes that went on to run,
 * fail, hang or park (an approved-then-failed request is still an approval).
 */
export const DECIDED_STATUSES = ["executed", "rejected", "failed", "approved", "executing", "execution_ambiguous"] as const;
const isDecided = (status: string) => (DECIDED_STATUSES as readonly string[]).includes(status);

/** When the human decided; legacy rows with no reviewedAt fall back to created. Null when neither parses. */
function decidedAt(r: DecidedRow): Date | null {
  const at = new Date(r.reviewedAt ?? r.createdAt);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** A note that starts with a reason chip counts under the chip, so typed detail does not split the tally. */
function reasonKey(note: string | null | undefined): string {
  const text = (note ?? "").trim();
  if (!text) return NO_REASON;
  return REJECT_REASONS.find((r) => text === r || text.startsWith(`${r} · `)) ?? text;
}

export function summarizeDecisions(rows: DecidedRow[], now: number) {
  const since = now - SUMMARY_WINDOW_DAYS * DAY_MS;
  const perType = new Map<string, { approved: number; turnedDown: number }>();
  const reasons = new Map<string, number>();
  for (const r of rows) {
    const at = isDecided(r.status) ? decidedAt(r) : null;
    if (!at || at.getTime() < since) continue;
    const t = perType.get(r.actionType) ?? { approved: 0, turnedDown: 0 };
    if (r.status === "rejected") {
      t.turnedDown++;
      const key = reasonKey(r.reviewNote);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    } else t.approved++;
    perType.set(r.actionType, t);
  }
  return {
    types: [...perType.entries()]
      .map(([actionType, t]) => ({ actionType, ...t }))
      .sort((a, b) => b.approved + b.turnedDown - (a.approved + a.turnedDown) || a.actionType.localeCompare(b.actionType)),
    topReasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 3),
    // The list is cut by created time but the window is by decision time, so a full read can omit an
    // older-created request decided inside the window: every number from it is a floor, and an empty
    // result is "none found", not "none".
    full: rows.length >= SUMMARY_READ_LIMIT,
  };
}

/** "Sat Oct 24, 3:30 PM, turned down (booking request)" for the newest decision in the read, or null. */
export function lastDecisionWords(rows: DecidedRow[]): string | null {
  let best: { at: Date; row: DecidedRow } | null = null;
  for (const r of rows) {
    const at = isDecided(r.status) ? decidedAt(r) : null;
    if (at && (!best || at > best.at)) best = { at, row: r };
  }
  if (!best) return null;
  const verdict = best.row.status === "rejected" ? "turned down" : "approved";
  return `${shopMoment(best.at)}, ${verdict} (${typeSingular(best.row.actionType)})`;
}
