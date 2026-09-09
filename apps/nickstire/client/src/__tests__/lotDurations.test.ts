/**
 * Duration helpers behind the Lot floor board.
 *
 * These are small, and they are tested because the two ways they can be wrong are both
 * SILENT: an unknown start rendering as a confident "0m" (which reads as "just pulled
 * in"), and a departed car's stay creeping upward while somebody watches it.
 */
import { describe, it, expect } from "vitest";

import {
  formatDuration,
  advanceOpenDuration,
} from "@/pages/admin/shared/format";

const MIN = 60_000;

describe("formatDuration", () => {
  it("renders an unknown duration as an em dash, never as zero", () => {
    // The whole Lot section is built on "a failed or absent read must not render as a
    // confident number". 0m would read as "arrived this minute".
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(undefined)).toBe("—");
  });

  it("keeps zero distinct from unknown", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("switches to hours and minutes at the hour", () => {
    expect(formatDuration(59)).toBe("59m");
    expect(formatDuration(60)).toBe("1h 0m");
    expect(formatDuration(125)).toBe("2h 5m");
    expect(formatDuration(1440)).toBe("24h 0m");
  });

  it("refuses to render a negative span", () => {
    // Clock skew between the DB and the browser should surface as "unknown", not as a
    // negative stay, which is nonsense an operator would have to interpret.
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("advanceOpenDuration", () => {
  const fetched = 1_000_000_000_000;

  it("leaves an unknown duration unknown, however much time passes", () => {
    expect(advanceOpenDuration(null, true, fetched, fetched + 99 * MIN)).toBeNull();
    expect(advanceOpenDuration(null, false, fetched, fetched + 99 * MIN)).toBeNull();
  });

  it("NEVER advances a closed visit", () => {
    // A departed car's stay is history. If this grew, the recent-visits table would
    // slowly inflate every completed visit for as long as the tab stayed open.
    const closed = advanceOpenDuration(37, false, fetched, fetched + 90 * MIN);
    expect(closed).toBe(37);
  });

  it("advances an open visit by whole elapsed minutes", () => {
    expect(advanceOpenDuration(10, true, fetched, fetched)).toBe(10);
    // 59s is not yet a minute -- the clock must not round up and show time that has
    // not passed.
    expect(advanceOpenDuration(10, true, fetched, fetched + 59_000)).toBe(10);
    expect(advanceOpenDuration(10, true, fetched, fetched + MIN)).toBe(11);
    expect(advanceOpenDuration(10, true, fetched, fetched + 45 * MIN)).toBe(55);
  });

  it("never runs backwards when the clock skews", () => {
    // A browser clock behind the fetch timestamp would otherwise SUBTRACT minutes and
    // show a wait shrinking in real time.
    expect(advanceOpenDuration(20, true, fetched, fetched - 30 * MIN)).toBe(20);
  });

  it("keeps a genuine zero at zero rather than promoting it to unknown", () => {
    expect(advanceOpenDuration(0, true, fetched, fetched)).toBe(0);
    expect(advanceOpenDuration(0, false, fetched, fetched + 5 * MIN)).toBe(0);
  });
});
