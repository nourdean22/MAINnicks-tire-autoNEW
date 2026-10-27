/**
 * Plain-words helpers for the Approvals queue: the card as labelled lines, type names, and the
 * last-decision line. Pure functions; ApprovalsSection renders them. The counts themselves come from
 * the server (proposals.decisionSummary), not from rows on the client.
 *
 * Shop data: most receptionist booking requests are turned down on purpose (a walk-in shop holds no
 * slots), so a turn-down count is only useful next to its reasons.
 */
import { BUSINESS_TIME_ZONE, getBusinessDateKey } from "@/lib/businessDate";
import { fmtPhone } from "../voice/format";

const DAY_MS = 86_400_000;
const PLACEHOLDER_NAME = "caller";

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

/** "Sat Oct 24, 3:30 PM, turned down (booking request)" from the server's newest decision, or null if unreadable. */
export function lastDecisionWords(last: { at: string; decision: "approved" | "turned_down"; actionType: string | null }): string | null {
  const at = new Date(last.at);
  if (Number.isNaN(at.getTime())) return null;
  const verdict = last.decision === "approved" ? "approved" : "turned down";
  return `${shopMoment(at)}, ${verdict}${last.actionType ? ` (${typeSingular(last.actionType)})` : ""}`;
}
