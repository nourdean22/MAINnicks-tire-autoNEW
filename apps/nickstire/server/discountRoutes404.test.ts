/**
 * /discounts/:slug is a finite set (DISCOUNT_PAGES), every leaf registered in
 * shared/routes.ts. A blanket "/discounts/" dynamic prefix made any slug answer
 * 200 with a soft-404 shell for non-JS crawlers (Codex review on #3352). Real
 * leaves resolve to a page; anything else is a 404.
 */
import { describe, it, expect } from "vitest";
import { resolvePublicPath } from "./_core/spaFallback";
import { DISCOUNT_PAGES } from "@shared/discountPages";

describe("discount routes: real leaves are pages, unknown slugs are 404", () => {
  it("the hub and every audience page resolve to a 200 page", () => {
    for (const path of ["/discounts", ...DISCOUNT_PAGES.map((p) => `/discounts/${p.slug}`)]) {
      expect(resolvePublicPath(path).status, path).toBe(200);
    }
  });

  it("an unknown discount slug is a 404, not a soft 200", () => {
    expect(resolvePublicPath("/discounts/not-a-real-group").status).toBe(404);
    expect(resolvePublicPath("/discounts/military-veterans/extra").status).toBe(404);
  });
});
