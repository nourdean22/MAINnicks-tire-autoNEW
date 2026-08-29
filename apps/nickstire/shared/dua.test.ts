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
import {
  runDuaGate,
  runDuaBriefChecks,
  readRelevance,
  probeFrameSwap,
  mechanismTerms,
  buildSwapCorpus,
  unenforceableBlockingConditions,
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
import { runReelPreflight, runReelDuaChecks } from "../client/src/lib/facelessReelStudio";

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
