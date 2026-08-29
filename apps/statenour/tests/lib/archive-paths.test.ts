/**
 * Archive retention + promote policy — the production functions the
 * exporter uses (lib/system/archive-paths.ts, imported by
 * scripts/export-brain-archive.ts).
 *
 * Why this exists: on 2026-08-28 the data-cleanup cron hard-deleted 54,107
 * brain_memories rows, and the only pre-deletion copy lived in an archive
 * file that the nightly exporter OVERWROTE IN PLACE. The dated-dir +
 * promote-on-success + retention scheme is the fix; this test pins its
 * BEHAVIOUR so a regression cannot reintroduce silent overwrite or
 * over-eager pruning.
 *
 * Pruning safety is the load-bearing property: retention may only delete
 * a `dated/<yyyy-mm-dd>` dir it can parse, only when strictly older than
 * the window — operator snapshots (`snapshots/...`) and malformed names
 * are structurally unreachable.
 */
import { describe, expect, it } from "vitest";
import {
  ARCHIVE_RETENTION_DAYS,
  datedDirName,
  parseDatedDirStamp,
  selectRetainedDatedDirs,
} from "../../lib/system/archive-paths";

describe("datedDirName", () => {
  it("stamps with the UTC date, sortable and unique per day", () => {
    expect(datedDirName(new Date("2026-08-29T03:00:00Z"))).toBe("dated/2026-08-29");
    expect(datedDirName(new Date("2026-12-31T23:59:59Z"))).toBe("dated/2026-12-31");
  });
});

describe("parseDatedDirStamp", () => {
  it("parses a real stamp dir", () => {
    expect(parseDatedDirStamp("dated/2026-08-29")?.toISOString()).toBe(
      new Date("2026-08-29T00:00:00Z").toISOString(),
    );
  });

  it("rejects everything retention must never touch", () => {
    expect(parseDatedDirStamp("latest")).toBeNull();
    expect(parseDatedDirStamp("snapshots/2026-08-29-pre-fix")).toBeNull();
    expect(parseDatedDirStamp("dated")).toBeNull();
    expect(parseDatedDirStamp("dated/")).toBeNull();
    expect(parseDatedDirStamp("")).toBeNull();
  });

  it("rejects impossible dates that Date would silently roll over", () => {
    expect(parseDatedDirStamp("dated/2026-13-01")).toBeNull();
    expect(parseDatedDirStamp("dated/2026-02-30")).toBeNull();
    expect(parseDatedDirStamp("dated/9999-99-99")).toBeNull();
  });
});

describe("selectRetainedDatedDirs", () => {
  const now = new Date("2026-08-29T03:00:00Z");

  it("prunes stamps past the retention window and keeps fresh ones", () => {
    // now = 2026-08-29T03:00Z → cutoff = 2026-07-30T03:00Z. Stamps parse to
    // UTC MIDNIGHT, so 2026-07-30 (00:00) is past the cutoff and pruned,
    // while 2026-07-31 survives. Retention is exact here, approximate by
    // design at the day level.
    const names = [
      "dated/2026-08-29", // today — keep
      "dated/2026-08-28", // yesterday — keep
      "dated/2026-07-31", // just inside the window — keep
      "dated/2026-07-30", // midnight before the 03:00 cutoff — prune
      "dated/2026-01-01", // ancient — prune
    ];
    const { keep, prune } = selectRetainedDatedDirs(names, now);
    expect(prune).toEqual(["dated/2026-07-30", "dated/2026-01-01"]);
    expect(keep).toEqual(["dated/2026-08-29", "dated/2026-08-28", "dated/2026-07-31"]);
  });

  it("keeps non-stamp entries and future stamps — a clock skew or a stray dir can never delete an archive", () => {
    const { keep, prune } = selectRetainedDatedDirs(
      ["snapshots/2026-08-29-pre-fix", "dated/2099-01-01", "dated/nonsense", "dated/2020-01-01"],
      now,
    );
    expect(prune).toEqual(["dated/2020-01-01"]);
    expect(keep).toContain("snapshots/2026-08-29-pre-fix");
    expect(keep).toContain("dated/2099-01-01");
    expect(keep).toContain("dated/nonsense");
  });

  it("the boundary is the documented policy constant — exactly ARCHIVE_RETENTION_DAYS old is kept, one day older is pruned", () => {
    const DAY = 86_400_000;
    // Midnight now makes the stamp math exact: cutoff lands on a stamp boundary.
    const midnight = new Date("2026-08-29T00:00:00Z");
    const atBoundary = new Date(midnight.getTime() - ARCHIVE_RETENTION_DAYS * DAY);
    const pastBoundary = new Date(midnight.getTime() - (ARCHIVE_RETENTION_DAYS + 1) * DAY);
    const stamp = (d: Date) => `dated/${d.toISOString().slice(0, 10)}`;
    const { keep, prune } = selectRetainedDatedDirs(
      [stamp(atBoundary), stamp(pastBoundary)],
      midnight,
    );
    expect(keep).toContain(stamp(atBoundary));
    expect(prune).toContain(stamp(pastBoundary));
  });
});