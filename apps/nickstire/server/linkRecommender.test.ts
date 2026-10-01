/**
 * linkRecommender — scoring, validation, anchors, rendered-truth check.
 *
 * POSITIVE CONTROLS, each asserted as a pair (signal present → effect; signal
 * absent → no effect) so a scorer that ignores a term cannot pass:
 *   - redirected target (`/euclid-ohio` is in REDIRECTS) → rejected "redirected"
 *   - noindex target (far-suburb neighborhood) → rejected "noindex"
 *   - orphan money page → W_GRAPH_NEED boost vs the same page with inbound=3
 *   - cannibalizing pair → P_CANNIBALIZATION penalty vs no GSC
 *   - anchors never repeat across one page's recommendations
 *   - verifyRenderedLinks: a present href on a real snapshot, a missing one, null for no snapshot
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLinkCorpus, type PageFeatures } from "@shared/linkGraph";
import { SERVICE_PATH_ALIASES } from "@shared/internalLinks";
import { isRedirectedPath } from "./_core/redirects";
import {
  P_CANNIBALIZATION,
  W_GRAPH_NEED,
  anchorsFor,
  isDescriptiveAnchor,
  pairKey,
  recommendLinks,
  scorePair,
  validateTarget,
  verifyRenderedLinks,
} from "./services/linkRecommender";

const corpus = buildLinkCorpus();
const byPath = new Map(corpus.map((p) => [p.path, p]));
const get = (p: string): PageFeatures => {
  const f = byPath.get(p);
  if (!f) throw new Error(`corpus missing ${p}`);
  return f;
};

describe("validateTarget", () => {
  it("rejects a redirected path even though the slug looks like a page", () => {
    expect(validateTarget("/euclid-ohio", byPath)).toBe("redirected");
  });
  it("rejects an unregistered path and a noindex page; accepts a service and a blog leaf", () => {
    expect(validateTarget("/definitely-not-a-page", byPath)).toBe("not-in-registry");
    // /pay is registered with sitemap:false (every neighborhood is indexed:true as of 2026-10-01)
    expect(validateTarget("/pay", byPath)).toBe("noindex");
    const synthetic = new Map(byPath);
    synthetic.set("/brakes", { ...get("/brakes"), indexable: false });
    expect(validateTarget("/brakes", synthetic)).toBe("noindex");
    expect(validateTarget("/brakes", byPath)).toBeNull();
    expect(validateTarget("/blog/5-signs-brakes-need-replacing", byPath)).toBeNull();
    expect(validateTarget("/brakes#section", byPath)).toBeNull();
  });
});

describe("SERVICE_PATH_ALIASES mirrors server/_core/redirects.ts", () => {
  it("every alias key is a redirect source and every target is a final, indexable route", () => {
    for (const [slug, target] of Object.entries(SERVICE_PATH_ALIASES)) {
      expect(isRedirectedPath(`/${slug}`), slug).toBe(true);
      expect(isRedirectedPath(target), target).toBe(false);
      expect(validateTarget(target, byPath), target).toBeNull();
    }
    // and the corpus never recommends the alias itself
    expect(validateTarget("/general-repair", byPath)).toBe("redirected");
    expect(get("/auto-repair-near-me").serviceSlug).toBe("general-repair");
  });
});

describe("scorePair signals (positive controls)", () => {
  it("an orphan money page gets the graph-need boost; the same page with inbound links does not", () => {
    const src = get("/blog/5-signs-brakes-need-replacing");
    const orphan: PageFeatures = { ...get("/brakes"), inbound: 0 };
    const linked: PageFeatures = { ...get("/brakes"), inbound: 3 };
    const a = scorePair(src, orphan, null, new Set());
    const b = scorePair(src, linked, null, new Set());
    expect(a.score - b.score).toBe(W_GRAPH_NEED);
    expect(a.why.join(" ")).toContain("graph need");
    expect(b.why.join(" ")).not.toContain("graph need");
  });

  it("a cannibalizing pair is penalised exactly P_CANNIBALIZATION", () => {
    const src = get("/tires");
    const tgt = get("/used-tires-cleveland");
    const gsc = { pages: new Map(), cannibalPairs: new Set([pairKey("/tires", "/used-tires-cleveland")]) };
    const without = scorePair(src, tgt, null, new Set());
    const withPen = scorePair(src, tgt, gsc, new Set());
    expect(without.score - withPen.score).toBe(P_CANNIBALIZATION);
    expect(withPen.why).toContain("cannibalization penalty");
  });

  it("a GSC opportunity (impressions, low CTR) adds the opportunity term", () => {
    const src = get("/blog/5-signs-brakes-need-replacing");
    const tgt = get("/brakes");
    const gsc = { pages: new Map([["/brakes", { impressions: 900, ctr: 0.8, position: 11 }]]), cannibalPairs: new Set<string>() };
    const plain = scorePair(src, tgt, null, new Set());
    const opp = scorePair(src, tgt, gsc, new Set());
    expect(opp.score).toBeGreaterThan(plain.score);
    expect(opp.why.join(" ")).toContain("gsc opportunity");
  });

  it("geo mismatch between two city pages is penalised; the curated prior rewards service→service", () => {
    const cle = get("/cleveland-auto-repair");
    const parma = get("/parma-auto-repair");
    const mismatch = scorePair(cle, parma, null, new Set());
    expect(mismatch.why).toContain("geo mismatch");
    const curated = scorePair(get("/tires"), get("/alignment"), null, new Set());
    expect(curated.why.join(" ")).toContain("curated prior");
    expect(curated.role).toBe("spoke→spoke");
  });
});

describe("recommendLinks", () => {
  it("returns PROMPT-PACK §10 shaped records with 3 descriptive, non-repeating anchors", () => {
    const { recommendations, rejected } = recommendLinks({ sourcePath: "/blog/5-signs-brakes-need-replacing", corpus, max: 5 });
    expect(recommendations.length).toBe(5);
    const seen = new Set<string>();
    for (const r of recommendations) {
      expect(r.source).toBe("/blog/5-signs-brakes-need-replacing");
      expect(r.anchors).toHaveLength(3);
      expect(r.why.length).toBeGreaterThan(0);
      expect(r.insertionHint.length).toBeGreaterThan(0);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      for (const a of r.anchors) {
        expect(isDescriptiveAnchor(a), a).toBe(true);
        expect(seen.has(a.toLowerCase()), `anchor repeated: ${a}`).toBe(false);
        seen.add(a.toLowerCase());
      }
    }
    // every redirected registry alias is rejected, never recommended
    expect(recommendations.some((r) => r.target === "/euclid-ohio")).toBe(false);
    expect(rejected.some((r) => r.reason === "redirected")).toBe(true);
    // the brakes article's top pick is the brakes money page (semantic + curated + business value)
    expect(recommendations[0]!.target).toBe("/brakes");
  });

  it("rejects targets already linked from the source and a same-cluster cannibal pair", () => {
    const gsc = { pages: new Map(), cannibalPairs: new Set([pairKey("/tires", "/used-tires-cleveland")]) };
    const { recommendations, rejected } = recommendLinks({ sourcePath: "/tires", corpus, gsc, existingOutbound: ["/brakes#x"], max: 10 });
    expect(recommendations.some((r) => r.target === "/brakes")).toBe(false);
    expect(rejected.find((r) => r.targetPath === "/brakes")?.reason).toBe("already-linked");
    expect(rejected.find((r) => r.targetPath === "/used-tires-cleveland")?.reason).toBe("same-cluster-cannibalization");
  });

  it("unknown source → empty with a reason, never a throw", () => {
    const r = recommendLinks({ sourcePath: "/nope", corpus });
    expect(r.recommendations).toEqual([]);
    expect(r.rejected[0]?.reason).toBe("source-not-in-corpus");
  });
});

describe("anchors", () => {
  it("rejects 'click here' and >8 words; anchorsFor avoids taken anchors", () => {
    expect(isDescriptiveAnchor("click here")).toBe(false);
    expect(isDescriptiveAnchor("one two three four five six seven eight nine")).toBe(false);
    expect(isDescriptiveAnchor("brake repair in Cleveland")).toBe(true);
    const first = anchorsFor(get("/brakes"), new Set());
    const second = anchorsFor(get("/brakes"), new Set(first.map((a) => a.toLowerCase())));
    for (const a of second) expect(first.map((x) => x.toLowerCase())).not.toContain(a.toLowerCase());
  });
});

describe("verifyRenderedLinks (advisory rendered-truth check)", () => {
  it("reads prerendered/<path>/index.html and reports present vs missing; null when no snapshot", () => {
    const root = mkdtempSync(path.join(tmpdir(), "prerender-"));
    mkdirSync(path.join(root, "brakes"), { recursive: true });
    writeFileSync(path.join(root, "brakes", "index.html"), '<html><body><a class="x" href="/tires#tire-repair">t</a><a href="/alignment">a</a></body></html>');
    const r = verifyRenderedLinks("/brakes", ["/tires", "/alignment", "/oil-change"], root);
    expect(r.snapshotFound).toBe(true);
    expect(r.present).toEqual(["/tires", "/alignment"]);
    expect(r.missing).toEqual(["/oil-change"]);
    const none = verifyRenderedLinks("/no-snapshot", ["/tires"], root);
    expect(none.snapshotFound).toBeNull();
    expect(none.missing).toEqual(["/tires"]);
  });

  it("against the COMMITTED tree: /brakes links to /tires today (positive control for the regex)", () => {
    const r = verifyRenderedLinks("/brakes", ["/tires"]);
    // The committed snapshot may be absent in a sparse checkout — null is allowed, false is not.
    if (r.snapshotFound) expect(r.present).toEqual(["/tires"]);
    else expect(r.snapshotFound).toBeNull();
  });
});
