import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PRODUCTION_READY_COUNT, angleBankLine, angleBankStatus, parseAngleBank, type AngleBank } from "./angleBank";
import { ORIGINALITY_BLOCK_THRESHOLD, jaccardSimilarity, normalizeForComparison } from "./reelOriginality";
import { APPROVED_REEL_PACK_SLUGS, packBuildsForLane } from "../server/services/approvedReelPackRotation";

const BANK_URL = new URL("../docs/reels-engine-v2/angle-bank.json", import.meta.url);
const PACKS_URL = new URL("../docs/reel-packs/", import.meta.url);
type RawBank = { angles: Record<string, unknown>[] } & Record<string, unknown>;
const raw = () => JSON.parse(readFileSync(BANK_URL, "utf8")) as RawBank;
const bank: AngleBank = parseAngleBank(raw());
const top = bank.angles.slice(0, PRODUCTION_READY_COUNT);
const packDirs = () => readdirSync(PACKS_URL, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(d.name)).map((d) => d.name);

describe("angle bank — the committed inventory", () => {
  it("CONTROL: the committed file parses, with 100 angles, 20 production-ready, 12 stubs, all 15 categories in the top 20", () => {
    expect(bank.angles).toHaveLength(100);
    expect(bank.angles.filter((a) => a.status === "production_ready")).toHaveLength(PRODUCTION_READY_COUNT);
    expect(bank.angles.filter((a) => a.status === "stub")).toHaveLength(12);
    expect(bank.categories).toHaveLength(15);
    expect(new Set(bank.angles.map((a) => a.category)).size).toBe(15);
    expect(new Set(top.map((a) => a.category)).size).toBe(15);
  });

  it("every named pack is one the PRODUCTION builder accepts, and the pilot is the first eight", () => {
    // Not "has beats on disk": buildBriefFromApprovedProductionPack is what the
    // daily lane runs, and it also wants a caption and the normalised beat
    // shape. The first draft of this file counted beats and mis-graded 16
    // entries in one direction and one rotation pack in the other.
    const rejected = bank.angles.filter((a) => a.packSlug !== null && !packBuildsForLane(a.packSlug)).map((a) => `${a.id} → ${a.packSlug}`);
    expect(rejected).toEqual([]);
    expect(top.slice(0, 8).map((a) => a.packSlug)).toEqual([
      "2026-10-08-proof-01-uneven-wear",
      "2026-10-08-proof-02-highway-shake",
      "2026-10-08-proof-03-patch-or-replace",
      "2026-09-25-inner-outer-brake-pad-wear",
      "2026-08-17-pothole-damage",
      "2026-08-19-wont-start-battery-starter-alternator",
      "2026-08-20-echeck-readiness-monitors",
      "2026-08-17-tread-depth-rain-vs-snow",
    ]);
  });

  it("no stub restates a pack that already exists under another name", () => {
    // Angle-vs-angle near-duplicates are refused by parseAngleBank itself
    // (CONTROL above proves the committed file clears it); this is the disk
    // half — a "gap" that an existing pack already covers is not a gap.
    const packWords = packDirs().map((name) => normalizeForComparison(name.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " ")));
    const restated: string[] = [];
    for (const a of bank.angles.filter((x) => x.status === "stub")) {
      const fp = normalizeForComparison(`${a.title} ${a.question}`);
      for (const w of packWords) {
        const s = jaccardSimilarity(fp, w);
        if (s >= ORIGINALITY_BLOCK_THRESHOLD) restated.push(`${a.id} ~ "${w}" ${s.toFixed(2)}`);
      }
    }
    expect(restated).toEqual([]);
  });

  it("ROTATION CANARY: the production-ready packs outside the daily rotation are exactly the three proof packs", () => {
    // They stay out on purpose (ROTATION_EXCLUDED carries the reason) until the
    // real-shop pool holds their shots and the pipeline honours
    // StoryboardBeat.source: appended today, the daily lane would GENERATE
    // the beats their briefs declare REAL — a synthetic shot documenting real
    // work, the one thing the doctrine forbids. Every other builder-accepted
    // pack is already in the rotation (reelPackRotationCoverage.test.ts keeps
    // it so). If this list changes, 09-90-DAY-MODEL.md's handoff must say why.
    const buildablePacks = new Set(packDirs().filter(packBuildsForLane));
    const status = angleBankStatus(bank, { buildablePacks, rotation: new Set(APPROVED_REEL_PACK_SLUGS), publishedPackSlugs: new Set() });
    expect(status.missingPacks).toEqual([]);
    expect(status.withPack).toBe(PRODUCTION_READY_COUNT);
    expect(status.inRotation).toBe(PRODUCTION_READY_COUNT - 3);
    expect(status.nextToApprove).toEqual([
      "2026-10-08-proof-01-uneven-wear",
      "2026-10-08-proof-02-highway-shake",
      "2026-10-08-proof-03-patch-or-replace",
    ]);
  });
});

describe("parseAngleBank — refuses the mutations the production order depends on", () => {
  const mutate = (fn: (angles: Record<string, unknown>[]) => void) => {
    const r = raw();
    fn(r.angles);
    return () => parseAngleBank(r);
  };
  it("a stub that names a pack, and a pack entry without one", () => {
    expect(mutate((a) => { a[99].packSlug = "2026-08-14-penny-test"; })).toThrow(/A100: a stub cannot name a pack/);
    expect(mutate((a) => { a[20].packSlug = null; })).toThrow(/A021: status pack_exists needs a packSlug/);
  });
  it("production_ready outside the first twenty, and a non-ready angle inside them", () => {
    expect(mutate((a) => { a[20].status = "production_ready"; })).toThrow(/A021: production_ready is confined to the first 20/);
    expect(mutate((a) => { a[3].status = "pack_exists"; })).toThrow(/A004: rank 4 must be production_ready/);
  });
  it("feasibility C cannot be production-ready; an unknown category, packet, out-of-order id or double-claimed pack is refused", () => {
    expect(mutate((a) => { a[0].feasibility = "C"; })).toThrow(/A001: production_ready needs feasibility A or B/);
    expect(mutate((a) => { a[0].category = "tyres"; })).toThrow(/A001: unknown category tyres/);
    expect(mutate((a) => { a[0].truthPacket = "alignment"; })).toThrow(/A001: unknown truth packet alignment/);
    expect(mutate((a) => { a[1].id = "A003"; })).toThrow(/A003: id must be A002/);
    expect(mutate((a) => { a[1].packSlug = a[0].packSlug; })).toThrow(/A002: pack 2026-10-08-proof-01-uneven-wear is already claimed/);
  });
  it("two tire-wear angles inside six consecutive production slots are refused, naming the pair and the distance", () => {
    expect(mutate((a) => { a[1].category = "tires-wear-age"; })).toThrow(/A002: shares tires-wear-age with A001 only 1 apart \(minimum 6/);
  });
  it("a near-duplicate angle is refused by the publish door's own word-overlap rule", () => {
    expect(mutate((a) => { a[21].title = a[20].title; a[21].question = a[20].question; })).toThrow(/A022: near-duplicate of A021 \(word overlap 1\.00/);
  });
  it("CONTROL for the two rules above: the committed order and wording pass them", () => {
    expect(() => parseAngleBank(raw())).not.toThrow();
  });
});

describe("angleBankStatus + angleBankLine", () => {
  const facts = (over: Partial<Record<"packs" | "rotation" | "published", string[]>>) => ({
    buildablePacks: new Set(over.packs ?? top.map((a) => a.packSlug!)),
    rotation: new Set(over.rotation ?? []),
    publishedPackSlugs: new Set(over.published ?? []),
  });
  it("counts only the production-ready angles, and prints zeros as zeros", () => {
    const s = angleBankStatus(bank, facts({ rotation: [top[3].packSlug!], published: [top[3].packSlug!] }));
    expect(s).toMatchObject({ total: 100, productionReady: 20, pilot: 8, stubs: 12, withPack: 20, inRotation: 1, published: 1, missingPacks: [] });
    expect(s.nextToApprove).toHaveLength(19);
    expect(angleBankLine(s)).toMatch(/^20 production-ready angles of 100: 20 with a pack, 1 in rotation, 1 published; awaiting rotation approval: proof-01-uneven-wear, /);
  });
  it("a production-ready pack that is missing or rejected is BROKEN, named, and never counted as awaiting approval", () => {
    const s = angleBankStatus(bank, facts({ packs: top.slice(1).map((a) => a.packSlug!) }));
    expect(s.withPack).toBe(19);
    expect(s.missingPacks).toEqual(["2026-10-08-proof-01-uneven-wear"]);
    expect(s.nextToApprove).not.toContain("2026-10-08-proof-01-uneven-wear");
    expect(angleBankLine(s)).toContain("BROKEN entries (pack missing or rejected by the builder): 2026-10-08-proof-01-uneven-wear");
  });
  it("everything in rotation reads as a line with no approval list", () => {
    const s = angleBankStatus(bank, facts({ rotation: top.map((a) => a.packSlug!) }));
    expect(angleBankLine(s)).toBe("20 production-ready angles of 100: 20 with a pack, 20 in rotation, 0 published");
  });
});
