/**
 * gatewayTire.markup / updateMarkup (contract gatewayTire.markup v1, updateMarkup v2, 2026-10-25).
 *
 * The admin card for the online tire markup used to say "the current value is not shown here; saving
 * replaces it": a blind write with no read-back, and every save was recorded as the word "admin".
 * Now `markup` reads the saved row (percent, when, by whom) and `updateMarkup` records the signed-in
 * admin and returns the row it saved, in the same shape as the read.
 *
 * The db is an in-memory shop_settings table behind the drizzle chains the code uses, so a test sees
 * what was actually written (key, value, updatedBy), not what a mock was told to return.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { key: string; value: string; label?: string; category?: string; updatedBy: string; updatedAt: Date };

const h = vi.hoisted(() => ({
  // dbAdminProcedure's guard and the new code read getDbTyped; getDb stays null so the admin-role read
  // takes its documented missing-row path (see localGrowth.test.ts), and `legacyDb` is set only where
  // the pricing path (getTireMarkup, which reads getDb) is compared against the new read.
  db: null as unknown,
  legacyDb: null as unknown,
  row: null as Row | null,
  inserts: [] as Row[],
  failRead: false,
  failWrite: false,
}));

function makeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (h.failRead) throw new Error("ER_LOCK_WAIT_TIMEOUT");
            return h.row ? [h.row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Omit<Row, "updatedAt">) => ({
        onDuplicateKeyUpdate: async ({ set }: { set: Partial<Row> }) => {
          if (h.failWrite) throw new Error("ER_DATA_TOO_LONG");
          h.inserts.push({ ...v, updatedAt: new Date() });
          h.row = h.row
            ? { ...h.row, ...set, updatedAt: new Date("2026-10-25T21:00:00.000Z") }
            : { ...v, updatedAt: new Date("2026-10-25T21:00:00.000Z") };
        },
      }),
    }),
  };
}

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: async () => h.legacyDb,
  getDbTyped: async () => h.db,
}));

import { gatewayTireRouter } from "./gatewayTire";
import { getTireMarkup } from "../lib/tireMarkup";

function ctx(role: "admin" | "user", userOverride: Record<string, unknown> = {}) {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: "owner@example.com", name: "Owner", loginMethod: "manus", ...userOverride,
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const caller = (role: "admin" | "user" = "admin", userOverride: Record<string, unknown> = {}) =>
  gatewayTireRouter.createCaller(ctx(role, userOverride));

beforeEach(() => {
  h.db = makeDb();
  h.legacyDb = null;
  h.row = null;
  h.inserts = [];
  h.failRead = false;
  h.failWrite = false;
});

const seed = (value: string, updatedBy = "system-migration-0054") => {
  h.row = { key: "tireMarkup", value, updatedBy, updatedAt: new Date("2026-06-18T12:00:00.000Z") };
};

describe("gatewayTire.markup", () => {
  it("an empty table is percent null with no author and no date, never 0 or the 100 pricing default", async () => {
    expect(await caller().markup()).toEqual({
      available: true, percent: null, updatedAt: null, updatedBy: null, note: null,
    });
  });

  it("returns the saved percent with when and by whom it was set", async () => {
    seed("150", "owner@example.com");
    expect(await caller().markup()).toEqual({
      available: true, percent: 150, updatedAt: "2026-06-18T12:00:00.000Z", updatedBy: "owner@example.com", note: null,
    });
  });

  it.each([
    ["text", "abc"],
    ["above the 300 cap", "999"],
    ["below zero", "-5"],
    ["an empty string", ""],
    ["NaN", "NaN"],
  ])("a stored value that is %s is percent null with a note, and still names who and when", async (_label, value) => {
    seed(value, "owner@example.com");
    expect(await caller().markup()).toEqual({
      available: true, percent: null, updatedAt: "2026-06-18T12:00:00.000Z", updatedBy: "owner@example.com",
      note: "stored value unreadable",
    });
  });

  it("the 0 and 300 ends are readable (cap-1, cap) and 300.5 is not (cap+1)", async () => {
    seed("0");
    expect(await caller().markup()).toMatchObject({ percent: 0 });
    seed("300");
    expect(await caller().markup()).toMatchObject({ percent: 300 });
    seed("300.5");
    expect(await caller().markup()).toMatchObject({ percent: null, note: "stored value unreadable" });
  });

  it.each(["150", "99.5", "0", "300", "100abc"])(
    "reports the same number the pricing path uses (stored %s)",
    async (value) => {
      seed(value);
      const read = await caller().markup();
      h.legacyDb = h.db; // getTireMarkup reads through getDb
      expect(read).toMatchObject({ available: true, percent: await getTireMarkup() });
    },
  );

  it("a read that throws is available:false with the reason, not an empty or default result", async () => {
    h.failRead = true;
    const out = await caller().markup();
    expect(out).toMatchObject({ available: false, reason: "error" });
    expect((out as { message: string }).message).toMatch(/ER_LOCK_WAIT_TIMEOUT/);
  });

  it("is admin only", async () => {
    await expect(caller("user").markup()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a dead database handle is SERVICE_UNAVAILABLE at the router, never a result (dbAdminProcedure, ROS-083)", async () => {
    h.db = null;
    await expect(caller().markup()).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

describe("gatewayTire.updateMarkup", () => {
  it("records the signed-in admin's email (not the word admin) and returns the saved row in the read's shape", async () => {
    const out = await caller().updateMarkup({ markup: 150 });
    expect(out).toEqual({
      available: true, percent: 150, updatedAt: "2026-10-25T21:00:00.000Z", updatedBy: "owner@example.com", note: null,
    });
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      key: "tireMarkup", value: "150", category: "pricing", label: "Tire Markup %", updatedBy: "owner@example.com",
    });
    // The read after the write agrees with what the write returned.
    expect(await caller().markup()).toEqual(out);
  });

  it("replaces an existing row: the new author wins over the migration's", async () => {
    seed("100", "system-migration-0054");
    const out = await caller().updateMarkup({ markup: 120.5 });
    expect(out).toMatchObject({ available: true, percent: 120.5, updatedBy: "owner@example.com" });
  });

  it("the author falls back to the name, then the openId, when there is no email", async () => {
    await caller("admin", { email: null }).updateMarkup({ markup: 110 });
    await caller("admin", { email: null, name: null }).updateMarkup({ markup: 111 });
    expect(h.inserts.map((r) => r.updatedBy)).toEqual(["Owner", "admin-user"]);
  });

  it("never writes the literal word admin as the author", async () => {
    await caller("admin", { email: null, name: null, openId: "u-42" }).updateMarkup({ markup: 130 });
    expect(h.inserts.map((r) => r.updatedBy)).not.toContain("admin");
    expect(h.inserts[0].updatedBy).toBe("u-42");
  });

  it("an author longer than the varchar(100) column is cut, not sent whole (STRICT_TRANS_TABLES would lose the row)", async () => {
    await caller("admin", { email: `${"x".repeat(150)}@example.com` }).updateMarkup({ markup: 140 });
    expect(h.inserts[0].updatedBy).toHaveLength(100);
  });

  it("bounds: 0 and 300 are saved; -1 and 301 are BAD_REQUEST and write nothing", async () => {
    await expect(caller().updateMarkup({ markup: 0 })).resolves.toMatchObject({ percent: 0 });
    await expect(caller().updateMarkup({ markup: 300 })).resolves.toMatchObject({ percent: 300 });
    await expect(caller().updateMarkup({ markup: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().updateMarkup({ markup: 301 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.inserts).toHaveLength(2);
  });

  it("a failed write throws; it does not report a save that did not happen", async () => {
    h.failWrite = true;
    await expect(caller().updateMarkup({ markup: 150 })).rejects.toThrow(/ER_DATA_TOO_LONG/);
    expect(h.row).toBeNull();
  });

  it("is admin only, and a refused caller writes nothing", async () => {
    await expect(caller("user").updateMarkup({ markup: 150 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.inserts).toHaveLength(0);
  });

  it("a dead database handle is SERVICE_UNAVAILABLE and writes nothing (no more { success: false })", async () => {
    h.db = null;
    await expect(caller().updateMarkup({ markup: 150 })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(h.inserts).toHaveLength(0);
  });
});
