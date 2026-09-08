/**
 * enqueueReelJob reserves the publish slot on the job's INTENDED day.
 *
 * Before 2026-09-08 the reservation window was always `now`, so scheduling a
 * week of reels in one sitting stacked every reservation onto the enqueue day:
 * the cap, spacing and repeat rules all evaluate relative to windowStart, and
 * they were being asked about the wrong day. `publicationIntendedAt` (0118) is
 * the job's DUE-AT and is already threaded into enqueue; this pins that the
 * reservation is built from it, clamped to now so a past intent cannot reserve
 * a day that has gone.
 *
 * Source-structure canary (enqueueReelJob opens the production DB and the
 * governor), following reelPublishWindowWiring.test.ts, with the region bounded
 * and a planted mutation so the check is shown to discriminate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(process.cwd(), "server/services/reelPipeline.ts"), "utf8");

function reservationRegion(s: string): string {
  const start = s.indexOf('const { requestReservation } = await import("./contentGovernor");');
  const end = s.indexOf("contentReservationId = reservation.reservationId", start);
  return start >= 0 && end > start ? s.slice(start, end) : "";
}
const region = reservationRegion(src);

const reservesIntendedDay = (s: string) =>
  /episode\.publicationIntendedAt/.test(s) &&
  /windowStart,\s*\n?\s*windowEnd: new Date\(windowStart\.getTime\(\) \+ 24 \* 3600_000\)/.test(s) &&
  /Math\.max\(episode\.publicationIntendedAt\.getTime\(\), now\.getTime\(\)\)/.test(s);

describe("silent-instrument guard", () => {
  it("the reservation region is located and bounded", () => {
    expect(region).not.toBe("");
    expect(region.length).toBeLessThan(src.length / 10);
    expect(region).toContain("requestReservation({");
  });
});

describe("the slot is reserved on the intended publish day", () => {
  it("builds windowStart from publicationIntendedAt, clamped to now", () => {
    expect(reservesIntendedDay(region)).toBe(true);
  });

  it("PLANTED CANARY: reverting to `windowStart: now` is caught", () => {
    const reverted = region
      .replace(/const windowStart =[\s\S]*?: now;/, "const windowStart = now;")
      .replace("windowStart,\n", "windowStart: now,\n");
    expect(reverted).not.toBe(region);
    expect(reservesIntendedDay(reverted)).toBe(false);
  });

  it("PLANTED CANARY: dropping the clamp (a past intent reserving a past day) is caught", () => {
    const unclamped = region.replace(
      "new Date(Math.max(episode.publicationIntendedAt.getTime(), now.getTime()))",
      "episode.publicationIntendedAt",
    );
    expect(unclamped).not.toBe(region);
    expect(reservesIntendedDay(unclamped)).toBe(false);
  });
});
