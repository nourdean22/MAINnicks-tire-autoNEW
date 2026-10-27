/**
 * The wire shape of proposals.decisionSummary: a query that parses with no input (the Approvals tab can
 * call it bare), bounds the window to 1..90 days, and is gated exactly like proposals.list.
 */
import { describe, expect, it } from "vitest";
import { proposalsRouter } from "./proposals";
import { permissionForAdminProcedure } from "../../shared/adminPermissions";

type Def = { type?: string; inputs?: Array<{ safeParse: (v: unknown) => { success: boolean; data?: unknown } }> };
const def = (name: string) =>
  (proposalsRouter as unknown as { _def: { procedures: Record<string, { _def: Def }> } })._def.procedures[name]?._def;

describe("proposals.decisionSummary procedure", () => {
  it("is registered as a query", () => {
    expect(def("decisionSummary")?.type).toBe("query");
  });

  it("parses with no input and defaults to 30 days", () => {
    const input = def("decisionSummary")!.inputs![0];
    expect(input.safeParse(undefined)).toMatchObject({ success: true, data: { days: 30 } });
    expect(input.safeParse({})).toMatchObject({ success: true, data: { days: 30 } });
    expect(input.safeParse({ days: 90 })).toMatchObject({ success: true, data: { days: 90 } });
  });

  it("rejects a window outside 1..90 days or a fraction", () => {
    const input = def("decisionSummary")!.inputs![0];
    for (const days of [0, 91, -1, 1.5]) expect(input.safeParse({ days }).success, String(days)).toBe(false);
  });

  it("needs the same permission as proposals.list (any admin role that can see the queue)", () => {
    expect(permissionForAdminProcedure("proposals.decisionSummary", "query")).toBe(
      permissionForAdminProcedure("proposals.list", "query"),
    );
  });
});
