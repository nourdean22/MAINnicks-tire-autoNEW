/**
 * A read that could not run must not render as "none yet".
 *
 * WHY (2026-09-10): getCandidates() and getTechnicianReferrals() returned
 * `{ available: true, migrationPending: false, rows: [] }` when getDb() handed
 * back null — which happens when DATABASE_URL is unset or pool creation threw.
 * The field is literally named `available` and it was hardcoded true in the
 * branch where the database was NOT available.
 *
 * Neither admin panel consumed `available`, and both derive `rows` as
 * `data?.rows ?? []`, so the fabricated zero fell straight through to
 * "No candidates yet." / "No technician referrals recorded yet." An operator
 * reading either during an outage would conclude nobody applied and nobody
 * referred anyone — on a program that pays $300 a referral.
 *
 * adminSignals.ts already established the opposite convention
 * (`available === false` marks a slice that FAILED, and its own comment warns
 * about "the fabricated zero"), so this was an inversion of a rule the
 * codebase had already written down.
 *
 * Asserted against the real exported helpers with DATABASE_URL removed, which
 * is exactly the condition that produces getDb() === null — no mocking of the
 * thing under test.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";

const ORIGINAL = process.env.DATABASE_URL;

describe("admin reads distinguish 'cannot read' from 'nothing to read'", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL;
  });

  it("getCandidates reports available:false when the DB is gone, not an empty list", async () => {
    const { getCandidates } = await import("./db");
    const res = await getCandidates();

    expect(res.rows).toEqual([]);
    // The row list being empty is fine; claiming the read SUCCEEDED is not.
    expect(res.available).toBe(false);
    // And it must not be mistaken for the migration-pending state, which is a
    // different, honestly-known condition with its own panel copy.
    expect(res.migrationPending).toBe(false);
  });

  it("getTechnicianReferrals reports available:false when the DB is gone", async () => {
    const { getTechnicianReferrals } = await import("./db");
    const res = await getTechnicianReferrals();

    expect(res.rows).toEqual([]);
    expect(res.available).toBe(false);
    expect(res.migrationPending).toBe(false);
  });

  it("both panels branch on available === false before their empty state", async () => {
    // The helper telling the truth only matters if the UI reads it. Both
    // panels derive rows as `data?.rows ?? []`, so without this branch the
    // honest available:false still renders as "none yet".
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const panel of ["CandidatesPanel.tsx", "TechnicianReferralsPanel.tsx"]) {
      const src = readFileSync(
        path.resolve(__dirname, "../client/src/pages/admin/leads", panel),
        "utf8",
      );
      const availableAt = src.indexOf("available === false");
      const emptyAt = src.search(/rows\.length === 0/);
      expect(availableAt, `${panel} never checks available === false`).toBeGreaterThan(-1);
      expect(emptyAt, `${panel} has no empty-state branch`).toBeGreaterThan(-1);
      expect(availableAt, `${panel} checks available AFTER its empty state`).toBeLessThan(emptyAt);
    }
  });
});
