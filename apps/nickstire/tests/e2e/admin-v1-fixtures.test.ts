/**
 * Unit tests for the admin v1 fixture router (tests/e2e/fixtures/admin-v1/answer.ts).
 * The Playwright spec trusts this router to answer every read the three pages make
 * and to NAME anything it cannot answer; these pin both halves without a browser.
 */
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { answerAdminApi, answerProcedure, DEMO_CLOCK, NOT_FOUND } from "./fixtures/admin-v1/answer";

const batchUrl = (names: string[], inputs: Record<string, unknown> = {}) => {
  const wire = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, superjson.serialize(v)]));
  return `http://x.test/api/trpc/${names.join(",")}?batch=1&input=${encodeURIComponent(JSON.stringify(wire))}`;
};

type Item = { result?: { data: Parameters<typeof superjson.deserialize>[0] }; error?: Parameters<typeof superjson.deserialize>[0] };

describe("admin v1 fixture router", () => {
  it("answers auth.me as a demo admin and security status as past the MFA gate", () => {
    const me = answerProcedure("auth.me", undefined, DEMO_CLOCK);
    expect(me).not.toBe(NOT_FOUND);
    expect((me as { data: { role: string; name: string } }).data).toMatchObject({ role: "admin", name: "Demo owner" });
    const status = (answerProcedure("adminSecurity.status", undefined, DEMO_CLOCK) as { data: Record<string, unknown> }).data;
    // pages/Admin.tsx adminReady: !mfaRequired || (mfaEnabled && mfaVerified); AdminMfaGate returns null when verified.
    expect(status).toMatchObject({ mfaRequired: false, mfaVerified: true, adminRole: "owner" });
  });

  it("returns NOT_FOUND for a procedure with no fixture", () => {
    expect(answerProcedure("customers.deleteEverything", undefined, DEMO_CLOCK)).toBe(NOT_FOUND);
  });

  it("splits a batched path and answers one item per procedure, in order", () => {
    const res = answerAdminApi(batchUrl(["auth.me", "proposals.counts", "lot.now"]), DEMO_CLOCK);
    expect(res.status).toBe(200);
    expect(res.missing).toEqual([]);
    const items = res.body as Item[];
    expect(items).toHaveLength(3);
    const values = items.map((it) => superjson.deserialize(it.result!.data)) as [{ role: string }, { readable: boolean; count: number }, { ok: boolean }];
    expect(values[0].role).toBe("admin");
    expect(values[1]).toEqual({ readable: true, count: 3 });
    expect(values[2].ok).toBe(true);
  });

  it("names the unstubbed procedure in a mixed batch and answers it with a tRPC NOT_FOUND item", () => {
    const res = answerAdminApi(batchUrl(["auth.me", "reports.secretThing"]), DEMO_CLOCK);
    expect(res.missing).toEqual(["reports.secretThing"]);
    expect(res.status).toBe(207);
    const err = superjson.deserialize((res.body as Item[])[1].error!) as { data: { code: string } };
    expect(err.data.code).toBe("NOT_FOUND");
  });

  it("passes the decoded input to the handler (lot.visits openOnly returns only open visits)", () => {
    const res = answerAdminApi(batchUrl(["lot.visits"], { 0: { limit: 50, openOnly: true, includeCommissioning: false } }), DEMO_CLOCK);
    const value = superjson.deserialize((res.body as Item[])[0].result!.data) as { rows: Array<{ departedAt: string | null }> };
    expect(value.rows.length).toBe(5);
    expect(value.rows.every((r) => r.departedAt === null)).toBe(true);
  });

  it("the DEMO Tuesday has 6 to 9 queue sources, 5 cars on the lot and 3 held approvals", () => {
    const bundle = (answerProcedure("adminDashboard.overviewMediumBundle", undefined, DEMO_CLOCK) as { data: Record<string, unknown[]> }).data;
    const wos = (answerProcedure("workOrders.list", { limit: 25 }, DEMO_CLOCK) as { data: unknown[] }).data;
    const queueish =
      (bundle.bookings as Array<{ status: string }>).filter((b) => b.status === "new").length +
      (bundle.leads as Array<{ status: string }>).filter((l) => l.status === "new" || l.status === "contacted").length +
      (bundle.callbacks as Array<{ status: string }>).filter((c) => c.status === "new" || c.status === "pending").length +
      bundle.owedTexts.length +
      wos.length;
    expect(queueish).toBeGreaterThanOrEqual(6);
    expect(queueish).toBeLessThanOrEqual(9);
    const held = (answerProcedure("proposals.list", undefined, DEMO_CLOCK) as { data: Array<{ status: string }> }).data;
    expect(held.filter((p) => p.status === "pending_review")).toHaveLength(3);
  });
});
