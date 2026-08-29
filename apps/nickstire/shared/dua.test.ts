/**
 * DUA gate canaries.
 *
 * EVERY gate here ships as a PAIR: a concept carrying the defect the gate was
 * written for, asserted to BLOCK with that gate's own code, and a corrected
 * variant asserted to PASS. A gate with only the block half scores green while
 * permanently broken; a gate with only the pass half scores green while blind.
 * `policy.test.mjs` and `lintGateFailClosed.test.ts` are the precedents.
 *
 * Assertions are on BEHAVIOUR — the returned block codes — never on the
 * presence of a rule, a constant, or a docstring. `brand-universe.test.ts`
 * asserting `blockingConditions.length > 0` is exactly the shape this file
 * exists to not repeat: that assertion stayed green for the entire period in
 * which nothing read the field at all.
 *
 * The FALSE-POSITIVE halves matter more than the true-positive halves. These
 * reels are built from impersonal technical numbers and borrowed institutions;
 * a gate that blocks a real courtroom concept blocks the product, which is
 * worse than the defect it fixes.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  runDuaGate,
  runDuaBriefChecks,
  readRelevance,
  probeFrameSwap,
  mechanismTerms,
  buildSwapCorpus,
  unenforceableBlockingConditions,
  detectFabricatedVerdicts,
  detectCustomerHumiliationIn,
  detectSafetyTrivialisationIn,
  DUA_SEED_FACTS,
  DUA_SEED_CORPUS,
  ABSURDITY_BAND,
  ABSURDITY_TYPES,
  ABSURDITY_TYPE_SPECS,
  LAYER_CONTRACT,
  DUA_ROLE_SPECS,
  DUA_ROLES,
  type DuaConcept,
  type DuaBlockCode,
} from "./dua";
import { BRAND_CAST } from "./brandBible";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { runReelPreflight, runReelDuaChecks, buildHiggsfieldReelPromptPack } from "../client/src/lib/facelessReelStudio";

/**
 * A concept that PASSES every gate. Every defect test below is this object with
 * one field changed, so a test can only fail for the reason it names.
 */
function base(over: Partial<DuaConcept> = {}): DuaConcept {
  return {
    id: "dua-test-1",
    franchiseId: "pothole_court",
    absurdityType: "institutional_trial",
    absurdityLevel: 3,
    subject: "part",
    violation: "a tread block is put on trial for losing grip that the shallow water channels had already given up",
    benignResolution: "nothing dramatic happened — the tread simply wore down to where its water channels stop evacuating water",
    usefulFact: "Tread below 2/32 inch loses wet grip because the water channels are too shallow to evacuate water.",
    factSources: ["NHTSA tread depth guidance"],
    factSourceTypes: ["mechanical_consensus"],
    brandConnection: "tread depth checks are a walk-in at the Euclid Avenue shop",
    audienceParticipation: "Sentence this tire: repair, replace, or dismissed?",
    visualMetaphor: "the worn tread stands in the witness box while its shallow water channels are held against a penny",
    audioMetaphor: "a single gavel strike, then the sound of water draining away",
    payoff: "the tread is acquitted — the shallow water channels were the whole case, and a penny reads their grip",
    ...over,
  };
}

const codes = (c: DuaConcept): DuaBlockCode[] => runDuaGate(c).blocking.map((f) => f.code as DuaBlockCode);

describe("the control — a well-formed concept passes every gate", () => {
  it("passes, so every block below is attributable to the one field it changed", () => {
    const report = runDuaGate(base());
    expect(report.blocking).toEqual([]);
    expect(report.status).toBe("pass");
  });

  it("actually ran the swap probe rather than skipping it", () => {
    // A probe that compared nothing would report portable:false and read as
    // clean. `comparedAgainst` is what distinguishes "checked" from "silent".
    expect(runDuaGate(base()).swap.comparedAgainst).toBeGreaterThan(50);
  });
});

// ─── Relevance — the load-bearing gate ─────────────────────────────

describe("RELEVANCE_BELOW_THRESHOLD — the joke must be the mechanism that teaches the fact", () => {
  it("BLOCKS a frame whose own words carry none of the fact's mechanism", () => {
    const decorative = base({
      violation: "a defendant is dragged before a stern tribunal in a wood-panelled room",
      visualMetaphor: "a gavel hangs above a nervous silence as the gallery leans forward",
      payoff: "the verdict lands and the room empties",
    });
    expect(codes(decorative)).toContain("RELEVANCE_BELOW_THRESHOLD");
  });

  it("PASSES the same courtroom frame once it is built out of the fact's own mechanism", () => {
    // Identical archetype, identical tone. The only change is that the frame is
    // now ABOUT the tread and the water channels rather than beside them.
    expect(codes(base())).not.toContain("RELEVANCE_BELOW_THRESHOLD");
  });

  it("needs the mechanism in at least two of the three structural surfaces", () => {
    const oneSurface = base({
      violation: "a defendant is dragged before a stern tribunal",
      payoff: "the verdict lands and the room empties",
    });
    const r = readRelevance(oneSurface);
    expect(r.surfacesCarrying).toBe(1);
    expect(r.relevant).toBe(false);
  });
});

describe("FRAME_PORTABLE — the swap test, run for real", () => {
  it("BLOCKS a frame that fits an unrelated fact as well as its own", () => {
    const generic = base({
      violation: "a defendant stands trial",
      visualMetaphor: "the judge bangs a gavel and the gallery gasps",
      payoff: "the verdict is read aloud",
    });
    expect(codes(generic)).toContain("FRAME_PORTABLE");
  });

  it("PASSES a frame that only fits its own fact", () => {
    expect(codes(base())).not.toContain("FRAME_PORTABLE");
  });

  it("scores the specific frame strictly above the best unrelated fact", () => {
    const probe = probeFrameSwap(base());
    expect(probe.ownScore).toBeGreaterThan(probe.bestForeignScore);
    expect(probe.portable).toBe(false);
  });

  it("reports an empty corpus as zero comparisons rather than as clean", () => {
    // The failure mode this pins: a probe that silently passes because it had
    // nothing to compare against would be a gate that never runs.
    const probe = probeFrameSwap(base(), buildSwapCorpus([]));
    expect(probe.comparedAgainst).toBe(0);
    expect(probe.portable).toBe(false);
  });

  it("weights rare mechanism terms above generic connective ones", () => {
    // This is WHY the probe works. Raw coverage ratios reported PORTABLE on 6
    // of 6 genuinely-relevant authored concepts before weighting was added.
    expect(DUA_SEED_CORPUS.weight("sidewall")).toBeGreaterThan(DUA_SEED_CORPUS.weight("point"));
    expect(DUA_SEED_CORPUS.weight("point")).toBeLessThan(DUA_SEED_CORPUS.weight("hygroscopic"));
  });
});

// ─── Hard fail: fabricated evidence ────────────────────────────────

describe("FABRICATED_EVIDENCE — absurd about the presentation, never about the truth", () => {
  it("BLOCKS a measurement the sourced fact never carried", () => {
    expect(codes(base({ payoff: "the tread is convicted at 7/32 inch and led away" }))).toContain("FABRICATED_EVIDENCE");
  });

  it("PASSES a measurement the sourced fact does carry", () => {
    expect(codes(base({ payoff: "the tread is acquitted above 2/32 inch, where the water channels still evacuate water" })))
      .not.toContain("FABRICATED_EVIDENCE");
  });

  it("BLOCKS a claim that a test returned a result", () => {
    expect(codes(base({ visualMetaphor: "the lab confirms the tread water channels failed, shown in macro" })))
      .toContain("FABRICATED_EVIDENCE");
  });

  it("PASSES a lab or courtroom frame that only STAGES the examination", () => {
    expect(codes(base({ visualMetaphor: "the lab examines the tread water channels under a shallow raking light" })))
      .not.toContain("FABRICATED_EVIDENCE");
  });
});

// ─── Hard fail: the customer is never the butt ─────────────────────

describe("CUSTOMER_HUMILIATED — the machine is the character", () => {
  it("BLOCKS a concept aimed at the customer", () => {
    expect(codes(base({ subject: "customer" }))).toContain("CUSTOMER_HUMILIATED");
  });

  it("BLOCKS a joke that lands on the driver", () => {
    expect(codes(base({ payoff: "the tread is acquitted; the owner was too cheap to check the water channels" })))
      .toContain("CUSTOMER_HUMILIATED");
  });

  it.each([
    "the driver never noticed the tread water channels going shallow — most people do not",
    "you can read your own tread water channels with a penny in ten seconds",
    "a driver asked us about shallow tread water channels this week",
  ])("PASSES a neutral mention of the driver: %s", (payoff) => {
    expect(codes(base({ payoff }))).not.toContain("CUSTOMER_HUMILIATED");
  });
});

// ─── Hard fail: safety is never trivialised ────────────────────────

describe("SAFETY_TRIVIALISED — the frame may be absurd, the consequence may not be waved off", () => {
  const brakeLine = (over: Partial<DuaConcept> = {}) =>
    base({
      usefulFact: "Road salt corrodes brake lines from the outside in, and a corroded brake line can fail under pressure.",
      violation: "a corroded brake line is charged with keeping quiet about what road salt did to it",
      visualMetaphor: "the brake line lies under evidence light, salt corrosion mapped along its length",
      payoff: "the brake line kept its corrosion hidden until the pressure found it",
      benignResolution: "the corrosion is visible from underneath, so a salt-season look at the brake line catches it early",
      ...over,
    });

  it("BLOCKS a safety mechanism resolved by doing nothing", () => {
    expect(codes(brakeLine({ benignResolution: "a corroded brake line is no big deal, just drive it until spring" })))
      .toContain("SAFETY_TRIVIALISED");
  });

  it("PASSES the same safety topic resolved by a check", () => {
    expect(codes(brakeLine())).not.toContain("SAFETY_TRIVIALISED");
  });

  it("does not fire on a benign resolution that simply says the situation is fine", () => {
    // "it's fine" and "whatever" were in the first trivialiser bank and had to
    // come out: saying the situation is harmless is a benign resolution's job.
    expect(codes(base({ benignResolution: "it's fine — the tread water channels wore down slowly and evenly" })))
      .not.toContain("SAFETY_TRIVIALISED");
  });
});

// ─── The fact itself ───────────────────────────────────────────────

describe("FACT_ABSENT / FACT_UNVERIFIED — an absurd frame with nothing to teach", () => {
  it("BLOCKS an empty useful fact", () => {
    expect(codes(base({ usefulFact: "   " }))).toContain("FACT_ABSENT");
  });

  it("BLOCKS an unsourced fact", () => {
    expect(codes(base({ factSources: [] }))).toContain("FACT_UNVERIFIED");
  });

  it("BLOCKS a source list of blank strings rather than counting them", () => {
    expect(codes(base({ factSources: ["", "  "] }))).toContain("FACT_UNVERIFIED");
  });

  it("PASSES a sourced fact", () => {
    const c = codes(base());
    expect(c).not.toContain("FACT_ABSENT");
    expect(c).not.toContain("FACT_UNVERIFIED");
  });
});

// ─── The dial ──────────────────────────────────────────────────────

describe("ABSURDITY_LEVEL_UNCAPPED — 2-4 by default, 5 by explicit opt-in", () => {
  it("BLOCKS level 5 without an opt-in", () => {
    expect(codes(base({ absurdityLevel: 5 }))).toContain("ABSURDITY_LEVEL_UNCAPPED");
  });

  it("PASSES level 5 with an explicit opt-in", () => {
    expect(codes(base({ absurdityLevel: 5, levelOptIn: true }))).not.toContain("ABSURDITY_LEVEL_UNCAPPED");
  });

  it.each([2, 3, 4] as const)("PASSES level %i, inside the working band", (absurdityLevel) => {
    expect(codes(base({ absurdityLevel }))).not.toContain("ABSURDITY_LEVEL_UNCAPPED");
  });

  it("WARNS rather than blocks below the band", () => {
    const report = runDuaGate(base({ absurdityLevel: 1 }));
    expect(report.blocking.map((f) => f.code)).not.toContain("ABSURDITY_LEVEL_UNCAPPED");
    expect(report.findings.map((f) => f.code)).toContain("ABSURDITY_BELOW_BAND");
  });

  it("caps at 4 and ceilings at 5", () => {
    expect(ABSURDITY_BAND.max).toBe(4);
    expect(ABSURDITY_BAND.ceiling).toBe(5);
  });
});

// ─── Layer boundary ────────────────────────────────────────────────

describe("LAYER_BOUNDARY_VIOLATION — generated pixels never reach the evidence", () => {
  const withAssets = (assets: DuaConcept["assets"]) =>
    base({ assets, disclosureMode: "ai_visualization" });

  it("BLOCKS a generated asset in Layer A (evidence)", () => {
    expect(
      codes(withAssets([{ id: "a1", layer: "evidence", origin: "generated", description: "a generated shot of the worn tread" }])),
    ).toContain("LAYER_BOUNDARY_VIOLATION");
  });

  it("BLOCKS a generated asset in Layer B (explanation)", () => {
    expect(
      codes(withAssets([
        { id: "a1", layer: "evidence", origin: "real_footage", description: "bay footage of the tread" },
        { id: "b1", layer: "explanation", origin: "generated", description: "a generated cutaway diagram" },
      ])),
    ).toContain("LAYER_BOUNDARY_VIOLATION");
  });

  it("PASSES a generated asset in Layer C (absurdity)", () => {
    expect(
      codes(withAssets([
        { id: "a1", layer: "evidence", origin: "real_footage", description: "bay footage of the tread" },
        { id: "c1", layer: "absurdity", origin: "generated", description: "the witness box the tread stands in" },
      ])),
    ).not.toContain("LAYER_BOUNDARY_VIOLATION");
  });

  it("PASSES real footage and authored graphics in every layer they belong to", () => {
    expect(
      codes(withAssets([
        { id: "a1", layer: "evidence", origin: "real_footage", description: "bay footage" },
        { id: "b1", layer: "explanation", origin: "authored_graphic", description: "a callout arrow" },
        { id: "b2", layer: "explanation", origin: "real_footage", description: "a macro pass under the arrow" },
      ])),
    ).not.toContain("LAYER_BOUNDARY_VIOLATION");
  });

  it("keeps `generated` exclusive to Layer C and permission monotone down the stack", () => {
    expect(LAYER_CONTRACT.evidence.allowedOrigins).toEqual(["real_footage"]);
    expect(LAYER_CONTRACT.explanation.allowedOrigins).not.toContain("generated");
    expect(LAYER_CONTRACT.absurdity.allowedOrigins).toContain("generated");
    for (const wider of [LAYER_CONTRACT.explanation, LAYER_CONTRACT.absurdity]) {
      for (const origin of LAYER_CONTRACT.evidence.allowedOrigins) {
        expect(wider.allowedOrigins).toContain(origin);
      }
    }
  });

  it("WARNS when a concept has assets but no Layer A evidence at all", () => {
    const report = runDuaGate(
      withAssets([{ id: "c1", layer: "absurdity", origin: "generated", description: "the witness box" }]),
    );
    expect(report.findings.map((f) => f.code)).toContain("NO_EVIDENCE_LAYER");
  });
});

describe("GENERATED_WITHOUT_DISCLOSURE — layering is a truth control, not a labelling exemption", () => {
  const generated = [{ id: "c1", layer: "absurdity", origin: "generated", description: "the witness box" }] as const;

  it("BLOCKS generated material with no declared disclosure mode", () => {
    expect(codes(base({ assets: [...generated] }))).toContain("GENERATED_WITHOUT_DISCLOSURE");
  });

  it("PASSES once a disclosure mode is declared", () => {
    expect(codes(base({ assets: [...generated], disclosureMode: "ai_visualization" })))
      .not.toContain("GENERATED_WITHOUT_DISCLOSURE");
  });

  it("surfaces the Meta label requirement for photorealistic synthetic video", () => {
    const report = runDuaGate(base({ assets: [...generated], disclosureMode: "photorealistic_synthetic" }));
    expect(report.findings.map((f) => f.code)).toContain("AI_DISCLOSURE_REQUIRED");
  });

  it("asks for no disclosure when nothing was generated", () => {
    expect(
      codes(base({ assets: [{ id: "a1", layer: "evidence", origin: "real_footage", description: "bay footage" }] })),
    ).not.toContain("GENERATED_WITHOUT_DISCLOSURE");
  });
});

// ─── The franchise contract, finally read ──────────────────────────

describe("FRANCHISE_BLOCKING_CONDITION — conditions declared since the registry shipped, enforced now", () => {
  it("BLOCKS a Pothole Court concept that asserts a repair cost", () => {
    expect(codes(base({ payoff: "the tread is acquitted and the water channels are replaced for $180" })))
      .toContain("FRANCHISE_BLOCKING_CONDITION");
  });

  it("BLOCKS a concept that declares the vehicle unsafe to drive", () => {
    expect(codes(base({ benignResolution: "it is unsafe to drive until the tread water channels are replaced" })))
      .toContain("FRANCHISE_BLOCKING_CONDITION");
  });

  it("PASSES the same concept without a cost or a safety verdict", () => {
    expect(codes(base())).not.toContain("FRANCHISE_BLOCKING_CONDITION");
  });

  it("BLOCKS an unregistered franchise instead of ignoring it", () => {
    expect(codes(base({ franchiseId: "not_a_show" as never }))).toContain("FRANCHISE_BLOCKING_CONDITION");
  });

  it("reports which conditions have NO detector rather than implying full coverage", () => {
    // The honest half. A caller rendering "franchise contract enforced" has to
    // show this list, or it repeats the presence-not-behaviour claim.
    const unenforceable = unenforceableBlockingConditions("tire_autopsy");
    expect(unenforceable.length).toBeGreaterThan(0);
    expect(unenforceable.join(" ")).toContain("customer");
  });
});

// ─── Roles bind to the existing bible ──────────────────────────────

describe("roles bind to the brand bible rather than forking a second registry", () => {
  it("PASSES registered roles", () => {
    expect(codes(base({ roles: ["the_judge", "the_defendant", "cleveland"] }))).not.toContain("UNKNOWN_ROLE");
  });

  it("BLOCKS an unregistered role", () => {
    expect(codes(base({ roles: ["the_bailiff" as never] }))).toContain("UNKNOWN_ROLE");
  });

  it("binds every bound role to a character that actually exists in the bible", () => {
    for (const role of DUA_ROLES) {
      const boundTo = DUA_ROLE_SPECS[role].boundTo;
      if (boundTo) expect(BRAND_CAST[boundTo]).toBeDefined();
    }
  });
});

// ─── The seed bank is no longer an orphan ──────────────────────────

describe("the previously-orphaned seed bank is now load-bearing", () => {
  it("supplies the default swap corpus", () => {
    expect(DUA_SEED_FACTS.length).toBe(100);
    expect(DUA_SEED_CORPUS.facts.length).toBe(100);
  });

  it("splits each seed into a fact rather than keeping the whole pitch", () => {
    // The seed shape is "<absurd frame>; <mechanical fact>". Comparing frames
    // against frames would make every frame look portable.
    expect(DUA_SEED_FACTS.every((f) => f.length > 0 && !f.includes(";"))).toBe(true);
  });

  it("every absurdity type declares how it teaches AND how it fails", () => {
    for (const t of ABSURDITY_TYPES) {
      expect(ABSURDITY_TYPE_SPECS[t].teachingMechanism.length).toBeGreaterThan(20);
      expect(ABSURDITY_TYPE_SPECS[t].failureMode.length).toBeGreaterThan(20);
    }
  });
});

describe("mechanismTerms", () => {
  it("keeps measurement tokens intact", () => {
    expect(mechanismTerms("tread below 2/32 inch")).toContain("2/32");
  });

  it("keeps short domain terms the length filter would drop", () => {
    expect(mechanismTerms("check the psi and the tpms")).toEqual(expect.arrayContaining(["psi", "tpms"]));
  });

  it("stems plurals and tenses so the same mechanism matches itself", () => {
    expect(mechanismTerms("tires wearing")).toEqual(mechanismTerms("tire wear"));
  });

  it("drops connective words that would make any frame look relevant", () => {
    expect(mechanismTerms("this is something that will always be the same")).toEqual([]);
  });

  it("does not drop a low-information word that is still a real term", () => {
    // The stopword bank is deliberately conservative. Over-stopping is the
    // dangerous direction: every dropped term is one the relevance gate can no
    // longer see, which makes real concepts look decorative.
    expect(mechanismTerms("the corrosion spreads")).toContain("corrosion");
  });
});

// ─── The live wiring, and the false positive it already caught ─────

describe("wired into runReelPreflight — the derived path", () => {
  it.each(SAMPLE_REEL_BRIEFS.map((b) => [b.id, b] as const))(
    "does not block the shipped sample brief %s",
    (_id, brief) => {
      expect(runReelPreflight(brief).status).toBe("pass");
    },
  );

  it("does NOT block a correct sourced measurement in beat text (the 44 PSI regression)", () => {
    // Running the invented-measurement check over a whole reel blocked
    // `sample-pressure-door-sticker` on a correct sidewall-max figure. A reel is
    // not a closed fact/joke pair, so that arm is authored-path only.
    const brief = SAMPLE_REEL_BRIEFS.find((b) => b.id === "sample-pressure-door-sticker");
    expect(brief).toBeDefined();
    const fabricationBlocks = runReelDuaChecks(brief!).filter(
      (f) => f.severity === "block" && f.message.includes("FABRICATED_EVIDENCE"),
    );
    expect(fabricationBlocks).toEqual([]);
  });

  it("still BLOCKS a humiliated customer in text that will actually ship", () => {
    const brief = { ...SAMPLE_REEL_BRIEFS[0], selectedCaption: "Your tires are bald because the owner was too cheap to check." };
    const blocks = runReelDuaChecks(brief).filter((f) => f.severity === "block");
    expect(blocks.map((f) => f.message).join(" ")).toContain("CUSTOMER_HUMILIATED");
  });

  it("keeps inferred relevance at WARN, never block, on the derived path", () => {
    const brief = { ...SAMPLE_REEL_BRIEFS[0], usefulAbsurdity: "a gavel bangs in a wood-panelled room" };
    const findings = runReelDuaChecks(brief);
    const relevance = findings.filter((f) => f.message.includes("RELEVANCE_BELOW_THRESHOLD") || f.message.includes("FRAME_PORTABLE"));
    expect(relevance.length).toBeGreaterThan(0);
    expect(relevance.every((f) => f.severity === "warn")).toBe(true);
  });

  it("promotes relevance to BLOCK once a DUA concept is actually authored", () => {
    const decorative = base({
      violation: "a defendant is dragged before a stern tribunal",
      visualMetaphor: "a gavel hangs above a nervous silence",
      payoff: "the verdict lands and the room empties",
    });
    const brief = { ...SAMPLE_REEL_BRIEFS[0], dua: decorative };
    expect(runReelPreflight(brief).status).toBe("block");
    expect(runReelPreflight(brief).blocking.map((f) => f.message).join(" ")).toContain("RELEVANCE_BELOW_THRESHOLD");
  });

  it("runs the report over the derived view without inventing a concept", () => {
    const report = runDuaBriefChecks({
      usefulAbsurdity: "a gavel bangs in a wood-panelled room",
      mechanicTruth: "Tread below 2/32 inch loses wet grip.",
      hook: "",
      captionAngle: "",
      loopIdea: "",
      audienceText: [{ where: "caption", text: "worth checking your tread" }],
    });
    expect(report.stated).toEqual([]);
    expect(report.inferred.every((f) => f.severity === "warn")).toBe(true);
  });
});

// ─── Locked probe verdicts ─────────────────────────────────────────
//
// Guard-red-team: every verified false positive becomes a permanent
// allow-example, every verified catch a permanent deny-example. The probe set
// only grows. These are the sentences the detectors were actually run against
// before shipping, not the ones that were imagined.

describe("locked allow-examples — legitimate copy the detectors must NEVER block", () => {
  it.each([
    // "shows" is correct diagnostic English; only conclusion verbs assert a verdict.
    "An OBD scan shows a stored code, and the code names a system, not a part.",
    "A scan can point to the circuit, but do not guess the component.",
    "The readiness monitors report not ready until the drive cycle completes.",
    // Safety mechanism named, resolved by a check rather than by doing nothing.
    "Road salt corrodes brake lines from the outside in — worth checking in salt season.",
    "A blowout is sudden; a slow leak is not. Both are worth checking.",
    // Neutral second-person and driver mentions — the bulk of real reel copy.
    "The driver never noticed it; most people do not.",
    "Your brake pads have a wear indicator that squeals on purpose.",
    "You can check this yourself with a penny in ten seconds.",
    "Test the battery under load — a resting voltage can look fine.",
    "Reports of pothole damage rise every spring on Euclid Avenue.",
  ])("passes: %s", (text) => {
    const surfaces = [{ where: "copy", text }];
    expect([
      ...detectFabricatedVerdicts(surfaces),
      ...detectCustomerHumiliationIn(surfaces),
      ...detectSafetyTrivialisationIn(surfaces, text),
    ]).toEqual([]);
  });
});

describe("locked deny-examples — fabricated verdicts the frame may never assert", () => {
  it.each([
    "The lab confirms the tread failed at the shoulder.",
    "Our analysis proved the caliper was seized.",
    "The study concluded that this brand lasts longest.",
    "The test determined the alignment was out.",
  ])("blocks: %s", (text) => {
    expect(detectFabricatedVerdicts([{ where: "copy", text }])).toHaveLength(1);
  });
});

describe("the real production corpus stays clean", () => {
  it("raises zero block-severity findings across every committed reel pack", () => {
    // 116 briefs shipped by prior sessions. A detector that fires on these is a
    // detector that blocks the product, which is worse than the defect it fixes
    // — the exact warning reel-fabricated-stat.test.ts opens with. Fixtures are
    // committed files, never live config.
    const root = path.join(__dirname, "..", "docs", "reel-packs");
    if (!fs.existsSync(root)) return; // packs are committed; absence is not a pass signal worth failing on
    const str = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "");
    let scanned = 0;
    const findings: string[] = [];

    for (const dir of fs.readdirSync(root)) {
      const file = path.join(root, dir, "brief.json");
      if (!fs.existsSync(file)) continue;
      const brief = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      scanned++;
      const beats = (brief.storyboardBeats as Record<string, unknown>[] | undefined) ?? [];
      const surfaces = [
        { where: "caption", text: str(brief.selectedCaption) },
        { where: "voiceover", text: str(brief.voiceoverScript) },
        ...beats.map((b, i) => ({ where: `beat ${i + 1}`, text: `${str(b.visual)} ${str(b.onScreenText)}` })),
      ];
      const fact = `${str(brief.mechanicTruth)} ${str(brief.selectedCaption)}`;
      for (const f of [
        ...detectFabricatedVerdicts(surfaces),
        ...detectCustomerHumiliationIn(surfaces),
        ...detectSafetyTrivialisationIn(surfaces, fact),
      ]) {
        findings.push(`${dir}: ${f.code} (${f.where})`);
      }
    }

    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});

describe("the gate cannot report a clean franchise contract without its caveats", () => {
  it("carries the unenforceable conditions on the report itself", () => {
    // `unenforceableBlockingConditions` existed as a separate call a caller
    // could simply not make — which is the built-unwired shape. It rides on the
    // report now, so a passing verdict arrives with its own limits attached.
    const report = runDuaGate(base({ franchiseId: "tire_autopsy" }));
    expect(report.unenforcedConditions.join(" ")).toContain("customer");
  });

  it("computes the list per franchise rather than returning a constant", () => {
    // Pothole Court's three conditions (cost, unsafe-to-drive, named street)
    // are ALL covered by detectors, so its list is legitimately empty. Tire
    // Autopsy's "presenting a generated tire as a specific customer's tire" is
    // not mechanically checkable and must show up. A constant would fail one of
    // these two whichever value it took.
    expect(runDuaGate(base({ franchiseId: "pothole_court" })).unenforcedConditions).toEqual([]);
    expect(runDuaGate(base({ franchiseId: "tire_autopsy" })).unenforcedConditions.length).toBeGreaterThan(0);
  });

  it("reports no unenforced conditions when no franchise was declared", () => {
    expect(runDuaGate(base({ franchiseId: undefined })).unenforcedConditions).toEqual([]);
  });
});

describe("the swap probe's near-duplicate cutoff is calibrated, and stays calibrated", () => {
  /**
   * Six concepts authored by prior sessions, mapped onto the three structural
   * surfaces. This is the only relevance corpus in the repo that this file did
   * not write, which is exactly what makes it the honest false-positive lock.
   *
   * Measured while calibrating: excluding near-duplicates at a 0.5 weight ratio
   * left `c-pressure-1` beaten by ANOTHER sidewall-PSI fact and reported
   * portable; 0.4 clears all six. Without this test that cutoff is a magic
   * number nothing defends — the mutation pass caught it surviving at 0.95.
   */
  const authored = SAMPLE_REEL_BRIEFS.flatMap((b) =>
    b.concepts.map((c) => ({
      id: c.id,
      usefulFact: `${b.mechanicTruth} ${c.coreFact}`,
      violation: `${c.hook} ${c.usefulAbsurdity}`,
      visualMetaphor: `${c.usefulAbsurdity} ${c.beatOutline.join(" ")}`,
      payoff: `${c.loopIdea} ${c.captionAngle} ${c.saveShareReason}`,
    })),
  );

  it("has a corpus to test against", () => {
    expect(authored.length).toBeGreaterThanOrEqual(6);
  });

  it.each(authored.map((a) => [a.id, a] as const))("does not call authored concept %s portable", (_id, input) => {
    const probe = probeFrameSwap(input);
    expect(probe.comparedAgainst).toBeGreaterThan(50);
    expect(probe.portable).toBe(false);
  });

  it.each(authored.map((a) => [a.id, a] as const))("finds authored concept %s relevant", (_id, input) => {
    expect(readRelevance(input).relevant).toBe(true);
  });
});

// ─── Trajectory: DUA is inert on the compiled payload ──────────────

describe("adding a DUA concept does not perturb prompt compilation", () => {
  /**
   * `facelessReelStudio.ts` is the Visual World file, so touching it requires
   * trajectory evidence that locked invariants still reach the final payload.
   * This diff adds an OPTIONAL `dua` field plus a preflight call, and the claim
   * being proved is that both are inert on what the provider is actually sent:
   * the compiled pack is byte-identical with and without the concept, and the
   * visual world's locked invariants still land in every beat.
   */
  const worldBrief = () => ({
    ...SAMPLE_REEL_BRIEFS[0],
    visualWorld: {
      style: "safe" as const,
      heroFrameUrl: "https://example.invalid/hero.png",
      framePrompt: "a worn tread block under a single overhead work light",
      lockedInvariants: "SAME OBJECT: one worn tread block, warm brushed gold key light, deep matte black field.",
    },
  });

  it("compiles an identical prompt pack with and without an authored concept", () => {
    const without = buildHiggsfieldReelPromptPack(worldBrief());
    const withDua = buildHiggsfieldReelPromptPack({ ...worldBrief(), dua: base() });
    expect(withDua).toEqual(without);
  });

  it("still carries the locked invariants into every beat prompt", () => {
    const pack = buildHiggsfieldReelPromptPack({ ...worldBrief(), dua: base() });
    expect(pack.length).toBeGreaterThan(0);
    for (const beat of pack) {
      expect(beat.prompt).toContain("SAME OBJECT: one worn tread block");
    }
  });

  it("stops a brief BEFORE the pack when the authored concept fails the gate", () => {
    // The one way DUA reaches the payload: it can prevent one being built at
    // all. prepareCleanReelBrief only compiles the pack after preflight passes.
    const decorative = base({
      violation: "a defendant is dragged before a stern tribunal",
      visualMetaphor: "a gavel hangs above a nervous silence",
      payoff: "the verdict lands and the room empties",
    });
    expect(runReelPreflight({ ...worldBrief(), dua: decorative }).status).toBe("block");
    expect(runReelPreflight(worldBrief()).status).toBe("pass");
  });
});

// ─── REAL_EVENT_ASSERTED — the only live protection ────────────────
//
// This gate matters more than any other in the file, for a reason that is a
// fact about the shop rather than the code: THERE IS NO REAL SHOP FOOTAGE.
// Every frame is generated, so no Layer A asset is ever declared and
// `checkLayerBoundary` can never fire. Refusing copy that narrates an episode
// is the only thing left between a synthetic reel and a false claim about this
// business. It is therefore canaried through the LIVE call path, not the unit
// function — `runReelDuaChecks` is what production actually invokes.

describe("REAL_EVENT_ASSERTED — blocks through the live derived path", () => {
  const live = (caption: string) =>
    runReelDuaChecks({ ...SAMPLE_REEL_BRIEFS[0], selectedCaption: caption })
      .filter((f) => f.severity === "block" && f.message.includes("REAL_EVENT_ASSERTED"));

  it.each([
    "We replaced this customer's tie rod last Tuesday.",
    "This one came in on a flatbed Monday morning.",
    "A customer brought this in after hitting a pothole on Euclid.",
    "Here's the before and after.",
    "We tested this tire and found the belt separated.",
    "We pulled this rotor off a Civic this morning.",
  ])("BLOCKS a narrated episode: %s", (caption) => {
    expect(live(caption).length).toBeGreaterThan(0);
  });

  it.each([
    "Swing by 17625 Euclid - we'll check all four, no charge.",
    "Stop by and we'll take a look.",
    "Road salt corrodes brake lines from the outside in - worth checking in salt season.",
    "The driver never noticed it; most people do not.",
    "Your brake pads have a wear indicator that squeals on purpose.",
    "An OBD scan shows a stored code, and the code names a system, not a part.",
    "Pulling to one side may indicate alignment is off.",
    "If you can see the top of Lincoln's head, it's time.",
    "Most batteries last three to five years.",
    "We can check tread depth on all four while you wait.",
  ])("PASSES legitimate present-tense shop copy: %s", (caption) => {
    expect(live(caption)).toEqual([]);
  });

  it("needs BOTH a definite actor and a past action in one sentence", () => {
    // Either half alone is ordinary copy. Only together do they narrate.
    expect(live("We'll take a look at it.")).toEqual([]);           // agent, no past action
    expect(live("The belt separated on the highway.")).toEqual([]); // past action, no definite actor
    expect(live("We replaced the belt.").length).toBeGreaterThan(0); // both
  });

  it("does not fuse a beat's visual with its on-screen CTA", () => {
    // The regression: `${b.visual} ${b.onScreenText}` manufactured the sentence
    // "...pulled into the bay We check all three free" — the only false
    // positive across 134 committed reel packs. They are separate surfaces now.
    const brief = {
      ...SAMPLE_REEL_BRIEFS[0],
      storyboardBeats: SAMPLE_REEL_BRIEFS[0].storyboardBeats.map((b, i) =>
        i === 0
          ? { ...b, visual: "a vehicle is pulled into the bay, no people visible", onScreenText: "We check all three free" }
          : b,
      ),
    };
    const hits = runReelDuaChecks(brief).filter((f) => f.message.includes("REAL_EVENT_ASSERTED"));
    expect(hits).toEqual([]);
  });
});

describe("REAL_EVENT_ASSERTED — the committed production corpus stays clean", () => {
  it("raises zero findings across every committed reel pack", () => {
    const root = path.join(__dirname, "..", "docs", "reel-packs");
    if (!fs.existsSync(root)) return;
    const S = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "");
    let scanned = 0;
    const findings: string[] = [];

    for (const dir of fs.readdirSync(root)) {
      const file = path.join(root, dir, "brief.json");
      if (!fs.existsSync(file)) continue;
      const b = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      scanned++;
      const beats = (b.storyboardBeats as Record<string, unknown>[] | undefined) ?? [];
      const brief = {
        ...SAMPLE_REEL_BRIEFS[0],
        selectedCaption: S(b.selectedCaption),
        voiceoverScript: S(b.voiceoverScript),
        ...(beats.length ? { storyboardBeats: beats as never } : {}),
      };
      for (const f of runReelDuaChecks(brief).filter((x) => x.message.includes("REAL_EVENT_ASSERTED"))) {
        findings.push(`${dir}: ${f.message.slice(0, 100)}`);
      }
    }

    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  });
});

// ─── Review-gate fixes (PR #2014), each with its own canary ────────

describe("an authored concept does not exempt the shipping copy (review P1)", () => {
  it("still BLOCKS a real-event assertion in the caption when a clean concept exists", () => {
    // The defect: `if (brief.dua) { ...; return; }` short-circuited the
    // stated-surface checks. A clean or STALE concept then exempted whatever
    // the caption was later edited to say.
    const brief = {
      ...SAMPLE_REEL_BRIEFS[0],
      dua: base(),
      selectedCaption: "We replaced this customer's tie rod last Tuesday.",
    };
    const blocks = runReelDuaChecks(brief).filter((f) => f.severity === "block");
    expect(blocks.map((f) => f.message).join(" ")).toContain("REAL_EVENT_ASSERTED");
  });

  it("still BLOCKS a humiliated customer in the caption when a clean concept exists", () => {
    const brief = {
      ...SAMPLE_REEL_BRIEFS[0],
      dua: base(),
      selectedCaption: "Your tires are bald because the owner was too cheap to check.",
    };
    expect(runReelDuaChecks(brief).filter((f) => f.severity === "block").map((f) => f.message).join(" "))
      .toContain("CUSTOMER_HUMILIATED");
  });

  it("runs BOTH gates — authored findings and stated-surface findings appear together", () => {
    const brief = {
      ...SAMPLE_REEL_BRIEFS[0],
      dua: base({ absurdityLevel: 5 }), // authored-only defect
      selectedCaption: "We replaced this customer's tie rod last Tuesday.", // stated defect
    };
    const msgs = runReelDuaChecks(brief).map((f) => f.message).join(" ");
    expect(msgs).toContain("ABSURDITY_LEVEL_UNCAPPED");
    expect(msgs).toContain("REAL_EVENT_ASSERTED");
  });
});

describe("FRANCHISE_EVIDENCE_MISSING — requiredEvidence fails closed (review P2)", () => {
  it("BLOCKS a regulatory franchise whose sources declare no TYPE", () => {
    // `factSources` is free text: "Ohio EPA" and "some blog" are the same
    // string to a linter. E-Check turns on the difference.
    const c = base({ franchiseId: "echeck_escape_room", factSources: ["some blog I read"], factSourceTypes: [] });
    const f = runDuaGate(c).blocking.find((x) => x.code === "FRANCHISE_EVIDENCE_MISSING");
    expect(f).toBeDefined();
    // Distinguish the two branches: "declares no source TYPES" is a different
    // failure from "declares the wrong ones", and only asserting the code makes
    // the empty-set branch an equivalent mutant.
    expect(f!.detail).toContain("declares no source TYPES");
  });

  it("BLOCKS when the declared types do not include what the franchise requires", () => {
    const c = base({
      franchiseId: "echeck_escape_room",
      factSources: ["a tire forum"],
      factSourceTypes: ["verified_review"],
    });
    const f = runDuaGate(c).blocking.find((x) => x.code === "FRANCHISE_EVIDENCE_MISSING");
    expect(f).toBeDefined();
    expect(f!.detail).toContain("declares only verified_review");
  });

  it("PASSES once the required evidence type is declared", () => {
    const c = base({
      franchiseId: "echeck_escape_room",
      factSources: ["Ohio EPA E-Check program"],
      factSourceTypes: ["government_source"],
    });
    expect(codes(c)).not.toContain("FRANCHISE_EVIDENCE_MISSING");
  });

  it("asks nothing of a concept with no franchise", () => {
    expect(codes(base({ franchiseId: undefined }))).not.toContain("FRANCHISE_EVIDENCE_MISSING");
  });
});
