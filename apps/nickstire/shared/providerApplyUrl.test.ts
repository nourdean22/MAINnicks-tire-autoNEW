/**
 * providerApplyUrl: each provider's apply link, carrying only what that provider's apply app
 * reads (manager RE of the public apply bundles, 2026-10-18): Koalafi prefills a 10-digit
 * `phone`; American First Finance copies `amount` (dollars) and `reference` (our order number).
 * Every other provider gets its applyUrl byte for byte.
 */
import { describe, expect, it } from "vitest";
import { FINANCING_PROVIDERS, PROVIDER_MAP, providerApplyUrl } from "./financing";

const koalafi = PROVIDER_MAP["koalafi"];
const aff = PROVIDER_MAP["american-first"];
const EPPLY = "https://epply.koalafi.com/?dealerPublicId=04fe63e5-61e7-4689-b53e-9b127da46c9c&cm=Text";

describe("providerApplyUrl · Koalafi", () => {
  it("a 10-digit phone opens the apply app directly with the phone prefilled, dealer kept", () => {
    const url = providerApplyUrl(koalafi, { phone: "(216) 555-0100" });
    expect(url).toBe(`${EPPLY}&phone=2165550100`);
    expect(new URL(url).searchParams.get("dealerPublicId")).toBe("04fe63e5-61e7-4689-b53e-9b127da46c9c");
  });

  it("an 11-digit number starting with 1 drops the country code", () => {
    expect(providerApplyUrl(koalafi, { phone: "1-216-555-0100" })).toBe(`${EPPLY}&phone=2165550100`);
  });

  it("anything that is not 10 digits keeps the short link", () => {
    expect(providerApplyUrl(koalafi, { phone: "555-0100" })).toBe(koalafi.applyUrl);
    expect(providerApplyUrl(koalafi, { phone: "2-216-555-0100" })).toBe(koalafi.applyUrl);
    expect(providerApplyUrl(koalafi, {})).toBe(koalafi.applyUrl);
    expect(koalafi.applyUrl).toBe("https://s.koalafi.com/GWPaPM");
  });
});

describe("providerApplyUrl · American First Finance", () => {
  it("adds amount in dollars and the order number as reference, keeping every existing parameter", () => {
    const url = new URL(providerApplyUrl(aff, { amountCents: 63000, orderNumber: "TO-2026-0123" }));
    expect(url.searchParams.get("amount")).toBe("630.00");
    expect(url.searchParams.get("reference")).toBe("TO-2026-0123");
    const base = new URL(aff.applyUrl);
    for (const [k, v] of base.searchParams) expect(url.searchParams.getAll(k)).toEqual([v]);
    expect(url.origin + url.pathname).toBe(base.origin + base.pathname);
  });

  it("no amount for 0, NaN, a negative or a fractional cent value; no reference for an empty or 41-char order number", () => {
    for (const amountCents of [0, Number.NaN, -500, 12.5, Number.POSITIVE_INFINITY]) {
      expect(new URL(providerApplyUrl(aff, { amountCents })).searchParams.has("amount"), String(amountCents)).toBe(false);
    }
    expect(new URL(providerApplyUrl(aff, { orderNumber: "" })).searchParams.has("reference")).toBe(false);
    expect(new URL(providerApplyUrl(aff, { orderNumber: "X".repeat(41) })).searchParams.has("reference")).toBe(false);
    expect(new URL(providerApplyUrl(aff, { orderNumber: "X".repeat(40) })).searchParams.get("reference")).toBe("X".repeat(40));
  });

  it("an order number with spaces or & is encoded, never split into another parameter", () => {
    const url = new URL(providerApplyUrl(aff, { orderNumber: "TO 1&amount=1" }));
    expect(url.searchParams.get("reference")).toBe("TO 1&amount=1");
    expect(url.searchParams.has("amount")).toBe(false);
  });

  it("with nothing to add, the link is unchanged", () => {
    expect(providerApplyUrl(aff, {})).toBe(aff.applyUrl);
  });
});

describe("providerApplyUrl · everyone else", () => {
  it("kafene, snap and acima get applyUrl byte for byte whatever the context", () => {
    const ctx = { phone: "2165550100", amountCents: 63000, orderNumber: "TO-2026-0123" };
    for (const id of ["kafene", "snap", "acima"]) {
      const p = PROVIDER_MAP[id];
      expect(p, id).toBeDefined();
      expect(providerApplyUrl(p, ctx), id).toBe(p.applyUrl);
    }
  });

  it("covers every provider in the roster (a new provider defaults to its applyUrl)", () => {
    for (const p of FINANCING_PROVIDERS) expect(typeof providerApplyUrl(p, {})).toBe("string");
  });
});
