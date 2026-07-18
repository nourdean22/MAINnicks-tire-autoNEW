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

  it("excludes an attempt whose outcome was recorded", async () => {
    rows = { attempts: [attempt("pub_1", 30)], outcomes: [{ codes: "pub_1" }] };
    expect(await findUnreconciledAttempts()).toHaveLength(0);
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
