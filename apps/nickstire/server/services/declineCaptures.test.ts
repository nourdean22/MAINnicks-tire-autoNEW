/**
 * Q-37 · counter capture of a declined estimate.
 *
 * Two contracts, both on the boundary where a read becomes a rendered claim:
 *
 * 1. CAPTURE is a claim on a unique key (claim-before-act): insert, and on a
 *    duplicate-key rejection re-read the WINNER and report it. A second tap, or
 *    a second device, never writes a second row and never reports "captured"
 *    for a row it did not write.
 * 2. READ has three outcomes (empty-vs-error): captured ids, "not enabled" (the
 *    table is not there yet — migration 0131 is hand-applied), or an error. A
 *    failed read must not come back as an empty set, because an empty set makes
 *    every row render as "inferred", which is a confident claim about rows we
 *    could not see.
 *
 * No real database: getDb is replaced with a scripted fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Script = { selects: unknown[][]; insertError?: unknown };

function fakeDb(script: Script) {
  const inserted: unknown[] = [];
  const chain = () => {
    const c: Record<string, unknown> = {};
    const next = () => script.selects.shift() ?? [];
    for (const k of ["from", "where", "orderBy"]) c[k] = () => c;
    c.limit = async () => next();
    c.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
    return c;
  };
  return {
    inserted,
    db: {
      select: () => chain(),
      insert: () => ({
        values: async (v: unknown) => {
          if (script.insertError) throw script.insertError;
          inserted.push(v);
          return [{ affectedRows: 1 }];
        },
      }),
    },
  };
}

const missingTable = Object.assign(new Error("Table 'nicks.declined_work_captures' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });
const dupKey = Object.assign(new Error("Duplicate entry '7' for key 'uq_declined_capture_estimate'"), { code: "ER_DUP_ENTRY", errno: 1062 });

async function load(script: Script | null) {
  const fake = script ? fakeDb(script) : null;
  vi.doMock("../db", () => ({ getDb: async () => fake?.db ?? null }));
  const mod = await import("./declineCaptures");
  return { mod, fake };
}

describe("captureDeclineAtCounter", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../db"));

  it("writes one counter row carrying what was quoted", async () => {
    const { mod, fake } = await load({ selects: [[{ id: 7, serviceDescription: "Front brake pads + rotors" }]] });
    const r = await mod.captureDeclineAtCounter({ estimateId: 7, capturedBy: "moe@shop" });
    expect(r).toMatchObject({ ok: true, kind: "captured" });
    expect(fake!.inserted).toEqual([
      expect.objectContaining({ estimateId: 7, declinedItem: "Front brake pads + rotors", source: "counter", capturedBy: "moe@shop" }),
    ]);
  });

  it("a second tap loses the claim and reports the WINNER's time, without a second row", async () => {
    const winnerAt = new Date("2026-09-23T15:00:00Z");
    const { mod, fake } = await load({
      selects: [[{ id: 7, serviceDescription: "Brakes" }], [{ capturedAt: winnerAt }]],
      insertError: dupKey,
    });
    const r = await mod.captureDeclineAtCounter({ estimateId: 7, capturedBy: "moe@shop" });
    expect(r).toEqual({ ok: true, kind: "already_captured", capturedAt: winnerAt });
    expect(fake!.inserted).toEqual([]);
  });

  it("an unknown estimate is refused, not captured", async () => {
    const { mod, fake } = await load({ selects: [[]] });
    const r = await mod.captureDeclineAtCounter({ estimateId: 99, capturedBy: "moe@shop" });
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    expect(fake!.inserted).toEqual([]);
  });

  it("before migration 0131 is applied, says so instead of failing silently", async () => {
    const { mod } = await load({ selects: [[{ id: 7, serviceDescription: null }]], insertError: missingTable });
    const r = await mod.captureDeclineAtCounter({ estimateId: 7, capturedBy: "moe@shop" });
    expect(r).toMatchObject({ ok: false, reason: "not_enabled" });
    if (!r.ok) expect(r.error).toMatch(/0131/);
  });

  it("no database is an error, not a capture", async () => {
    const { mod } = await load(null);
    const r = await mod.captureDeclineAtCounter({ estimateId: 7, capturedBy: "moe@shop" });
    expect(r).toMatchObject({ ok: false, reason: "db_unavailable" });
  });
});

describe("readDeclineCaptures", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("../db"));

  it("returns the captured ids among those asked about", async () => {
    const { mod } = await load({ selects: [[{ estimateId: 3 }, { estimateId: 5 }]] });
    const r = await mod.readDeclineCaptures([3, 4, 5]);
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect([...r.capturedIds].sort()).toEqual([3, 5]);
  });

  it("a missing table is 'not_enabled', not an error and not an empty ok", async () => {
    const fake = { select: () => { throw missingTable; } };
    vi.doMock("../db", () => ({ getDb: async () => fake }));
    const mod = await import("./declineCaptures");
    expect(await mod.readDeclineCaptures([1])).toEqual({ status: "not_enabled" });
  });

  it("any other failure is an error — never an empty set", async () => {
    const fake = { select: () => { throw new Error("connection reset"); } };
    vi.doMock("../db", () => ({ getDb: async () => fake }));
    const mod = await import("./declineCaptures");
    const r = await mod.readDeclineCaptures([1]);
    expect(r.status).toBe("error");
  });

  it("no database is an error", async () => {
    const { mod } = await load(null);
    expect((await mod.readDeclineCaptures([1])).status).toBe("error");
  });
});

describe("describeConfirmedShare", () => {
  it("says which part of a total was observed and which inferred", async () => {
    const { describeConfirmedShare } = await import("./declineCaptures");
    expect(describeConfirmedShare(10, { status: "ok", count: 0 })).toMatch(/all inferred/);
    expect(describeConfirmedShare(10, { status: "not_enabled" })).toMatch(/all inferred/);
    expect(describeConfirmedShare(10, { status: "ok", count: 3 })).toBe(" · 3 confirmed at counter, 7 inferred");
    expect(describeConfirmedShare(3, { status: "ok", count: 3 })).toMatch(/all confirmed/);
  });

  it("a failed count says the split is unknown — never 'all inferred'", async () => {
    const { describeConfirmedShare } = await import("./declineCaptures");
    const s = describeConfirmedShare(10, { status: "error", error: "x" });
    expect(s).toMatch(/unknown/);
    expect(s).not.toMatch(/inferred \(/);
  });
});
