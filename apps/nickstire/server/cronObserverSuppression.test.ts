/**
 * Canaries for the cron observer's alert suppression.
 *
 * THE DEFECT BEING FIXED. `lastAlertAt` was an in-memory Map "cleared on
 * restart", which made ALERT_SUPPRESS_MS decorative: every deploy reset it.
 * Measured 2026-08-29 - reel-pipeline and higgsfield-session-keepalive were
 * failing continuously (295 and 296 runs in 72h) and the observer sent 2 alerts
 * on each of 25 separate runs: roughly 50 delivered Telegram messages in three
 * days against a 6h window, because that day's merges kept restarting the
 * container. That is alert fatigue manufactured by a persistence bug, not an
 * under-alerting problem.
 *
 * THE DEFECT THIS FILE EXISTS TO PREVENT NEXT. Persisting a timestamp is one
 * edit away from suppressing FOREVER - write the state once, never expire it,
 * and the channel goes quiet while the outage continues. "It never alerted
 * again" and "nothing was wrong" produce identical evidence.
 *
 * So the load-bearing test here is not "it suppresses". It is the POSITIVE
 * CONTROL: once the window genuinely elapses, an alert fires again. Every
 * suppression assertion below is paired with one, against fixture clocks this
 * file controls rather than live config.
 */
import { describe, it, expect } from "vitest";
import { shouldAlertNow } from "./cron/observer";

const HOUR = 60 * 60 * 1000;
const SUPPRESS_6H = 6 * HOUR;
const SUPPRESS_24H = 24 * HOUR;
const NOW = Date.UTC(2026, 7, 29, 12, 0, 0); // fixed clock, no Date.now()

describe("shouldAlertNow", () => {
  it("alerts when it has never alerted before", () => {
    expect(shouldAlertNow(null, NOW, SUPPRESS_6H)).toBe(true);
  });

  it("SUPPRESSES inside the window", () => {
    expect(shouldAlertNow(NOW - 1 * HOUR, NOW, SUPPRESS_6H)).toBe(false);
    expect(shouldAlertNow(NOW - 5 * HOUR, NOW, SUPPRESS_6H)).toBe(false);
    // One millisecond short of the window is still suppressed.
    expect(shouldAlertNow(NOW - SUPPRESS_6H + 1, NOW, SUPPRESS_6H)).toBe(false);
  });

  // THE POSITIVE CONTROL. Without this, an implementation that returned false
  // unconditionally - i.e. permanent silence - would pass every test above.
  it("ALERTS AGAIN once the window elapses", () => {
    expect(shouldAlertNow(NOW - SUPPRESS_6H, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(NOW - 7 * HOUR, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(NOW - 30 * 24 * HOUR, NOW, SUPPRESS_6H)).toBe(true);
  });

  it("keeps alerting on every subsequent window for a persistent failure", () => {
    // A job failing for four days must not go quiet after the first alert.
    let last: number | null = null;
    let fired = 0;
    for (let t = NOW; t < NOW + 4 * 24 * HOUR; t += 15 * 60 * 1000) {
      if (shouldAlertNow(last, t, SUPPRESS_6H)) {
        fired++;
        last = t;
      }
    }
    // Alerts land at NOW + 6h*k for k = 0..15; the loop is half-open so
    // NOW + 96h is excluded. 16 alerts over four days - roughly four a day,
    // against the ~50 in three days the unpersisted version produced.
    expect(fired).toBe(16);
  });

  it("honours a different window independently (shape alerts use 24h)", () => {
    expect(shouldAlertNow(NOW - 7 * HOUR, NOW, SUPPRESS_24H)).toBe(false);
    expect(shouldAlertNow(NOW - 25 * HOUR, NOW, SUPPRESS_24H)).toBe(true);
  });

  // FAIL OPEN. If the stored value is unreadable, alert rather than suppress:
  // a duplicate alert is recoverable, a silent outage is not.
  it("alerts when the persisted value is not a finite number", () => {
    expect(shouldAlertNow(Number.NaN, NOW, SUPPRESS_6H)).toBe(true);
    expect(shouldAlertNow(Number.POSITIVE_INFINITY, NOW, SUPPRESS_6H)).toBe(true);
  });

  // The restart case that caused the incident: an in-memory Map came back empty,
  // which reads as null - and null must NOT be treated as "alerted just now".
  it("a cleared cache (null) alerts rather than silently suppressing", () => {
    expect(shouldAlertNow(null, NOW, SUPPRESS_24H)).toBe(true);
  });
});
