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
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * This file can only prove anything if `getDb()` really returns null while it
 * runs. Two things could quietly make it not, and they are NOT equally live —
 * the distinction is recorded because the first version of this comment
 * overstated it, and an overstated rationale is how a cargo-culted guard
 * outlives the reason for it.
 *
 *   1. A CACHED ./db whose `_db` is already a live handle. MEASURED 2026-09-10,
 *      WITHIN a single file: after `delete process.env.DATABASE_URL`, a ./db
 *      that had been imported earlier with the var set still ran a real
 *      `select ... from candidates` rather than taking the `!db` branch. On a
 *      machine whose DATABASE_URL names production, that is a production query
 *      wearing an outage test's clothes.
 *
 *      ACROSS files this does not currently happen: vitest.config.ts sets
 *      `pool: "forks"` + `singleFork` but leaves `isolate` at its default of
 *      true, so each test FILE still gets its own module graph. That is a
 *      config detail, not a property of the code — flipping `isolate: false`
 *      for speed would make the cross-file case real the same day, with no
 *      failing test to announce it.
 *
 *   2. A partial `./db` mock reaching this file. Also per-file under the
 *      current isolation, so `vi.unmock` here is defence in depth rather than
 *      a live fix — the precedent is server/routers/voiceAgent.test.ts.
 *
 * `process.env`, unlike the module graph, is genuinely shared across every
 * file, so the `beforeEach` delete below is what actually carries the outage
 * condition today.
 *
 * The positive control is the load-bearing part: it asserts `getDb()` is null
 * BEFORE any expectation depends on it, so every mechanism above — plus any
 * future one — surfaces as a named failure instead of three assertions passing
 * against a database that was never gone.
 *
 * Raised in review on PR #2264; the first version of this file had none of it.
 */
vi.unmock("./db");

const ORIGINAL = process.env.DATABASE_URL;

describe("admin reads distinguish 'cannot read' from 'nothing to read'", () => {
  beforeEach(() => {
    delete process.env.DATABASE_URL;
    // AFTER the delete: the fresh evaluation is what re-reads the env.
    vi.resetModules();
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL;
    vi.resetModules();
  });

  it("the outage path is genuinely reached — the positive control", async () => {
    // Without this, every assertion below could be satisfied by a cached or
    // mocked module that never executed db.ts's `!db` early return. Proves the
    // handle really is null in this file's process state.
    const { getDb } = await import("./db");
    expect(await getDb(), "getDb() returned a handle — the outage was never exercised").toBeNull();
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
