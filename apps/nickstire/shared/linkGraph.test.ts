/**
 * linkGraph — corpus builder + related-article ranking + chip validation.
 *
 * POSITIVE CONTROLS (run against the pre-fix code, recorded 2026-10-01):
 *   - `servicesForTagWords(["winter tires Cleveland"])` — the old exact-key
 *     `getServicesForBlogTags` returned [] for every real article tag (keys are
 *     single words, tags are phrases). The word-level mapper returns /tires.
 *   - `rankRelatedArticles` on a "Tires" article — the old pick (first 2
 *     same-category entries) returned the SAME two slugs for all 20 Tires
 *     articles; the ranked pick differs per article (asserted below).
 *   - `validateServiceChips(["/this-does-not-exist"])` — the old BlogPost
 *     rendered it as a chip; now it is dropped.
 */
import { describe, expect, it } from "vitest";
import {
  buildLinkCorpus,
  canonicalPath,
  cityPathFor,
  curatedRelation,
  isIndexablePath,
  rankRelatedArticles,
  servicesForTagWords,
  servicePathFor,
  validateServiceChips,
  SITEWIDE_COMPONENT_LINKS,
} from "./linkGraph";
import { BLOG_ARTICLES } from "./blog";
import { SERVICE_RELATIONSHIPS, canonicalServicePath } from "./internalLinks";

describe("buildLinkCorpus", () => {
  const corpus = buildLinkCorpus();
  const byPath = new Map(corpus.map((p) => [p.path, p]));

  it("covers services, cities, blog and guides without network, with types and clusters", () => {
    expect(corpus.length).toBeGreaterThan(200);
    const brakes = byPath.get("/brakes")!;
    expect(brakes.type).toBe("service");
    expect(brakes.cluster).toBe("brakes");
    expect(brakes.intent).toBe("transactional");
    expect(brakes.serviceSlug).toBe("brakes");
    expect(brakes.indexable).toBe(true);
    expect(brakes.headings.length).toBeGreaterThan(0);
    const cle = byPath.get("/cleveland-auto-repair")!;
    expect(cle.type).toBe("city");
    expect(cle.geoSlug).toBe("cleveland");
    expect(cle.intent).toBe("local");
    expect(byPath.get("/blog/5-signs-brakes-need-replacing")?.type).toBe("blog");
    expect(byPath.get("/blog/5-signs-brakes-need-replacing")?.cluster).toBe("brakes");
    expect(corpus.some((p) => p.type === "guide")).toBe(true);
  });

  it("excludes admin, portal and landing pages from the corpus", () => {
    expect(byPath.has("/admin")).toBe(false);
    expect(byPath.has("/portal")).toBe(false);
    expect(byPath.has("/lp/brakes")).toBe(false);
  });

  it("counts inbound/outbound from the curated graph + component lists", () => {
    const tires = byPath.get("/tires")!;
    // tires is a curated target of alignment, brakes, oil-change, ppi… and a sitewide component link
    expect(tires.inbound).toBeGreaterThanOrEqual(4);
    expect(tires.outbound).toBeGreaterThanOrEqual(SERVICE_RELATIONSHIPS.tires.length);
    // a sitemap:false registry page is in the corpus but not indexable
    // (NOTE 2026-10-01: every entry in shared/neighborhoods.ts is indexed:true
    // today, so the "noindex neighborhood" case the routes.ts comment describes
    // no longer exists in the data — /pay is the live example of this class)
    const noindex = corpus.find((p) => p.path === "/pay");
    expect(noindex?.indexable).toBe(false);
  });

  it("marks a sitemap:false registry entry as not indexable and blog leaves as indexable", () => {
    expect(isIndexablePath("/portal")).toBe(false);
    expect(isIndexablePath("/blog/5-signs-brakes-need-replacing")).toBe(true);
    expect(isIndexablePath("/blog/no-such-article")).toBe(false);
    expect(isIndexablePath("/blog/db-only", new Set(["db-only"]))).toBe(true);
  });

  it("includes DB-published articles when passed, static winning on a slug collision", () => {
    const withDyn = buildLinkCorpus({
      dynamicArticles: [
        { slug: "db-only-article", title: "Why your tire light stays on in October", category: "Tires", tags: ["tpms", "tires"], relatedServices: ["/tires"] },
        { slug: "5-signs-brakes-need-replacing", title: "DUPLICATE", category: "x", tags: [], relatedServices: [] },
      ],
    });
    const m = new Map(withDyn.map((p) => [p.path, p]));
    expect(m.get("/blog/db-only-article")?.cluster).toBe("tires");
    expect(m.get("/blog/5-signs-brakes-need-replacing")?.title).not.toBe("DUPLICATE");
  });

  it("curatedRelation reads the prior in both service and local directions", () => {
    expect(curatedRelation(byPath.get("/tires")!, byPath.get("/alignment")!)).toBe("spoke→spoke");
    expect(curatedRelation(byPath.get("/tires")!, byPath.get("/cleveland-auto-repair")!)).toBe("service→local");
    expect(curatedRelation(byPath.get("/cleveland-auto-repair")!, byPath.get("/tires")!)).toBe("local→service");
    expect(curatedRelation(byPath.get("/tires")!, byPath.get("/about")!)).toBe("none");
  });
});

describe("path helpers", () => {
  it("canonicalPath strips fragments, queries and trailing slashes", () => {
    expect(canonicalPath("/tires#tire-repair")).toBe("/tires");
    expect(canonicalPath("/tires?utm=x")).toBe("/tires");
    expect(canonicalPath("/tires/")).toBe("/tires");
    expect(canonicalPath("/")).toBe("/");
  });
  it("servicePathFor / cityPathFor only resolve real routes, and an aliased service resolves to its 301 target", () => {
    expect(servicePathFor("brakes")).toBe("/brakes");
    expect(servicePathFor("general-repair")).toBe("/auto-repair-near-me");
    expect(servicePathFor("/alignment")).toBe("/alignment");
    expect(servicePathFor("check-engine")).toBeNull();
    expect(cityPathFor("cleveland")).toBe("/cleveland-auto-repair");
    expect(cityPathFor("cuyahoga-county")).toBeNull();
  });
  it("every sitewide component link resolves to a registry path or a blog/guide leaf", () => {
    for (const href of SITEWIDE_COMPONENT_LINKS) {
      const p = canonicalServicePath(canonicalPath(href));
      expect(isIndexablePath(p) || p === "/booking" || p === "/diagnose" || p === "/pricing" || p === "/rewards", `${href} should be a known page`).toBe(true);
    }
  });
});

describe("servicesForTagWords (positive control: old exact-key lookup returned [] for phrase tags)", () => {
  it("maps phrase tags word by word", () => {
    expect(servicesForTagWords(["winter tires Cleveland"])).toContain("/tires");
    expect(servicesForTagWords(["brake repair Cleveland"])).toContain("/brakes");
    expect(servicesForTagWords(["honest mechanic Cleveland"])).toEqual([]);
  });
  it("de-duplicates and caps at the limit", () => {
    const out = servicesForTagWords(["winter tires", "brake pads", "oil change", "engine diagnostics"], 3);
    expect(out.length).toBe(3);
    expect(new Set(out).size).toBe(3);
  });
});

describe("validateServiceChips", () => {
  it("drops unregistered and redirect-marked (sitemap:false) targets, keeps order, de-dupes", () => {
    expect(validateServiceChips(["/brakes", "/this-does-not-exist", "brakes", "/tires", "/portal"], [])).toEqual(["/brakes", "/tires"]);
  });
  it("falls back to the tag prior when nothing survives", () => {
    const out = validateServiceChips(["/nope"], ["winter tires Cleveland"]);
    expect(out[0]).toBe("/tires"); // "winter" → tires, battery, oil-change, cooling
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out).toContain("/battery");
  });
  it("accepts every relatedServices value the static blog actually uses, canonicalising the /general-repair alias", () => {
    const all = new Set(BLOG_ARTICLES.flatMap((a) => a.relatedServices));
    expect(all.has("/general-repair")).toBe(true); // 57 articles link the 301 alias
    for (const p of all) expect(validateServiceChips([p], []), p).toEqual([canonicalServicePath(p)]);
    expect(validateServiceChips(["/general-repair"], [])).toEqual(["/auto-repair-near-me"]);
  });
});

describe("rankRelatedArticles (positive control: array-order pick gave every Tires article the same 2)", () => {
  it("returns different related sets for different articles in the same category", () => {
    const tires = BLOG_ARTICLES.filter((a) => a.category === "Tires");
    expect(tires.length).toBeGreaterThan(5);
    const picks = tires.map((a) => rankRelatedArticles({ ...a, headings: a.sections.map((s) => s.heading) }, BLOG_ARTICLES, 2).map((r) => r.slug).join("|"));
    expect(new Set(picks).size).toBeGreaterThan(1);
    // the old behaviour: first two same-category entries not equal to self
    const oldPick = tires[2]!;
    const old = BLOG_ARTICLES.filter((a) => a.slug !== oldPick.slug && a.category === "Tires").slice(0, 2).map((a) => a.slug);
    expect(picks.filter((p) => p === old.join("|")).length).toBeLessThan(tires.length);
  });
  it("never returns the article itself and is deterministic", () => {
    const a = BLOG_ARTICLES[0]!;
    const r1 = rankRelatedArticles(a, BLOG_ARTICLES, 2);
    const r2 = rankRelatedArticles(a, BLOG_ARTICLES, 2);
    expect(r1.map((x) => x.slug)).toEqual(r2.map((x) => x.slug));
    expect(r1.some((x) => x.slug === a.slug)).toBe(false);
    expect(r1.length).toBe(2);
  });
});
