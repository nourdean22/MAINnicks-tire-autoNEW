/**
 * ROS-083 · a failed read must never render as a positive all-clear.
 *
 * These pin the SERVER half, which is the half that actually matters and the
 * half a client-only fix silently misses.
 *
 * The registry describes this class as four layers, and the deepest one is the
 * killer: a router that converts DB-unavailable into a SUCCESSFUL empty payload.
 * tRPC then resolves HTTP 200, react-query's `isError` stays FALSE, and the UI
 * renders "$0 RECOVERABLE" / "0 · All clear" / five zeros anyway. Every
 * `const unknown = isError` guard added on the client is INERT until these
 * procedures throw — so a PR that ships only the client half looks fixed,
 * reviews clean, and changes nothing in the case that matters.
 *
 * Mutation-verified: reverting any procedure below to `return []` / zeros turns
 * its case red.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return { ...actual, db: getDb, getDb };
});

beforeEach(() => {
  getDb.mockReset().mockResolvedValue(null); // DB unavailable
});

/** Pull a procedure's resolver out of a built tRPC router. */
async function callQuery(router: unknown, path: string, input?: unknown) {
  const proc = (router as Record<string, { _def?: { resolver?: unknown } }>)[path];
  const resolver = (proc as { _def: { resolver: (o: unknown) => unknown } })._def.resolver;
  return resolver({ input, ctx: {}, type: "query", path });
}

describe("declined estimates · DB-down is not $0 recoverable", () => {
  it("throws instead of resolving an all-zero payload", async () => {
    const { invoicesRouter } = await import("./routers/advanced/invoices");
    await expect(callQuery(invoicesRouter, "declined", { days: 30 })).rejects.toBeInstanceOf(TRPCError);
  });

  it("names money explicitly so the operator does not read it as a real zero", async () => {
    const { invoicesRouter } = await import("./routers/advanced/invoices");
    await expect(callQuery(invoicesRouter, "declined", { days: 30 })).rejects.toThrow(/unknown, not zero/i);
  });
});

describe("callback queue · DB-down is not 'All clear'", () => {
  it("throws rather than returning the [] that getCallbackRequests hands back", async () => {
    // The [] at db.ts:484 is DELIBERATE — adminBundle consumes it inside a
    // Promise.allSettled and adminBundleTruth.test.ts pins that shape. So the
    // honesty has to live at the admin read, which is what this asserts.
    const { callbackRouter } = await import("./routers/callback");
    await expect(callQuery(callbackRouter, "list")).rejects.toBeInstanceOf(TRPCError);
  });

  it("says unknown, not empty — missed calls are customers waiting", async () => {
    const { callbackRouter } = await import("./routers/callback");
    await expect(callQuery(callbackRouter, "list")).rejects.toThrow(/unknown, not empty/i);
  });
});

describe("lead pipeline · DB-down is not five zeros", () => {
  it("throws so the Kanban landing view cannot render empty columns", async () => {
    const { leadRouter } = await import("./routers/lead");
    await expect(callQuery(leadRouter, "list")).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("the layer this class hides in", () => {
  it("every procedure fixed here reports SERVICE_UNAVAILABLE, not a generic 500", async () => {
    // A 500 reads as "the app broke"; SERVICE_UNAVAILABLE reads as "this data
    // is temporarily unreadable", which is the true statement and the one that
    // tells an operator to retry rather than to trust a zero.
    const { invoicesRouter } = await import("./routers/advanced/invoices");
    const { callbackRouter } = await import("./routers/callback");
    const { leadRouter } = await import("./routers/lead");

    for (const [router, path] of [
      [invoicesRouter, "declined"],
      [callbackRouter, "list"],
      [leadRouter, "list"],
    ] as const) {
      await expect(callQuery(router, path, path === "declined" ? { days: 30 } : undefined))
        .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    }
  });
});
