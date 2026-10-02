/**
 * A repo migration that prod never recorded pages the owner (2026-10-02):
 * 20260929123500_reality_event_envelope sat unapplied for three days while
 * every reality_events write failed and nothing paged.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_MIGRATIONS } from "@/lib/db/migration-manifest";
import { composeOwnerPanel, type OwnerPanelInput } from "@/lib/system/owner-panel";

const now = new Date("2026-10-02T16:00:00Z");
const clean: OwnerPanelInput = {
  now,
  todayYmd: "2026-10-02",
  cronRows: [],
  deployPages: [],
  pendingActions: [],
  approvalRequests: [],
  expiredRequests: { count: 0, oldest: null },
  commitments: [],
  lanes: [],
  outboxHealth: { pending: 0, processing: 0, done24h: 0, dead: 0, oldestDeadAt: null, lastDeadError: null },
  actionAttempts: [],
  capabilities: [],
  spend: { costCents: 0, calls: 0, unpricedCalls: 0 },
  tasksDone: 0,
  valueAttribution: null,
  unappliedMigrations: [],
};

describe("Owner Panel · unapplied migrations", () => {
  it("a repo migration missing from prod is a rose exception naming it", () => {
    const p = composeOwnerPanel({ ...clean, unappliedMigrations: ["20260929123500_reality_event_envelope"] });
    const m = p.exceptions.find((e) => e.kind === "migration_unapplied");
    expect(m).toMatchObject({
      tone: "rose",
      key: "migration:20260929123500_reality_event_envelope",
      evidence: "prisma/migrations/20260929123500_reality_event_envelope vs _prisma_migrations",
    });
    expect(p.state).toBe("attention");
  });

  it("a failed ledger read is unreadable, never a clear", () => {
    const p = composeOwnerPanel({ ...clean, unappliedMigrations: null });
    expect(p.unreadable).toContain("migrations");
    expect(p.exceptions.some((e) => e.kind === "migration_unapplied")).toBe(false);
  });

  it("nothing missing adds nothing", () => {
    const p = composeOwnerPanel(clean);
    expect(p.exceptions.some((e) => e.kind === "migration_unapplied")).toBe(false);
    expect(p.unreadable).not.toContain("migrations");
  });
});

describe("migration manifest · matches prisma/migrations", () => {
  it("lists exactly the migration directories (add a new migration's name to lib/db/migration-manifest.ts)", () => {
    const dir = path.resolve(__dirname, "../../../prisma/migrations");
    const onDisk = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect([...REPO_MIGRATIONS].sort()).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(60);
  });
});
