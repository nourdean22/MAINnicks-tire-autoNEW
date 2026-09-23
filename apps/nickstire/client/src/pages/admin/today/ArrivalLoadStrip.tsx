/**
 * ArrivalLoadStrip — NT-008 (2026-08-13).
 *
 * The walk-in-native answer to "calendar integration": this shop is FCFS with
 * no slot or bay model ON PURPOSE (shared/business.ts — "Walk-ins welcome
 * 7 days a week"), so the useful planning object is ARRIVAL LOAD, not
 * appointments. Two sources, both of which already existed server-side:
 *
 *   1. expected_arrivals — "the customer said they're coming today", captured
 *      from voice/SMS (NCSOS). The dispatch.expectedArrivals endpoint had ZERO
 *      client consumers before this strip — built-tested-unwired, the repo's
 *      dominant defect shape. This is its first mount.
 *   2. Tomorrow's preferred-date bookings, derived from the SAME overview
 *      bundle Today already fetches (no new poll) — a lower bound, and labeled
 *      as one when the bundle slice is capped or unavailable.
 *
 * Deliberately a strip, not a calendar: render counts + names, link nowhere
 * new, and say nothing when both sources are empty and healthy (an empty
 * board is not an alert).
 */
import { CalendarClock, CarFront, PhoneIncoming } from "lucide-react";
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { getBusinessDateKey } from "@/lib/businessDate";
import type { BookingItem } from "./types";

interface ExpectedArrivalRow {
  id: number;
  customerName: string | null;
  customerPhone: string | null;
  vehicle: string | null;
  service: string | null;
  whenText: string | null;
  source: string | null;
}

/** YYYY-MM-DD for tomorrow in shop time — same helper family as todayKey. */
export function tomorrowBusinessDateKey(now: Date = new Date()): string {
  return getBusinessDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

/**
 * Pure so the boundary cases are testable: which of the bundle's bookings
 * count as "tomorrow's arrivals"? Only new/confirmed rows whose preferredDate
 * IS tomorrow — completed/cancelled rows are history, and past-date rows are
 * the no-show sweep's business, not tomorrow's load.
 */
export function bookingsForDate(bookings: readonly BookingItem[], dateKey: string): BookingItem[] {
  return bookings.filter(
    (b) => b.preferredDate === dateKey && (b.status === "new" || b.status === "confirmed"),
  );
}

/**
 * The strip stays silent ONLY when there is genuinely nothing to say: both
 * sources answered, both are empty, and the bookings slice is trustworthy.
 * Self-review fix (2026-08-13): the first version omitted the trustworthiness
 * arm, so "arrivals empty + bookings UNREADABLE" suppressed the strip — hiding
 * the exact unknown-not-zero warning it exists to show. Pure + exported so all
 * four arms are pinned.
 */
export function stripHasNothingToSay(args: {
  arrivalsError: boolean;
  arrivalsLoaded: boolean;
  arrivalsCount: number;
  tomorrowCount: number;
  bookingsTrustworthy: boolean;
  /** Tire inquiries by phone today. An unreadable count is never silence. */
  phoneDemandCount?: number;
  phoneDemandError?: boolean;
}): boolean {
  return (
    !args.arrivalsError &&
    args.arrivalsLoaded &&
    args.bookingsTrustworthy &&
    args.arrivalsCount === 0 &&
    args.tomorrowCount === 0 &&
    !args.phoneDemandError &&
    (args.phoneDemandCount ?? 0) === 0
  );
}

/** Shape of dispatch.phoneTireDemandToday (server/lib/tireDemand.ts TireDemandSummary). */
interface PhoneTireDemand {
  total: number;
  sizes: Array<{ size: string; count: number; new: number; used: number }>;
  sizeUnknown: number;
}

/**
 * "225/65R17 ×3 (2 used) · 205/55R16 · +1 more · 2 without a size" — the sizes
 * to pull for callers who may walk in. Null when nobody asked.
 */
export function phoneDemandLine(d: PhoneTireDemand, maxSizes = 4): string | null {
  if (d.total === 0) return null;
  const parts = d.sizes.slice(0, maxSizes).map((s) => {
    const cond = [s.used ? `${s.used} used` : "", s.new ? `${s.new} new` : ""].filter(Boolean).join(", ");
    return `${s.size}${s.count > 1 ? ` ×${s.count}` : ""}${cond ? ` (${cond})` : ""}`;
  });
  if (d.sizes.length > maxSizes) parts.push(`+${d.sizes.length - maxSizes} more`);
  if (d.sizeUnknown) parts.push(`${d.sizeUnknown} without a size`);
  return parts.join(" · ");
}

export default function ArrivalLoadStrip({
  // Bare-mount safe (the admin render matrix mounts every section with no
  // props — it caught the undefined-crash here within hours of this file
  // existing). Defaults are the HONEST absence: no bookings data and NOT
  // trustworthy — absent data must render as unknown, never as a clean zero.
  bookings = [],
  bookingsTrustworthy = false,
}: {
  bookings?: readonly BookingItem[];
  bookingsTrustworthy?: boolean;
}) {
  // Server defaults to today's shop date; keep polling calm — arrivals are
  // captured from voice/SMS, not a firehose.
  const arrivalsQuery = trpc.dispatch.expectedArrivals.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 90_000,
    refetchIntervalInBackground: false,
  });

  // Sizes tire callers asked about today (tireInquiry), so the counter can pull stock.
  const demandQuery = trpc.dispatch.phoneTireDemandToday.useQuery(undefined, {
    refetchInterval: 120_000,
    staleTime: 90_000,
    refetchIntervalInBackground: false,
  });
  const demand = demandQuery.data as PhoneTireDemand | undefined;
  const demandText = demand ? phoneDemandLine(demand) : null;

  const arrivals = (arrivalsQuery.data ?? []) as unknown as ExpectedArrivalRow[];
  const tomorrowKey = useMemo(() => tomorrowBusinessDateKey(), []);
  const tomorrowBookings = useMemo(() => bookingsForDate(bookings, tomorrowKey), [bookings, tomorrowKey]);

  // Nothing to plan around, every source answered AND is trustworthy → say
  // nothing at all. (An error or an untrustworthy slice is NOT silence: an
  // unreadable board must not render as an empty one — loud-failure rule.)
  if (
    stripHasNothingToSay({
      arrivalsError: arrivalsQuery.isError,
      arrivalsLoaded: arrivalsQuery.data !== undefined,
      arrivalsCount: arrivals.length,
      tomorrowCount: tomorrowBookings.length,
      bookingsTrustworthy,
      phoneDemandCount: demand?.total ?? 0,
      phoneDemandError: demandQuery.isError,
    })
  ) {
    return null;
  }

  return (
    <section
      aria-labelledby="arrival-load-title"
      className="rounded-lg border border-border/40 bg-card/60 p-3"
    >
      <h2 id="arrival-load-title" className="text-sm font-semibold flex items-center gap-2">
        <CarFront className="w-4 h-4 text-primary" />
        Arrival load
        <span className="text-[10px] font-normal text-muted-foreground">walk-in shop · planning signal, not a schedule</span>
      </h2>

      {arrivalsQuery.isError ? (
        <p className="mt-2 text-xs text-amber-400">
          Expected-arrivals board unreadable — treat today&apos;s load as unknown, not empty.
        </p>
      ) : !arrivalsQuery.data ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading expected arrivals…</p>
      ) : arrivals.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">
            Said they&apos;re coming today · {arrivals.length}
          </p>
          <ul className="mt-1 space-y-1">
            {arrivals.slice(0, 5).map((a) => (
              <li key={a.id} className="text-xs flex items-center gap-2">
                <span className="font-medium">{a.customerName || a.customerPhone || "Unknown"}</span>
                <span className="text-muted-foreground truncate">
                  {[a.vehicle, a.service, a.whenText].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
          {arrivals.length > 5 && (
            <p className="mt-1 text-[10px] text-muted-foreground">+{arrivals.length - 5} more expected</p>
          )}
        </div>
      ) : null}

      {demandQuery.isError ? (
        <p className="mt-2 text-xs text-amber-400">
          Phone tire requests unreadable — unknown, not zero.
        </p>
      ) : demand && demandText ? (
        <div className="mt-2 flex items-start gap-2 text-xs">
          <PhoneIncoming className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <span>
            <span className="text-muted-foreground">
              Asked by phone today · {demand.total} tire caller{demand.total === 1 ? "" : "s"}:{" "}
            </span>
            <span className="font-medium">{demandText}</span>
          </span>
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarClock className="w-3.5 h-3.5" />
        {bookingsTrustworthy ? (
          <span>
            Tomorrow ({tomorrowKey}) · {tomorrowBookings.length} preferred-date booking
            {tomorrowBookings.length === 1 ? "" : "s"} on the board
          </span>
        ) : (
          <span className="text-amber-400">Tomorrow&apos;s booking load unreadable — unknown, not zero.</span>
        )}
      </div>
    </section>
  );
}
