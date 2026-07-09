/**
 * Staff Hours Service — weekly hours from the time-clock ledger · AG-43.
 *
 * Reads time_clock_entries (migration 0077, the durable per-shift
 * ledger written by dispatch clockIn/clockOut) and rolls up hours per
 * technician for a 7-day window. Until the operator applies 0077 the
 * query throws → callers get an empty result, never a crash.
 *
 * Open shifts (clock_out_at NULL — tech currently on the floor, or a
 * missed clock-out) are counted up to now and CAPPED at 12h so one
 * forgotten punch doesn't report a 70-hour "shift" to payroll.
 */
import { and, eq, gte, isNull, or } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const log = createLogger("staffHours");

const OPEN_SHIFT_CAP_MS = 12 * 60 * 60 * 1000;

export interface TechWeeklyHours {
  technicianId: number;
  name: string;
  /** Total hours in the window, 1 decimal. */
  hours: number;
  /** Completed shift count in the window. */
  shifts: number;
  /** True when an open (uncapped-at-clock-out) entry contributed. */
  hasOpenShift: boolean;
}

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

/**
 * Hours per active technician over the trailing `days` window
 * (default 7). Entries that STARTED in the window count; a shift
 * spanning the window edge is attributed to its clock-in day —
 * shop shifts are hours, not days, so edge loss is negligible and
 * the attribution is stable.
 */
export async function getWeeklyHours(days = 7): Promise<TechWeeklyHours[]> {
  try {
    const { db, technicians, timeClockEntries } = await getDbAndSchema();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({
        technicianId: timeClockEntries.technicianId,
        name: technicians.name,
        clockInAt: timeClockEntries.clockInAt,
        clockOutAt: timeClockEntries.clockOutAt,
      })
      .from(timeClockEntries)
      .innerJoin(technicians, eq(timeClockEntries.technicianId, technicians.id))
      .where(and(
        gte(timeClockEntries.clockInAt, since),
        or(isNull(timeClockEntries.clockOutAt), gte(timeClockEntries.clockOutAt, since)),
      ));

    const byTech = new Map<number, TechWeeklyHours>();
    const now = Date.now();
    for (const r of rows) {
      const inMs = r.clockInAt.getTime();
      const open = r.clockOutAt === null;
      const rawMs = (open ? now : r.clockOutAt!.getTime()) - inMs;
      const shiftMs = Math.max(0, Math.min(rawMs, open ? OPEN_SHIFT_CAP_MS : rawMs));
      const agg = byTech.get(r.technicianId) ?? {
        technicianId: r.technicianId,
        name: r.name,
        hours: 0,
        shifts: 0,
        hasOpenShift: false,
      };
      agg.hours += shiftMs / 3_600_000;
      agg.shifts += 1;
      agg.hasOpenShift = agg.hasOpenShift || open;
      byTech.set(r.technicianId, agg);
    }

    return [...byTech.values()]
      .map((t) => ({ ...t, hours: Math.round(t.hours * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);
  } catch (err) {
    // Expected until 0077 is applied (table missing) · also any DB
    // blip. Weekly hours is a report, never worth failing a page.
    log.warn("[StaffHours] getWeeklyHours failed (table missing until migration 0077?):", err instanceof Error ? err.message : err);
    return [];
  }
}
