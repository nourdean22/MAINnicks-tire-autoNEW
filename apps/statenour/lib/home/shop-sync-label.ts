/**
 * lib/home/shop-sync-label.ts · the Home sales card's "as of" line (2026-10-31, missed-asks row 48).
 *
 * The line says when the SHOP's numbers were last synced (`syncedAt`, nickstire PR 3482), never when we read
 * them. Pure and client-safe: no server imports, so the card can use it. `now` is passed in so tests pin it.
 *
 * Three states, never two (empty-vs-error): fresh, stale, unknown. null, absent or unparseable is unknown:
 * the line says "sync time unknown" instead of guessing a clock. An OLD stamp is a true statement (a failed
 * probe never moves it), so it is shown with its age rather than hidden.
 */
import { toDateString } from "@/lib/utils/datetime";

/**
 * Why 2 h: the shop mirror probes only on demand. The admin page load is throttled to one probe per 30 min
 * (apps/nickstire/server/services/algProbeBudget.ts, "admin_refresh"), plus a 3 AM and an 8 PM ET run. Four
 * missed 30 min windows means nobody opened the admin and no probe has landed for a long stretch, so the
 * figures may trail the counter. Under that the number is as fresh as the system ever keeps it.
 */
export const SHOP_SYNC_STALE_MS = 2 * 60 * 60 * 1000;

export interface ShopSyncLabel {
  text: string;
  state: "fresh" | "stale" | "unknown";
}

const ET = "America/New_York";
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: ET, month: "short", day: "numeric" });

const UNKNOWN: ShopSyncLabel = { text: "sync time unknown", state: "unknown" };

/** Newer ICU puts a narrow no-break space before AM/PM; a plain space keeps the line copyable and greppable. */
const plain = (s: string) => s.replace(/[  ]/g, " ");

export function shopSyncLabel(syncedAt: string | null | undefined, now: Date): ShopSyncLabel {
  if (!syncedAt) return UNKNOWN;
  const at = new Date(syncedAt);
  if (Number.isNaN(at.getTime())) return UNKNOWN;

  const time = plain(TIME.format(at));
  // The day is judged in ET: a UTC compare calls 7:50 PM ET "tomorrow" once the UTC date rolls over at 8 PM.
  const when = toDateString(at) === toDateString(now) ? time : `${DATE.format(at)}, ${time}`;

  const ageMs = now.getTime() - at.getTime();
  if (ageMs <= SHOP_SYNC_STALE_MS) return { text: `as of ${when}`, state: "fresh" };

  const hours = Math.floor(ageMs / 3_600_000);
  const age = hours < 48 ? `${hours} h old` : `${Math.floor(hours / 24)} days old`;
  return { text: `as of ${when}, ${age}`, state: "stale" };
}
