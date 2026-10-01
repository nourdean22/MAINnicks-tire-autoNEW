/**
 * RelatedServices reads the curated graph (`SERVICE_RELATIONSHIPS`) — the same
 * prior the link recommender scores against — and keeps DEFAULT_RELATED only
 * for a service the graph does not know.
 *
 * POSITIVE CONTROL (pre-fix, 2026-10-01): `resolveRelatedSlugs("brakes")` on
 * the old component returned DEFAULT_RELATED.brakes =
 * ["tires","diagnostics","general-repair","alignment"]; the curated order is
 * ["tires","alignment","diagnostics","general-repair"] — the first assertion
 * below failed on the old file.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import RelatedServices, { resolveRelatedSlugs } from "@/components/RelatedServices";
import { SERVICE_RELATIONSHIPS, canonicalServicePath } from "@shared/internalLinks";
import { SERVICES } from "@shared/services";

const CARD_SLUGS = new Set([...SERVICES.map((s) => s.slug), "alignment"]);

describe("resolveRelatedSlugs", () => {
  it("uses the curated graph as the source, in curated order", () => {
    expect(resolveRelatedSlugs("brakes")).toEqual(
      SERVICE_RELATIONSHIPS.brakes.filter((s) => CARD_SLUGS.has(s)).slice(0, 4),
    );
    expect(resolveRelatedSlugs("brakes")).toEqual(["tires", "alignment", "diagnostics", "general-repair"]);
  });

  it("every service with a card renders FOUR curated cards (check-engine has no card and is skipped)", () => {
    for (const slug of CARD_SLUGS) {
      const out = resolveRelatedSlugs(slug);
      expect(out.length, slug).toBe(4);
      expect(out, slug).not.toContain(slug);
      expect(out.every((s) => CARD_SLUGS.has(s)), slug).toBe(true);
      // and every one of them is a curated edge, not a fallback entry
      expect(SERVICE_RELATIONSHIPS[slug], `${slug} missing from curated graph`).toBeDefined();
      for (const s of out) expect(SERVICE_RELATIONSHIPS[slug], `${slug}→${s}`).toContain(s);
    }
  });

  it("falls back to DEFAULT_RELATED / the core four only for a slug the curated graph lacks", () => {
    expect(SERVICE_RELATIONSHIPS["future-service"]).toBeUndefined();
    expect(resolveRelatedSlugs("future-service")).toEqual(["tires", "brakes", "diagnostics", "oil-change"]);
  });

  it("an explicit `related` prop still wins", () => {
    expect(resolveRelatedSlugs("tires", ["brakes", "exhaust"])).toEqual(["brakes", "exhaust"]);
  });
});

describe("<RelatedServices />", () => {
  it("renders the curated graph's cards as links", () => {
    render(<RelatedServices current="tires" />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const s of SERVICE_RELATIONSHIPS.tires) expect(hrefs).toContain(canonicalServicePath(s));
    expect(hrefs).not.toContain("/tires");
    // the general-repair card links the canonical URL, never the 301 alias
    expect(hrefs).toContain("/auto-repair-near-me");
    expect(hrefs).not.toContain("/general-repair");
  });
});
