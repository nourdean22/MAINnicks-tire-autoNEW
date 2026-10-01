import { describe, it, expect } from "vitest";
import { offerPriceFields } from "@/lib/offerPrice";

describe("offerPriceFields", () => {
  it("never concatenates a range into one price", () => {
    expect(offerPriceFields("$150–$350")).toEqual({
      priceSpecification: { "@type": "PriceSpecification", minPrice: "150", maxPrice: "350", priceCurrency: "USD" },
    });
    expect(offerPriceFields("$800-$1,500")).toEqual({
      priceSpecification: { "@type": "PriceSpecification", minPrice: "800", maxPrice: "1500", priceCurrency: "USD" },
    });
  });

  it("reads a single starting price, and only the first amount", () => {
    expect(offerPriceFields("From $160")).toEqual({ price: "160" });
    expect(offerPriceFields("$1,200")).toEqual({ price: "1200" });
    expect(offerPriceFields("From $25 installed (select 12-inch; most $40-80)")).toEqual({ price: "25" });
  });

  it("yields no Offer for a display without a dollar amount", () => {
    expect(offerPriceFields("Free estimate")).toBeNull();
    expect(offerPriceFields("FREE check")).toBeNull();
    expect(offerPriceFields("4 providers")).toBeNull();
  });

  it("drops the /warranties tier the old digit-strip published as a $1290 Offer", () => {
    // prerendered/warranties/index.html, 2026-10-01: "@type":"Offer","price":"1290"
    // for "Parts & Labor Warranty Information".
    expect("12-Mo Parts / 90-Day Labor".replace(/[^0-9.]/g, "")).toBe("1290");
    expect(offerPriceFields("12-Mo Parts / 90-Day Labor")).toBeNull();
  });
});
