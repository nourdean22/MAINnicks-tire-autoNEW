/**
 * Ledger middleware through the REAL tRPC chain (not fake opts).
 *
 * The unit tests exercise withActivityLedger with hand-built opts; this file
 * closes the gap they leave open: does a `.use()` attached AFTER `.input()`
 * in THIS tRPC version actually receive the PARSED input, and does the
 * middleware pass the mutation result through unchanged? The z.coerce pin is
 * the load-bearing one — the recorder must see the coerced NUMBER, which is
 * only possible if opts.input is the parsed value, not the raw payload.
 *
 * Uses the app's own publicProcedure (loggerMiddleware included), so this is
 * the same chain production requests ride.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { publicProcedure, router } from "../_core/trpc";
import { withActivityLedger, type RecordActivityInput } from "./activityLedger";
import type { TrpcContext } from "../_core/context";

const CTX = { req: { headers: {} }, res: {}, user: null } as unknown as TrpcContext;

function buildCaller(records: RecordActivityInput[], opts?: { failRecorder?: boolean }) {
  const testRouter = router({
    submitThing: publicProcedure
      .input(z.object({ name: z.string(), phone: z.string(), amount: z.coerce.number() }))
      .use((mw) =>
        withActivityLedger(mw, {
          action: "lead.created",
          entityType: "lead",
          entityId: (_input, data) => (data as { id: number }).id,
          after: (input) => ({ ...(input as Record<string, unknown>) }),
          record: async (i) => {
            if (opts?.failRecorder) throw new Error("ledger down");
            records.push(i);
          },
        }),
      )
      .mutation(({ input }) => ({ id: 42, echoedAmount: input.amount })),
    failingThing: publicProcedure
      .input(z.object({ name: z.string() }))
      .use((mw) =>
        withActivityLedger(mw, {
          action: "lead.created",
          entityType: "lead",
          record: async (i) => {
            records.push(i);
          },
        }),
      )
      .mutation(() => {
        throw new Error("business logic refused");
      }),
  });
  return testRouter.createCaller(CTX);
}

describe("withActivityLedger on the real tRPC chain", () => {
  it("receives the PARSED input (zod coercion visible) and the real result", async () => {
    const records: RecordActivityInput[] = [];
    const caller = buildCaller(records);

    const result = await caller.submitThing({ name: "Jane", phone: "2168620005", amount: "1200" as unknown as number });

    expect(result).toEqual({ id: 42, echoedAmount: 1200 });
    expect(records).toHaveLength(1);
    // THE pin: "1200" (string over the wire) arrived as 1200 (number) — the
    // middleware saw zod's output, so extractors can trust schema types.
    expect(records[0].after).toMatchObject({ amount: 1200, name: "Jane" });
    expect(records[0].entityId).toBe(42);
    expect(records[0].actor).toEqual({ actor: "public", actorType: "public" });
  });

  it("a dead recorder cannot break the mutation", async () => {
    const caller = buildCaller([], { failRecorder: true });
    await expect(
      caller.submitThing({ name: "Jane", phone: "2168620005", amount: 5 }),
    ).resolves.toEqual({ id: 42, echoedAmount: 5 });
  });

  it("a failed mutation records nothing and still throws to the caller", async () => {
    const records: RecordActivityInput[] = [];
    const caller = buildCaller(records);
    await expect(caller.failingThing({ name: "Jane" })).rejects.toThrow();
    expect(records).toHaveLength(0);
  });
});
