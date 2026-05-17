/**
 * Conversion-event sink + ring buffer.
 *
 * Receives events from the client `useConversionTracking` hook and:
 *   1. Logs them via createLogger (so grep / log-aggregator can audit).
 *   2. Stores the last N events in an in-memory ring buffer for the
 *      admin Conversion Preview tab to display a live feed.
 *
 * Batch 9 of the conversion overhaul will move this to a `conversion_events`
 * table for proper funnel analytics. For now the ring buffer is enough to
 * validate end-to-end wiring + give the operator a live "what just happened"
 * view.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("conversion-events");

export interface ConversionEvent {
  type: string;
  page?: string;
  element?: string;
  value?: number;
  props?: Record<string, unknown>;
  ip?: string;
  ua?: string;
  /** Auto-stamped server-side. */
  ts?: number;
}

const MAX_EVENTS = 500;
const buffer: ConversionEvent[] = [];

export function recordConversionEvent(ev: ConversionEvent): void {
  const stamped: ConversionEvent = { ...ev, ts: Date.now() };
  buffer.push(stamped);
  // Trim ring buffer
  if (buffer.length > MAX_EVENTS) {
    buffer.splice(0, buffer.length - MAX_EVENTS);
  }
  log.info("conversion event", {
    type: stamped.type,
    page: stamped.page,
    element: stamped.element,
    value: stamped.value,
  });
}

export function getRecentConversionEvents(limit: number = 50): ConversionEvent[] {
  // Return newest first
  return buffer.slice(-Math.min(limit, MAX_EVENTS)).reverse();
}

/**
 * Aggregate by type. Useful for the admin Conversion Preview rollup.
 * Returns `{ urgency_widget_shown: 12, exit_intent_capture_completed: 3, ... }`.
 */
export function getConversionEventsByType(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ev of buffer) {
    counts[ev.type] = (counts[ev.type] || 0) + 1;
  }
  return counts;
}
