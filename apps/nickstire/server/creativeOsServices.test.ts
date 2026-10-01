/**
 * Creative OS services (Wave C): organic evidence, atomizer, pattern miner,
 * trend intel. Pure parts tested directly; DB/LLM parts through honest
 * failure shapes.
 *
 * POSITIVE CONTROLS recorded 2026-10-01: before these modules existed the ads
 * architect received no organic evidence at all (grep: zero readers of
 * social_content_inventory metrics outside Learn.tsx), there was no
 * thesis→derivative plan, no mined-pattern originality gate, no trend
 * classifier. Each `rejects` / `skip` case below is the behaviour the old
 * absence could not provide.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/db-helper", () => ({
  db: async () => { throw new Error("tidb unreachable (test)"); },
  dbTyped: async () => null,
  requireDb: async () => { throw new Error("tidb unreachable (test)"); },
}));

import { buildOrganicEvidence, rankOrganicRows, renderOrganicEvidenceBlock } from "./services/organicEvidence";
import { planAtomization, thesisIdFor } from "./services/contentAtomizer";
import { validateMinedPattern, toReelPattern, parseDna, type CreativeDna, type ExternalPostInput } from "./services/creativePatternMiner";
import { classifyTrend } from "./services/trendIntel";
import type { CreativeGenome } from "../client/src/lib/creativeGenome";

const row = (o: Partial<Parameters<typeof rankOrganicRows>[0][number]>) => ({
  id: 1, topic: "brakes", hookCategory: "customer_quote", hookText: "it only grinds in the morning", contentType: "reel", platform: "instagram",
  metricsReach: 1000, metricsShares: 20, metricsSaves: 10, metricsComments: 2, publishedAt: new Date("2026-09-20T12:00:00Z"), ...o,
});

describe("organicEvidence", () => {
  it("ranks by sends+saves per reach, excludes zero-reach rows from ratios, groups hook categories", () => {
    const ev = rankOrganicRows([
      row({ id: 1, metricsReach: 1000, metricsShares: 50, metricsSaves: 30 }),
      row({ id: 2, topic: "tires", hookCategory: "myth", metricsReach: 2000, metricsShares: 10, metricsSaves: 10 }),
      row({ id: 3, topic: "oil", hookCategory: "offer", metricsReach: 0, metricsShares: 0, metricsSaves: 0 }),
    ], { windowDays: 90, limit: 8 });
    expect(ev.sampled).toBe(3);
    expect(ev.measured).toBe(2);
    expect(ev.theses.map((t) => t.inventoryId)).toEqual([1, 2]);
    expect(ev.theses[0].sharesPerReach).toBe(0.05);
    expect(ev.winningHookCategories[0].hookCategory).toBe("customer_quote");
    expect(ev.topicsByFormat.find((t) => t.topic === "brakes")?.bestFormat).toBe("reel");
    const block = renderOrganicEvidenceBlock(ev);
    expect(block).toMatch(/NOT ad-conversion evidence/);
    expect(block).toContain("it only grinds in the morning");
  });
  it("a DB failure is reported as unavailable — never an empty 'nothing worked'", async () => {
    const ev = await buildOrganicEvidence();
    expect(ev.error).toMatch(/tidb unreachable/);
    expect(renderOrganicEvidenceBlock(ev)).toMatch(/unavailable/);
    expect(renderOrganicEvidenceBlock({ ...ev, error: undefined, sampled: 4, measured: 0 })).toMatch(/none with reach yet/);
  });
});

const genome: CreativeGenome = {
  version: 1,
  objective: "share",
  audienceMoment: "the steering wheel shakes at 60 but is fine around town",
  driverTension: "is this dangerous and is it expensive",
  mechanicTruth: "a speed-sensitive shake is usually balance or a bent wheel; alignment shows as pull and wear, not one magic speed",
  proprietaryProof: ["media:bent-wheel-0912"],
  emotionalTurn: "anxiety to understanding",
  visualMetaphor: "the wheel is a clue, not a diagnosis",
  creativeTerritory: "csi_evidence_board",
  clevelandAngle: "pothole season on Euclid Ave",
  nickSignature: "we show the balancer readout, not a guess",
  desiredAction: "send to the driver who keeps describing this",
};

describe("contentAtomizer.planAtomization", () => {
  it("branches one thesis into format-native derivatives with distinct grammars and a stable thesisId", () => {
    const plan = planAtomization(genome, { realAssetAvailable: true, commercialIntent: true, durationLanes: ["18-24", "30-40"] });
    const formats = plan.derivatives.map((d) => d.format);
    expect(formats).toEqual(expect.arrayContaining(["reel_short", "reel_long", "carousel", "static", "story", "fb_status", "fb_album", "article", "faq", "ad"]));
    expect(new Set(plan.derivatives.map((d) => d.grammar)).size).toBeGreaterThanOrEqual(8);
    expect(plan.thesisId).toBe(thesisIdFor(genome));
    expect(planAtomization({ ...genome, desiredAction: "different cta" }).thesisId).toBe(plan.thesisId);
    for (const d of plan.derivatives) expect(d.rationale.length).toBeGreaterThan(10);
  });
  it("skips fb_album without real photos, ad without commercial intent, article when one exists — with reasons", () => {
    const plan = planAtomization(genome, { realAssetAvailable: false, commercialIntent: false, hasArticle: true });
    const formats = plan.derivatives.map((d) => d.format);
    expect(formats).not.toContain("fb_album");
    expect(formats).not.toContain("ad");
    expect(formats).not.toContain("article");
    expect(plan.skipped.map((s) => s.format).sort()).toEqual(["ad", "article", "fb_album"]);
    expect(plan.skipped.find((s) => s.format === "article")?.reason).toMatch(/scaled-content/);
  });
});

const dna: CreativeDna = {
  patternName: "forensic_closeup_reveal",
  hookGrammar: "open on an unexplained damaged object",
  exactAudienceTension: "what happened to this part and could it be mine",
  knowledgeGap: "symptom mistaken for cause",
  emotionalTrigger: "curiosity",
  curiosityMechanism: "the damage is shown before the explanation",
  openingVisual: "extreme macro of a worn surface",
  storyShape: "evidence to investigation to root cause",
  beatCount: 5,
  avgShotSeconds: 3.5,
  cameraLanguage: "locked macro then slow push",
  visualMetaphor: "a crime scene",
  demonstrationMethod: "point to the physical clue",
  proofType: "real part",
  narrationStyle: "calm voiceover",
  captionStyle: "upper third headline",
  ctaStyle: "send to someone",
  soundStrategy: "minimal pulse",
  commentTrigger: "ask what caused it",
  sendTrigger: "friend with the same symptom",
  saveTrigger: "checklist of clues",
  trendDependency: "none",
  evergreenPotential: "high",
  productionDifficulty: "low",
  likelyWhyItWorks: "information gap plus visible evidence",
  possibleFailureMode: "payoff too slow",
  nickApplicability: 5,
  nickAdaptationInputs: ["real rotor photo", "customer phrase"],
  hookType: "forensic_scan",
  loopType: "problem_loop",
};
const post: ExternalPostInput = {
  creator: "@somecreator",
  url: "https://example.com/p/1",
  date: "2026-09-01",
  format: "reel",
  durationSeconds: 22,
  transcript: "look at this rotor what do you think happened here it was grinding every morning and the customer thought it was the pads",
  caption: "Grinding every morning? It was not the pads.",
};

describe("creativePatternMiner originality gate", () => {
  it("accepts an abstract primitive and keeps provenance separate from the pattern", () => {
    expect(validateMinedPattern(dna, post)).toEqual([]);
    const rec = toReelPattern(dna, post, new Date("2026-10-01T00:00:00Z"));
    expect(rec.id).toBe("rp_mined_forensic_closeup_reveal");
    expect(rec.label).not.toMatch(/somecreator/);
    expect(rec.sourceLabel).toContain("@somecreator");
    expect(rec.provenance.url).toBe(post.url);
    expect(rec.hookType).toBe("forensic_scan");
    expect(rec.pacing.totalSeconds).toBe(22);
  });
  it("rejects verbatim lifts and creator-named pattern ids", () => {
    const lifted = { ...dna, sendTrigger: "grinding every morning it was not the pads the customer thought" };
    const f1 = validateMinedPattern(lifted, post);
    expect(f1.some((f) => f.field === "sendTrigger" && /verbatim/.test(f.reason))).toBe(true);
    const named = { ...dna, patternName: "somecreator_style_reveal" };
    expect(validateMinedPattern(named, post).some((f) => f.field === "patternName")).toBe(true);
  });
  it("parseDna rejects an unknown hookType and strips fences", () => {
    const good = parseDna("```json\n" + JSON.stringify(dna) + "\n```");
    expect(good.patternName).toBe(dna.patternName);
    expect(() => parseDna(JSON.stringify({ ...dna, hookType: "copy_the_creator" }))).toThrow();
  });
});

describe("trendIntel.classifyTrend", () => {
  const now = new Date("2026-10-01T12:00:00Z").getTime();
  it("uses a fresh NWS freeze warning (maps to tires/battery, observable truth)", () => {
    const v = classifyTrend({ source: "nws", text: "Freeze warning tonight, lake-effect snow by morning", firstSeen: "2026-10-01T06:00:00Z" }, now);
    expect(v.verdict).toBe("use");
    expect(v.nickRelevance).toBeGreaterThanOrEqual(2);
    expect(v.feasibility).toBe("deterministic");
  });
  it("never recommends audio without a licence note, nor formats that need others' graphics", () => {
    expect(classifyTrend({ source: "audio", text: "trending pothole sound", firstSeen: "2026-10-01" }, now).verdict).toBe("skip");
    expect(classifyTrend({ source: "instagram", text: "pothole meme template", requiresOthersGraphics: true }, now).verdict).toBe("skip");
  });
  it("skips irrelevant trends, watches stale relevant ones", () => {
    expect(classifyTrend({ source: "google_trends", text: "celebrity wedding", firstSeen: "2026-10-01" }, now).verdict).toBe("skip");
    expect(classifyTrend({ source: "gsc", text: "e-check not ready", firstSeen: "2026-08-01" }, now).verdict).toBe("watch");
  });
});
