/**
 * sourcing.compareTires: one Gateway size search -> offers for the counter panel. A failed lookup, an empty one and
 * a refused size are three different answers, never "no offers".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rows: null as Record<string, unknown>[] | null,
  failure: null as { at: number; reason: string; detail?: string } | null,
  searched: [] as string[],
}));

vi.mock("../services/gatewayClient", () => ({
  GATEWAY_PORTAL_BASE: "https://b2b.dktire.com",
  pickWholesaleCost: (item: Record<string, unknown>) => {
    const p = (item.pricing_data as Record<string, number>[] | undefined)?.[0];
    return p && p.selling_price > 0 ? p.selling_price : 0;
  },
  searchTiresBySize: async (size: string) => (h.searched.push(size), h.rows),
  getLastGatewayFailure: () => h.failure,
}));

import { sourcingRouter } from "./sourcing";

function ctx(role: "admin" | "user" = "admin") {
  return {
    user: {
      id: 1, openId: `${role}-user`, email: `${role}@example.test`, name: role, loginMethod: "manus",
      role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} },
    res: { clearCookie: () => {} },
  } as never;
}
const compare = (size: string, role: "admin" | "user" = "admin") => sourcingRouter.createCaller(ctx(role)).compareTires({ size });

const ROW = {
  dk_part_number: "NX-2256517",
  invent_size: "225/65R17",
  on_hand: 6,
  pricing_data: [{ site_name: "Seville, OH", selling_price: 88.5, fet: 0 }],
};

beforeEach(() => {
  h.rows = null;
  h.failure = null;
  h.searched = [];
});

describe("sourcing.compareTires", () => {
  it("live: normalized size searched, offers returned with the lookup time, ATD and Capital named as not connected", async () => {
    h.rows = [ROW];
    const r = await compare("2256517");
    expect(h.searched).toEqual(["225/65R17"]);
    expect(r.size).toBe("225/65R17");
    expect(r.suppliers).toEqual([expect.objectContaining({ id: "gateway_dk", status: "live", reason: null })]);
    expect(r.offers.map((o) => o.sku)).toEqual(["NX-2256517"]);
    expect(r.offers[0].lastVerifiedAt).toBe(r.lookedUpAt);
    expect(r.notConnected).toEqual(["ATD", "Capital Tire"]);
  });

  it("a failed lookup is 'unavailable' with the reason and the portal link, not an empty list", async () => {
    h.failure = { at: Date.now(), reason: "login_failed", detail: "account 12345 rejected" };
    const r = await compare("225/65R17");
    expect(r.suppliers[0]).toMatchObject({ status: "unavailable", reason: "login_failed" });
    expect(r.suppliers[0].portalUrl).toContain("b2b.dktire.com");
    expect(JSON.stringify(r)).not.toContain("12345");
  });

  it("an empty answer is 'no_results'", async () => {
    h.rows = [];
    const r = await compare("225/65R17");
    expect(r.suppliers[0].status).toBe("no_results");
    expect(r.offers).toEqual([]);
  });

  it("a size it cannot read is refused before any supplier call", async () => {
    await expect(compare("LT265/70R17")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.searched).toEqual([]);
  });

  it("is admin-only", async () => {
    h.rows = [ROW];
    await expect(compare("225/65R17", "user")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.searched).toEqual([]);
  });
});
