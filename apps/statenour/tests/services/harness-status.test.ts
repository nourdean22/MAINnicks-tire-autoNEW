/**
 * The read side of the harness snapshot. Written red first against a missing module
 * (positive control recorded in the PR body). Pure function, fixed clock, no database.
 */
import { describe, it, expect } from "vitest";
import {
  HARNESS_STALE_MS,
  harnessSnapshotSchema,
  harnessStatusFromRows,
  harnessNodeKey,
} from "@/lib/services/harness-status";

const NOW = new Date("2026-11-05T15:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const snapshot = (pc: string, over: Record<string, unknown> = {}) => ({
  pc,
  sha: "726f3baad4",
  ramFreeMb: 4096,
  heavy: "free",
  chrome: "free",
  sessionsActive: 2,
  worktrees: 5,
  health: { ok: true, problems: [] },
  prs: null,
  merged: null,
  mainSha: null,
  graph: null,
  vaultGraph: null,
  sites: { bdnick: null, nickstire: null },
  unread: {},
  ...over,
});
const row = (pc: string, seen: Date | null, over: Record<string, unknown> = {}) => ({
  nodeKey: harnessNodeKey(pc as "nattynour"),
  lastHeartbeatAt: seen,
  metadata: { harnessSnapshot: snapshot(pc, over) },
});

describe("harnessStatusFromRows", () => {
  it("a PC that never reported is UNKNOWN with no last-seen, and is still listed", () => {
    const s = harnessStatusFromRows([], NOW);
    expect(s.pcs.map((p) => p.key)).toEqual(["nattynour", "mechanics", "nicksmax"]);
    for (const pc of s.pcs) {
      expect(pc.state).toBe("unknown");
      expect(pc.lastSeenAt).toBeNull();
      expect(pc.ramFreeMb).toBeNull();
      expect(pc.reason).toMatch(/never reported/i);
    }
    expect(s.reporting).toBe(0);
  });

  it("a fresh PC reports; one minute past the window reads UNKNOWN and drops its numbers", () => {
    const fresh = harnessStatusFromRows([row("nattynour", ago(HARNESS_STALE_MS - 60_000))], NOW);
    expect(fresh.pcs[0]).toMatchObject({ state: "reporting", ramFreeMb: 4096, sessionsActive: 2 });
    expect(fresh.reporting).toBe(1);

    const stale = harnessStatusFromRows([row("nattynour", ago(HARNESS_STALE_MS + 60_000))], NOW);
    expect(stale.pcs[0]).toMatchObject({ state: "unknown", ramFreeMb: null, sessionsActive: null, health: null });
    expect(stale.pcs[0].lastSeenAt).toBe(ago(HARNESS_STALE_MS + 60_000).toISOString());
    expect(stale.pcs[0].reason).toMatch(/silent 16 min/i);
    expect(stale.reporting).toBe(0);
  });

  it("a null source stays null with its reason; it never becomes zero or an empty list", () => {
    const s = harnessStatusFromRows(
      [row("mechanics", ago(1000), { ramFreeMb: null, prs: null, unread: { ram: "heavy.mjs failed", prs: "gh not installed" } })],
      NOW,
    );
    expect(s.pcs[1].ramFreeMb).toBeNull();
    expect(s.pcs[1].unread).toMatchObject({ ram: "heavy.mjs failed" });
    expect(s.prs).toBeNull();
    expect(s.prsReason).toMatch(/no reporting PC/i);
  });

  it("an empty PR list from a reporting PC is a real zero", () => {
    const s = harnessStatusFromRows([row("nattynour", ago(1000), { prs: [] })], NOW);
    expect(s.prs).toEqual({ items: [], from: "NattyNour", asOf: ago(1000).toISOString() });
  });

  it("PR state comes from the freshest reporting PC that has it, never from a silent one", () => {
    const pr = { number: 1, title: "a", branch: "b", checks: "SUCCESS" };
    const s = harnessStatusFromRows(
      [
        row("nattynour", ago(HARNESS_STALE_MS + 1), { prs: [pr] }),
        row("nicksmax", ago(1000), { prs: null }),
      ],
      NOW,
    );
    expect(s.prs).toBeNull();

    const t = harnessStatusFromRows(
      [row("nattynour", ago(5000), { prs: [pr] }), row("nicksmax", ago(1000), { prs: null })],
      NOW,
    );
    expect(t.prs?.from).toBe("NattyNour");
  });

  it("each site's commit is read on its own; a missing one stays null", () => {
    const s = harnessStatusFromRows(
      [
        row("nattynour", ago(5000), { sites: { bdnick: "aaaaaaa", nickstire: null } }),
        row("nicksmax", ago(1000), { sites: { bdnick: null, nickstire: "bbbbbbb" } }),
      ],
      NOW,
    );
    expect(s.sites.bdnick?.commit).toBe("aaaaaaa");
    expect(s.sites.nickstire?.commit).toBe("bbbbbbb");
    expect(harnessStatusFromRows([], NOW).sites).toEqual({ bdnick: null, nickstire: null });
  });

  it("a row whose metadata does not parse is UNKNOWN, never a blank healthy PC", () => {
    const s = harnessStatusFromRows(
      [{ nodeKey: harnessNodeKey("nicksmax"), lastHeartbeatAt: ago(1000), metadata: { harnessSnapshot: { pc: "nicksmax" } } }],
      NOW,
    );
    expect(s.pcs[2].state).toBe("unknown");
    expect(s.pcs[2].reason).toMatch(/could not be read/i);
    expect(s.pcs[2].lastSeenAt).toBe(ago(1000).toISOString());
  });
});

describe("graph and vault rows", () => {
  const db = { lastExportAt: "2026-11-05T12:00:00.000Z", exportedCount: null, liveCount: 3400, unread: { exportedCount: "not recorded" } };

  it("the graph row comes from a reporting PC; nobody reporting it reads unknown", () => {
    const graph = { serverUp: true, builtCommit: "64e82ce1", behind: 2 };
    const s = harnessStatusFromRows([row("nattynour", ago(1000), { graph })], NOW);
    expect(s.graph).toMatchObject({ ...graph, from: "NattyNour" });
    const silent = harnessStatusFromRows([row("nattynour", ago(HARNESS_STALE_MS + 1), { graph })], NOW);
    expect(silent.graph).toBeNull();
    expect(silent.graphReason).toMatch(/no reporting PC/i);
  });

  it("the vault row keeps a null export count null beside a real live count", () => {
    const s = harnessStatusFromRows([], NOW, db);
    expect(s.vault).toMatchObject({ lastExportAt: db.lastExportAt, exportedCount: null, liveCount: 3400, graph: null });
    expect(s.vault.unread.exportedCount).toBe("not recorded");
  });

  it("no database read at all leaves the whole vault row unknown, never zero", () => {
    const s = harnessStatusFromRows([], NOW);
    expect(s.vault).toMatchObject({ lastExportAt: null, exportedCount: null, liveCount: null, graph: null });
  });

  it("the vault graph comes from a reporting PC, and a real no stays a no", () => {
    const s = harnessStatusFromRows([row("nattynour", ago(1000), { vaultGraph: { exists: false, builtAt: null } })], NOW, db);
    expect(s.vault.graph).toEqual({ exists: false, builtAt: null });
  });

  it("refuses a note-like field on the vault graph", () => {
    expect(
      harnessSnapshotSchema.safeParse(snapshot("nattynour", { vaultGraph: { exists: true, builtAt: null, note: "text" } })).success,
    ).toBe(false);
  });
});

describe("harnessSnapshotSchema", () => {
  it("accepts a clean snapshot", () => {
    expect(harnessSnapshotSchema.safeParse(snapshot("nattynour")).success).toBe(true);
  });

  it("refuses a PC role outside the three known ones", () => {
    expect(harnessSnapshotSchema.safeParse(snapshot("desktop-abc123")).success).toBe(false);
  });

  it("refuses an unknown field, so a new leak cannot slip in unreviewed", () => {
    expect(harnessSnapshotSchema.safeParse({ ...snapshot("nattynour"), hostname: "x" }).success).toBe(false);
  });

  it.each([
    ["windows path", "C:\\Users\\someone\\repo failed"],
    ["forward-slash windows path", "c:/Users/someone"],
    ["unix home", "/home/someone/x"],
    ["ipv4", "listening on 100.64.1.2"],
  ])("refuses %s in any string field", (_n, value) => {
    expect(harnessSnapshotSchema.safeParse(snapshot("nattynour", { unread: { prs: value } })).success).toBe(false);
    expect(
      harnessSnapshotSchema.safeParse(
        snapshot("nattynour", { prs: [{ number: 1, title: value, branch: "b", checks: "NONE" }] }),
      ).success,
    ).toBe(false);
  });
});
