/**
 * publishAttemptLedger — the record that must exist BEFORE the irreversible call.
 *
 * A CAS claim stops two runners racing; it does not survive a process death. If
 * the container is killed between Meta accepting a post and the DB update, only
 * this ledger can tell a lost publish from a lost response.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let inserted: Array<Record<string, unknown>>;
let insertThrows: boolean;
let rows: { attempts: Array<Record<string, unknown>>; outcomes: Array<{ codes: string }> };

vi.mock("./db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        if (insertThrows) throw new Error("db down");
        inserted.push(v);
        return [{ affectedRows: 1 }];
      },
    }),
    select: (proj?: unknown) => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => rows.attempts }),
          limit: async () => (proj ? rows.outcomes : rows.attempts),
        }),
      }),
    }),
  }),
}));

import { recordPublishAttempt, recordPublishOutcome, findUnreconciledAttempts, OUTCOME } from "./services/publishAttemptLedger";

beforeEach(() => {
  inserted = [];
  insertThrows = false;
  rows = { attempts: [], outcomes: [] };
});

describe("recordPublishAttempt", () => {
  it("writes an ATTEMPTED row and returns its id", async () => {
    const id = await recordPublishAttempt({ jobId: 42, platforms: ["instagram"], mediaUrl: "https://cdn/x.mp4" });
    expect(id).toMatch(/^pub_/);
    expect(inserted[0]).toMatchObject({ actionType: "publish_attempt", decision: "ATTEMPTED" });
    const ctx = JSON.parse(String(inserted[0].contextJson));
    expect(ctx).toMatchObject({ jobId: 42, platforms: ["instagram"] });
    expect(ctx.requestedAt).toBeTruthy();
  });

  it("returns NULL when the record cannot be written — the caller must not publish unrecorded", async () => {
    insertThrows = true;
    // Unlike recordAuditEvent, which swallows failures because a lost audit row
    // must never block an action, THIS record is the safety property itself.
    expect(await recordPublishAttempt({ jobId: 1, platforms: ["instagram"] })).toBeNull();
  });

  it("keeps every decision value inside decision varchar(24)", () => {
    for (const v of Object.values(OUTCOME)) expect(v.length).toBeLessThanOrEqual(24);
  });
});

describe("recordPublishOutcome", () => {
  it("writes a SEPARATE append-only row carrying the attemptId", async () => {
    await recordPublishOutcome("pub_abc", OUTCOME.confirmed, { igPostId: "ig_1" });
    expect(inserted[0]).toMatchObject({ actionType: "publish_outcome", decision: "CONFIRMED", reasoningCodes: "pub_abc" });
    // Two rows, never an in-place update: an attempt with no outcome IS the
    // signal, so overwriting would erase the evidence a crash happened.
    expect(JSON.parse(String(inserted[0].contextJson))).toMatchObject({ attemptId: "pub_abc", igPostId: "ig_1" });
  });

  it("never throws — the external call already happened, refusing changes nothing", async () => {
    insertThrows = true;
    await expect(recordPublishOutcome("pub_abc", OUTCOME.ambiguous, { error: "boom" })).resolves.toBeUndefined();
  });
});

describe("findUnreconciledAttempts", () => {
  const attempt = (id: string, ageMin: number, ctx: Record<string, unknown> = {}) => ({
    id,
    occurredAt: new Date(Date.now() - ageMin * 60_000),
    contextJson: JSON.stringify({ jobId: 7, platforms: ["instagram"], ...ctx }),
  });

  it("reports an attempt with no outcome", async () => {
    rows = { attempts: [attempt("pub_1", 30)], outcomes: [] };
    const open = await findUnreconciledAttempts();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ attemptId: "pub_1", jobId: 7 });
    expect(open[0].ageMinutes).toBeGreaterThanOrEqual(29);
  });

  it.each(["CONFIRMED", "FAILED"])("excludes an attempt RESOLVED as %s", async (decision) => {
    rows = { attempts: [attempt("pub_1", 30)], outcomes: [{ codes: "pub_1", decision }] };
    expect(await findUnreconciledAttempts()).toHaveLength(0);
  });

  /**
   * THE DEFECT THIS TEST USED TO LOCK IN.
   *
   * It previously asserted that ANY outcome row closes an attempt
   * (`outcomes: [{ codes: "pub_1" }]`, no decision at all) — so AMBIGUOUS, the
   * outcome meaning "we do not know whether this went live", closed the attempt
   * exactly as CONFIRMED did. The one state this function exists to surface was
   * the one it hid, and the test said that was correct.
   *
   * Four live writers produce AMBIGUOUS, all in the catch of a real Meta call.
   * With the attempt closed, openPublishAttempts returned 0, the Action Center's
   * reconcile card never rendered, and resolveAmbiguousPublish — which takes an
   * attemptId whose only source is that list — became unreachable for the exact
   * state it was built for.
   */
  it("KEEPS an attempt whose outcome was AMBIGUOUS — that is the whole point of this list", async () => {
    rows = { attempts: [attempt("pub_1", 30)], outcomes: [{ codes: "pub_1", decision: "AMBIGUOUS" }] };
    const open = await findUnreconciledAttempts();
    expect(open).toHaveLength(1);
    expect(open[0].attemptId).toBe("pub_1");
  });

  it("does not let the OPENING record close its own attempt", async () => {
    // ATTEMPTED is the opening entry, not an outcome.
    rows = { attempts: [attempt("pub_1", 30)], outcomes: [{ codes: "pub_1", decision: "ATTEMPTED" }] };
    expect(await findUnreconciledAttempts()).toHaveLength(1);
  });

  it("keeps an attempt whose outcome decision is missing or unrecognised", async () => {
    // Allowlist, not denylist: an outcome value added later stays OPEN until
    // someone decides it closes an attempt. Being nagged about a resolved
    // publish is a nuisance; hiding one that may be live is the failure this
    // ledger exists to prevent.
    for (const decision of [null, "", "SOMETHING_NEW"]) {
      rows = { attempts: [attempt("pub_1", 30)], outcomes: [{ codes: "pub_1", decision }] };
      expect(await findUnreconciledAttempts()).toHaveLength(1);
    }
  });

  it("KEEPS a row whose context is unreadable — an unparseable attempt is still open", async () => {
    rows = { attempts: [{ id: "pub_x", occurredAt: new Date(Date.now() - 60_000 * 30), contextJson: "{broken" }], outcomes: [] };
    const open = await findUnreconciledAttempts();
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ attemptId: "pub_x", jobId: null });
  });

  it("returns nothing when there are no attempts at all", async () => {
    expect(await findUnreconciledAttempts()).toEqual([]);
  });
});
