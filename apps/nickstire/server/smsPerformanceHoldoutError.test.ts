/**
 * Q-21 review P2-7 · recoveredRevenue must RETURN a failed holdout read.
 *
 * The holdout read is a side read: its failure must not erase the observed
 * board, but it must reach the section as `holdoutError` — pushing it into
 * `limitations` alone rendered as "unmeasured". The error text is the driver
 * class/code only (describeDbError): a drizzle error message is the SQL and
 * its bound params.
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: 0, failHoldout: true }));

class DrizzleQueryError extends Error {}

vi.mock("./lib/db-helper", () => ({
  db: async () => ({
    execute: vi.fn(async () => {
      h.calls++;
      // 1 = message rows, 2 = revenue rows, 3 = holdout assignments
      if (h.calls === 3 && h.failHoldout) {
        throw new DrizzleQueryError("Failed query: SELECT ... FROM contact_experiment_assignments\nparams: v1,2165550188");
      }
      return [[]];
    }),
  }),
}));

import { smsPerformanceRouter } from "./routers/smsPerformance";
import type { TrpcContext } from "./_core/context";

function ctx(): TrpcContext {
  return {
    user: { id: 1, openId: "admin", email: "a@b.com", name: "A", loginMethod: "manus", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}

describe("recoveredRevenue · holdout read failure", () => {
  it("returns holdoutError (driver class only, no SQL/params) and keeps the observed board", async () => {
    h.calls = 0;
    h.failHoldout = true;
    const res = await smsPerformanceRouter.createCaller(ctx()).recoveredRevenue();
    expect(res.error).toBeUndefined();
    expect(res.holdoutError).toMatch(/DrizzleQueryError/);
    expect(res.holdoutError).not.toMatch(/2165550188|SELECT/);
  });

  it("control: a clean read returns holdoutError null", async () => {
    h.calls = 0;
    h.failHoldout = false;
    const res = await smsPerformanceRouter.createCaller(ctx()).recoveredRevenue();
    expect(res.holdoutError).toBeNull();
  });
});
