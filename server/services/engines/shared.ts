/**
 * Shared utilities for Advanced Intelligence Engines
 *
 * Common imports, types, and helper functions used across all engine modules.
 * Revenue values in invoices are stored in CENTS — divide by 100 for display.
 */

import { getDb } from "../../db";

/** Generic row returned from raw SQL execute() calls */
export type RawRow = Record<string, unknown>;

/** Normalize Drizzle execute() results — handles both [rows, fields] tuple and plain array */
export function extractRows(result: unknown): RawRow[] {
  if (Array.isArray(result)) {
    // Drizzle mysql2 returns [rows, fields] — rows is index 0
    const first = result[0];
    if (Array.isArray(first)) return first as RawRow[];
    // Already a flat array of rows
    return result as RawRow[];
  }
  return [];
}

/** Extract a single aggregate row from execute() results */
export function extractOne(result: unknown): RawRow {
  const rows = extractRows(result);
  return (rows[0] as RawRow) || {};
}

export async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

export const SERVICE_CATEGORIES = [
  { key: "brakes", pattern: /brake|rotor|pad|caliper/i },
  { key: "tires", pattern: /tire|mount|balance|rotation|alignment/i },
  { key: "oil", pattern: /oil.?change|lube|filter/i },
  { key: "suspension", pattern: /strut|shock|spring|suspension|control.?arm|ball.?joint|tie.?rod/i },
  { key: "engine", pattern: /engine|timing|head.?gasket|valve|compression/i },
  { key: "electrical", pattern: /battery|alternator|starter|wiring|fuse/i },
  { key: "exhaust", pattern: /exhaust|muffler|catalytic|pipe/i },
  { key: "cooling", pattern: /coolant|radiator|thermostat|water.?pump|heater.?core/i },
  { key: "transmission", pattern: /transmission|trans.?fluid|clutch/i },
  { key: "diagnostic", pattern: /diagnos|check.?engine|scan|inspect/i },
];

export function categorizeService(desc: string): string[] {
  return SERVICE_CATEGORIES.filter(c => c.pattern.test(desc)).map(c => c.key);
}
