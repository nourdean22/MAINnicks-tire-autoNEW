/**
 * A guard that reads the wrong level fires on every call.
 *
 * drizzle-orm's mysql2 driver types every write as
 * `[ResultSetHeader, FieldPacket[]]`, so `insertId` and `affectedRows` live at
 * `[0]`. shareCards read them off the ARRAY:
 *
 *   create:     (result as any).insertId            -> undefined
 *   trackShare: (result).affectedRows ?? 0          -> 0 -> "not found", ALWAYS
 *
 * So `create` reported `id: undefined` for every card it successfully wrote,
 * and `trackShare` — a check written to detect a MISSING card — instead threw
 * for every token, including valid ones. It could not succeed.
 *
 * WHY tsc DID NOT CATCH IT
 * `(result as any)` and `(result as unknown as {...})`. The casts told the
 * compiler to stop looking at precisely the place the shape was wrong. The
 * type system had the answer — MySqlRawQueryResult is declared as a tuple —
 * and the casts discarded it.
 *
 * The ~20 write sites in server/db.ts get this right (`result[0].insertId`),
 * and the raw-execute callers destructure (`const [result] = await
 * db.execute(...)`), which is why this was the only file affected. Second time
 * this class has bitten today: #1121 was the read side of the same tuple.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeResult, insertedId, affectedRows } from "./lib/dbResult";

describe("unwrapping a mysql2 write result", () => {
  it("reads the header out of the driver's [header, fields] tuple", () => {
    expect(writeResult([{ insertId: 42, affectedRows: 1 }, []])).toEqual({ insertId: 42, affectedRows: 1 });
  });

  it("also accepts a header a caller already destructured", () => {
    // `const [result] = await db.execute(...)` is the dominant pattern in this
    // repo and is correct; the helper must not break it.
    expect(writeResult({ affectedRows: 3 })).toEqual({ affectedRows: 3 });
  });

  it("insertedId finds the id at the right level, and only there", () => {
    expect(insertedId([{ insertId: 42 }, []])).toBe(42);
    expect(insertedId({ insertId: 42 })).toBe(42);
    // The original bug: the id is present, but one level down.
    expect(insertedId([[{ insertId: 42 }], []])).toBeNull();
  });

  it("insertedId refuses a junk id rather than inventing one", () => {
    for (const bad of [0, -1, 1.5, "", "abc", null, undefined, {}]) {
      expect(insertedId([{ insertId: bad }, []]), `accepted ${JSON.stringify(bad)}`).toBeNull();
    }
    expect(insertedId(undefined)).toBeNull();
    expect(insertedId("nonsense")).toBeNull();
  });

  it("a numeric-string id still resolves (drivers vary on BIGINT)", () => {
    expect(insertedId([{ insertId: "42" as unknown as number }, []])).toBe(42);
  });

  it("affectedRows distinguishes ZERO from NOTHING-REPORTED", () => {
    // This distinction IS the bug. Collapsing "the driver said nothing" into
    // "no row matched" is what made trackShare always throw.
    expect(affectedRows([{ affectedRows: 0 }, []])).toBe(0);
    expect(affectedRows([{ affectedRows: 1 }, []])).toBe(1);
    expect(affectedRows([{}, []])).toBeNull();
    expect(affectedRows(undefined)).toBeNull();
  });

  it("falls back to changedRows when that is all the driver gives", () => {
    expect(affectedRows([{ changedRows: 2 }, []])).toBe(2);
    // affectedRows wins when both are present — it counts matched rows, and an
    // UPDATE that matched but changed nothing is still "found".
    expect(affectedRows([{ affectedRows: 1, changedRows: 0 }, []])).toBe(1);
  });
});

/**
 * The router, driven through the shape the real driver actually returns.
 */
const updateResult = { value: [{ affectedRows: 1 }, []] as unknown };
const insertResult = { value: [{ insertId: 4210 }, []] as unknown };

vi.mock("./lib/db-helper", () => {
  const database = {
    insert: () => ({ values: async () => insertResult.value }),
    update: () => ({ set: () => ({ where: async () => updateResult.value }) }),
  };
  return { db: async () => database, dbTyped: async () => database, requireDb: async () => database };
});

import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const caller = () => appRouter.createCaller({
  user: {
    id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
    loginMethod: "manus", role: "admin",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: { clearCookie: () => {} } as TrpcContext["res"],
} as TrpcContext);

const TOKEN = "a".repeat(64);

beforeEach(() => {
  updateResult.value = [{ affectedRows: 1 }, []];
  insertResult.value = [{ insertId: 4210 }, []];
});

describe("shareCards.trackShare", () => {
  it("SUCCEEDS against the real driver shape — it never could before", () => {
    // The regression. With the old `(result).affectedRows ?? 0`, this exact
    // input produced 0 and threw "Share card not found".
    return expect(caller().shareCards.trackShare({ token: TOKEN })).resolves.toEqual({ success: true });
  });

  it("still refuses a token that matched no row, and calls it NOT_FOUND", async () => {
    updateResult.value = [{ affectedRows: 0 }, []];
    await expect(caller().shareCards.trackShare({ token: TOKEN }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does NOT invent a failure when the driver reports no count at all", async () => {
    // Unknown is not zero. Reporting "not found" here would be the original
    // bug wearing a different hat.
    updateResult.value = [{}, []];
    await expect(caller().shareCards.trackShare({ token: TOKEN })).resolves.toEqual({ success: true });
  });
});

describe("shareCards.create", () => {
  it("returns the real row id, not undefined", async () => {
    const r = await caller().shareCards.create({ customerName: "Sam" });
    expect(r.id).toBe(4210);
    expect(r.token).toHaveLength(64);
    expect(r.shareUrl).toContain(r.token);
  });

  it("still returns a usable share link when the driver reports no id", async () => {
    // The row WAS written — the insert did not throw — so this is a reporting
    // problem, not a failed create. The token is what the URL depends on.
    insertResult.value = [{}, []];
    const r = await caller().shareCards.create({ customerName: "Sam" });
    expect(r.id).toBeNull();
    expect(r.shareUrl).toContain(r.token);
  });
});
