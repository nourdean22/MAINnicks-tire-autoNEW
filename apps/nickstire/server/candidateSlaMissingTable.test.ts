/**
 * getCandidateSlaBreaches must not say "no one is waiting" when it cannot
 * know (2026-09-23).
 *
 * A missing candidates table used to return { available: true, rows: [] }.
 * The admin panel paints that as "nobody waiting", the one answer the
 * function's own comment says must never be fabricated. It now returns
 * available:false, as a dead handle does. The error thrown is the shape a real
 * query produces: drizzle's DrizzleQueryError wrapping the driver's 1146.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";

vi.unmock("./db");

const h = vi.hoisted(() => ({ failWith: null as unknown }));

/** Any chain of builder calls; awaiting it rejects with h.failWith. */
function failingChain(): unknown {
  return new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (_res: unknown, rej: (e: unknown) => unknown) => Promise.reject(h.failWith).catch(rej);
      return () => failingChain();
    },
    apply: () => failingChain(),
  });
}

vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => ({ select: () => failingChain() }) }));

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test:3306/db";
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

const driverError = (code: string, errno: number, message: string) =>
  Object.assign(new Error(message), { code, errno });

describe("getCandidateSlaBreaches · a missing table is 'unknown', never 'nobody waiting'", () => {
  it("a drizzle-wrapped 1146 returns available:false", async () => {
    h.failWith = new DrizzleQueryError("select ...", [], driverError("ER_NO_SUCH_TABLE", 1146, "Table 'nickstire.candidates' doesn't exist"));
    const { getCandidateSlaBreaches } = await import("./db");
    await expect(getCandidateSlaBreaches()).resolves.toEqual({ available: false, rows: [] });
  });

  it("control: any other failure still throws", async () => {
    h.failWith = new DrizzleQueryError("select ...", [], Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));
    const { getCandidateSlaBreaches } = await import("./db");
    await expect(getCandidateSlaBreaches()).rejects.toThrow(/Failed query/);
  });
});
