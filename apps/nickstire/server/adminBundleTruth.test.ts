/**
 * A failed read must never render as "All clear".
 *
 * getOverviewMediumBundle returned five independently-nullable fields and nothing
 * else. `settled()` maps a rejection to null with only a log.warn, and
 * OverviewSection does `bundle?.leads ?? []` — so a failed leads read became an
 * empty queue, and an empty queue rendered the words "All clear".
 *
 * DegradedDataBanner could not catch it: it fires on `stats._degraded` or the
 * whole-query `isError`, and neither is true when the request SUCCEEDS carrying a
 * failed slice inside it.
 *
 * Worse, two readers never even reject. getBookings (db.ts:171) and
 * getCallbackRequests (db.ts:484) return [] when the database is unavailable, so
 * Promise.allSettled sees a FULFILLED empty array — the failure is laundered into
 * a legitimate-looking result. Their immediate neighbours at db.ts:177 and :490
 * throw. Both patterns, same file, six lines apart.
 */
import { describe, it, expect } from "vitest";
import { readCode, readSource } from "./testUtils/sourceAssertions";

const bundle = readSource("server/services/adminBundle.ts");
const overview = readSource("client/src/pages/admin/OverviewSection.tsx");

describe("the bundle reports which reads actually succeeded", () => {
  it("returns per-slice availability, not just nullable values", () => {
    expect(bundle).toMatch(/slices/);
    expect(bundle).toMatch(/available: boolean/);
    expect(bundle).toMatch(/anyUnavailable/);
  });

  it("checks the DATABASE ITSELF, because readers launder their own failures", () => {
    // The only defence against getBookings/getCallbackRequests returning []
    // instead of throwing. Without it, allSettled sees success.
    expect(bundle).toMatch(/const dbDown = !\(await db\(\)\)/);
    expect(bundle).toMatch(/sliceStatus\(\w+, dbDown\)/);
  });

  it("its own listLeads now THROWS instead of returning [] on a dead database", () => {
    expect(readCode("server/services/adminBundle.ts")).toMatch(/if \(!d\) throw new Error\("Database not available"\)/);
  });

  it("keeps the five original fields so existing consumers do not break", () => {
    for (const field of ["stats:", "bookings:", "leads:", "callbacks:", "health:"]) {
      expect(bundle).toContain(field);
    }
  });
});

describe("Overview stops claiming All clear on reads that did not happen", () => {
  it("consumes the slice availability", () => {
    expect(overview).toMatch(/unavailableSlices/);
    expect(overview).toMatch(/queueTrustworthy/);
  });

  it("shows an alert naming which slices failed", () => {
    expect(overview).toMatch(/Could not read: \{unavailable\.join/);
    expect(overview).toMatch(/may be UNKNOWN rather than clear/);
  });

  it("the Needs-action card renders an em dash, not a zero, when untrusted", () => {
    expect(overview).toMatch(/queueTrustworthy \? queue\.length : "—"/);
    expect(overview).toMatch(/Unable to determine/);
  });

  it("SummaryCard can express UNKNOWN at all", () => {
    // It was typed `value: number`, so the component structurally could not say
    // anything but a count. The type was enforcing the defect.
    expect(overview).toMatch(/value: number \| string/);
  });

  it("still says All clear when the reads genuinely succeeded and the queue is empty", () => {
    // The fix must not make the screen permanently alarmed — that is the same
    // failure wearing the opposite face.
    expect(overview).toMatch(/"All clear"/);
  });
});
