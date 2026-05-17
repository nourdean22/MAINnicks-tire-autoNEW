/**
 * v10.0.235 · Strategic Frameworks registry · pin the framework
 * detection / picking / injection contracts.
 *
 * The registry is the foundation Nick will build business genius on
 * top of for years. If detection regresses, every business question
 * stops getting framework-grade reasoning. The tests guard against
 * that.
 */
import { describe, it, expect } from "vitest";
import {
  REGISTRY,
  hasBusinessIntent,
  pickFrameworks,
  composeStrategicLensBlock,
} from "@/lib/ai/strategic-frameworks";

describe("registry · sanity", () => {
  it("ships at least 9 frameworks at v10.0.235 baseline", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(9);
  });

  it("v10.0.236 expansion · ships 23+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(23);
  });

  it("v10.0.238 expansion · ships 30+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(30);
  });

  it("v10.0.239 expansion · ships 36+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(36);
  });

  it("v10.0.240 expansion · ships 42+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(42);
  });

  it("v10.0.241 expansion · ships 44+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(44);
  });

  it("v10.0.243 expansion · ships 46+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(46);
  });

  it("v10.0.245 expansion · ships 48+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(48);
  });

  it("v10.0.246 expansion · ships 50+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(50);
  });

  it("v10.0.247 expansion · ships 52+ frameworks", () => {
    expect(REGISTRY.length).toBeGreaterThanOrEqual(52);
  });

  it("every framework has the required fields", () => {
    for (const f of REGISTRY) {
      expect(f.id).toBeTruthy();
      expect(f.name).toBeTruthy();
      expect(f.oneLiner).toBeTruthy();
      expect(f.lens).toBeTruthy();
      expect(f.triggers.length).toBeGreaterThan(0);
    }
  });

  it("framework ids are unique (no collisions when adding new ones)", () => {
    const ids = REGISTRY.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("hasBusinessIntent · top-level filter", () => {
  it("triggers on business / money / strategy keywords", () => {
    expect(hasBusinessIntent("How do we grow revenue this quarter")).toBe(true);
    expect(hasBusinessIntent("What's our profit margin on tires")).toBe(true);
    expect(hasBusinessIntent("Should we launch a fleet service")).toBe(true);
    expect(hasBusinessIntent("How do we price the alignment bundle")).toBe(true);
    expect(hasBusinessIntent("Who are our biggest competitors")).toBe(true);
    expect(hasBusinessIntent("LTV vs CAC ratio for the shop")).toBe(true);
  });

  it("does not trigger on non-business chat", () => {
    expect(hasBusinessIntent("How do I sleep better")).toBe(false);
    expect(hasBusinessIntent("What time is it")).toBe(false);
    expect(hasBusinessIntent("Tell me a joke")).toBe(false);
    expect(hasBusinessIntent("")).toBe(false);
    expect(hasBusinessIntent("hi")).toBe(false);
  });
});

describe("pickFrameworks · framework matching", () => {
  it("picks Business Model Canvas for value-prop questions", () => {
    const matches = pickFrameworks(
      "What's the value proposition we're delivering to fleet customers",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("osterwalder-canvas");
  });

  it("picks JTBD for 'why customers really buy'", () => {
    const matches = pickFrameworks("Why do customers really come to our shop");
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("jobs-to-be-done");
  });

  it("picks Launch Strategy for new service rollout", () => {
    const matches = pickFrameworks(
      "How should we roll out the new financing tier",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("launch-strategy");
  });

  it("picks Monetization for revenue-model questions", () => {
    const matches = pickFrameworks(
      "Should we move to a subscription monetization model",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("monetization");
  });

  it("picks Pricing Strategy for tactical pricing", () => {
    const matches = pickFrameworks(
      "What markup should we use on tires and how should we bundle alignment",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("pricing-strategy");
  });

  it("picks Growth Engine for marketing-system questions", () => {
    const matches = pickFrameworks(
      "How do we wire ads to CRM to re-engagement into a growth engine",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("growth-engine");
  });

  it("picks Awareness Stages for funnel design", () => {
    const matches = pickFrameworks(
      "How do we run a cold-lead retargeting funnel for new Cleveland drivers",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("awareness-stages");
  });

  it("picks Competitive Landscape for positioning questions", () => {
    const matches = pickFrameworks(
      "Where are we positioned vs other Cleveland shops",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("competitive-landscape");
  });

  it("picks Kotler Macro for big-picture / EV / regulatory questions", () => {
    const matches = pickFrameworks(
      "What's the long-term outlook on EVs for our service revenue",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("kotler-macro");
  });

  // v10.0.236 expansion · 14 new lenses · v10.0.237 adds Elon Musk
  it("picks Elon Musk for first-principles / physics-based questions", () => {
    const matches = pickFrameworks(
      "Apply first principles thinking · why does this cost so much",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("elon-musk");
  });

  it("picks Elon Musk for 10x / eliminate-the-part questions", () => {
    const matches = pickFrameworks(
      "How do we 10x this · or eliminate the step entirely",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("elon-musk");
  });

  it("picks Warren Buffett for long-term value-investing questions", () => {
    const matches = pickFrameworks(
      "Should I hold this position for 10 years or sell now",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("warren-buffett");
  });

  it("picks Steve Jobs for product positioning / simplification", () => {
    const matches = pickFrameworks(
      "How do we position the product so it's undeniable · what to cut",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("steve-jobs");
  });

  it("picks Startup Metrics for KPI / dashboard questions", () => {
    const matches = pickFrameworks(
      "What KPIs should we track on the operations dashboard",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("startup-metrics");
  });

  it("picks Startup Analyst for keep/pivot/cut questions", () => {
    const matches = pickFrameworks(
      "Should we keep investing in the fleet line or pivot",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("startup-analyst");
  });

  it("picks Financial Modeling for P&L / cashflow / scenarios", () => {
    const matches = pickFrameworks(
      "Build a financial model with bull base bear scenarios for the new service",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("financial-modeling");
  });

  it("picks Financial Projections for forecast questions", () => {
    const matches = pickFrameworks(
      "What's the revenue forecast for next quarter at this trajectory",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("financial-projections");
  });

  it("picks Market Opportunity for market sizing", () => {
    const matches = pickFrameworks(
      "What's the TAM for tire shops in the Cleveland local market",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("market-opportunity");
  });

  it("picks Team Composition for hiring / firing decisions", () => {
    const matches = pickFrameworks(
      "Should I hire another technician this quarter",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("team-composition");
  });

  it("picks Sequence Psychologist for customer-journey design", () => {
    const matches = pickFrameworks(
      "How should we sequence the onboarding flow for new customers",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("sequence-psychologist");
  });

  it("picks Supply Chain Risk for vendor / supplier questions", () => {
    const matches = pickFrameworks(
      "What's our concentration risk on the main tire supplier",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("supply-chain-risk");
  });

  it("picks Task Intelligence for prioritization questions", () => {
    const matches = pickFrameworks(
      "What should I prioritize first · my P1 list is too long",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("task-intelligence");
  });

  it("picks Trust Calibrator on confidence / verify-this asks", () => {
    const matches = pickFrameworks(
      "How confident are you in this · should we double-check it",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("trust-calibrator");
  });

  it("picks Systematic Debugging for 'why isn't this working' questions", () => {
    const matches = pickFrameworks(
      "Why isn't the funnel converting · what's the root cause",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("systematic-debugging");
  });

  // v10.0.238 expansion · classic strategy lenses
  it("picks Porter's Five Forces for industry-structure questions", () => {
    const matches = pickFrameworks(
      "Walk me through the five forces · supplier power buyer power barriers to entry",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("porters-five-forces");
  });

  it("picks 7 Powers for 'why can't competitors copy us' questions", () => {
    const matches = pickFrameworks(
      "What's our durable moat · why can't competitors catch up",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("seven-powers");
  });

  it("picks Theory of Constraints for bottleneck questions", () => {
    const matches = pickFrameworks(
      "Where is the real bottleneck slowing down our throughput",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("theory-of-constraints");
  });

  it("picks Unit Economics for per-customer P&L questions", () => {
    const matches = pickFrameworks(
      "Does the unit economics work · what's our LTV to CAC ratio",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("unit-economics");
  });

  it("picks North Star Metric for 'one metric to track' questions", () => {
    const matches = pickFrameworks(
      "What should our north star metric be for the business",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("north-star-metric");
  });

  it("picks Crossing the Chasm for adoption-curve questions", () => {
    const matches = pickFrameworks(
      "Why aren't we reaching mainstream customers · we're stuck with early adopters",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("crossing-the-chasm");
  });

  // v10.0.239 expansion · lean / mental-model lenses
  it("picks AARRR for funnel conversion-rate questions", () => {
    const matches = pickFrameworks(
      "What's our activation rate at each stage of the funnel",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("aarrr-metrics");
  });

  it("picks Lean Canvas for early-stage problem/solution-fit questions", () => {
    const matches = pickFrameworks(
      "How do I validate the problem-solution fit for this MVP",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("lean-canvas");
  });

  it("picks Inversion on 'how would this fail' questions", () => {
    const matches = pickFrameworks(
      "What would guarantee failure for this business · let's pre-mortem it",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("inversion");
  });

  it("picks 5 Whys for root-cause questions", () => {
    const matches = pickFrameworks(
      "Why does this customer complaint keep recurring · what's the root cause",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("five-whys");
  });

  it("picks Innovator's Dilemma for disruption questions", () => {
    const matches = pickFrameworks(
      "Are we vulnerable to a low-end disruption from a new entrant",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("innovators-dilemma");
  });

  it("picks Blue Ocean for category-creation questions", () => {
    const matches = pickFrameworks(
      "How do we create uncontested market space · escape the red ocean",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("blue-ocean");
  });

  // v10.0.240 expansion · situational + focus lenses
  it("picks Wardley Mapping for situational-awareness questions", () => {
    const matches = pickFrameworks(
      "Should we build this in-house or buy it · do a wardley map",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("wardley-mapping");
  });

  it("picks OKRs for quarterly-goal-setting questions", () => {
    const matches = pickFrameworks(
      "Help me set quarterly OKRs with key results for the team",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("okrs");
  });

  it("picks Pareto Principle for 80/20 questions", () => {
    const matches = pickFrameworks(
      "Which 20% of customers drive 80% of revenue · do a pareto analysis",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("pareto-principle");
  });

  it("picks Cohort Analysis for retention-curve questions", () => {
    const matches = pickFrameworks(
      "Show me the cohort analysis · is retention actually getting better",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("cohort-analysis");
  });

  it("picks Marketplace Dynamics for two-sided / chicken-and-egg questions", () => {
    const matches = pickFrameworks(
      "How do we solve the chicken and egg problem in this two-sided marketplace",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("marketplace-dynamics");
  });

  it("picks ICP for ideal-customer-profile questions", () => {
    const matches = pickFrameworks(
      "Help me sharpen our ideal customer profile · who is our target customer",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("ideal-customer-profile");
  });

  // v10.0.241 expansion · capital + pricing-power lenses
  it("picks Pricing Power for 'can we raise prices' questions", () => {
    const matches = pickFrameworks(
      "Do we have pricing power · could we raise prices without losing customers",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("pricing-power");
  });

  it("picks Capital Allocation for 'where to deploy cash' questions", () => {
    const matches = pickFrameworks(
      "Should we reinvest profits · do a buyback · or save for an acquisition",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("capital-allocation");
  });

  // v10.0.243 expansion · negotiation + cognitive-bias lenses
  it("picks Negotiation Frame for negotiation / deal questions", () => {
    const matches = pickFrameworks(
      "How should I negotiate the salary counter-offer with this candidate",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("negotiation");
  });

  it("picks Survivorship Bias for 'lessons from winners' questions", () => {
    const matches = pickFrameworks(
      "What's the survivorship bias in copying habits from successful billionaires",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("survivorship-bias");
  });

  // v10.0.245 expansion · mental-model lenses
  it("picks Hanlon's Razor on 'they're out to get us' framings", () => {
    const matches = pickFrameworks(
      "I think the supplier is deliberately sabotaging our orders · they're out to get us",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("hanlons-razor");
  });

  it("picks Second-Order Thinking on 'and then what' / unintended-consequences", () => {
    const matches = pickFrameworks(
      "If we cut prices to win customers what are the unintended consequences and downstream effects",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("second-order-thinking");
  });

  // v10.0.246 expansion · distribution + tradeoff lenses
  it("picks Power Law for outlier / 10x / hits-driven questions", () => {
    const matches = pickFrameworks(
      "Apply the power law lens · which top customers are 10x bigger than the rest",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("power-law");
  });

  it("picks Opportunity Cost on tradeoff / 'doing both' questions", () => {
    const matches = pickFrameworks(
      "Should I do both at the same time · what's the opportunity cost of saying yes to this",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("opportunity-cost");
  });

  // v10.0.247 expansion · behavioral + tempo lenses
  it("picks Loss Aversion for framing / FOMO / Kahneman questions", () => {
    const matches = pickFrameworks(
      "Should we use loss aversion framing · prospect theory says losses feel 2x as bad as gains",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("loss-aversion");
  });

  it("picks OODA Loop for decision-cycle / fast-changing-environment questions", () => {
    const matches = pickFrameworks(
      "Apply the OODA loop · how do we tighten our decision cycle in this fast-changing market",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).toContain("ooda-loop");
  });

  it("returns empty for non-business turns", () => {
    expect(pickFrameworks("How do I sleep better")).toEqual([]);
    expect(pickFrameworks("What's the weather")).toEqual([]);
  });

  // v10.0.242 expansion · harden against false-fires across registry growth
  // (44 lenses · regression risk that a generic phrase activates a framework
  // it shouldn't). If any of these fail, the failing framework's triggers
  // need an anti-trigger or tighter regex.
  it("does NOT fire any framework on greetings / smalltalk", () => {
    expect(pickFrameworks("hey nick")).toEqual([]);
    expect(pickFrameworks("good morning")).toEqual([]);
    expect(pickFrameworks("how are you doing today")).toEqual([]);
    expect(pickFrameworks("thanks man")).toEqual([]);
  });

  it("does NOT fire any framework on personal life questions", () => {
    expect(pickFrameworks("what should I eat for lunch")).toEqual([]);
    expect(pickFrameworks("recommend a movie tonight")).toEqual([]);
    expect(pickFrameworks("what's a good workout")).toEqual([]);
  });

  it("does NOT fire any framework on technical / coding non-business queries", () => {
    expect(pickFrameworks("explain async await in javascript")).toEqual([]);
    expect(pickFrameworks("how do I center a div in css")).toEqual([]);
  });

  it("caps matches at topN (default 3)", () => {
    // A message that hits many frameworks at once
    const matches = pickFrameworks(
      "How do we price our new launch · the value proposition · the pricing model · " +
      "competitor positioning · marketing funnel · LTV CAC growth engine",
    );
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it("anti-trigger suppresses launch-strategy on idiomatic 'launch'", () => {
    const matches = pickFrameworks(
      "How do I launch the chrome browser from a script",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).not.toContain("launch-strategy");
  });

  it("anti-trigger suppresses pricing-strategy on idiomatic 'price'", () => {
    const matches = pickFrameworks(
      "What's the price of admission to the founder retreat",
    );
    const ids = matches.map((m) => m.framework.id);
    expect(ids).not.toContain("pricing-strategy");
  });
});

describe("composeStrategicLensBlock · injection", () => {
  it("returns empty string when no business intent", () => {
    expect(composeStrategicLensBlock("How do I sleep better")).toBe("");
    expect(composeStrategicLensBlock("")).toBe("");
  });

  it("returns a STRATEGIC LENS block when business intent matches", () => {
    const block = composeStrategicLensBlock(
      "How should we price the alignment bundle",
    );
    expect(block).toContain("## STRATEGIC LENS");
    expect(block).toContain("Pricing Strategy");
  });

  it("includes 1-3 framework sections, not more", () => {
    const block = composeStrategicLensBlock(
      "What's the value proposition + pricing + competitive landscape + " +
      "monetization model for our new fleet service launch",
    );
    const sectionCount = (block.match(/^### /gm) || []).length;
    expect(sectionCount).toBeGreaterThanOrEqual(1);
    expect(sectionCount).toBeLessThanOrEqual(3);
  });

  it("ends with a 'name the lens' instruction so Nick surfaces the framework", () => {
    const block = composeStrategicLensBlock(
      "How do we grow revenue from existing customers",
    );
    expect(block.toLowerCase()).toContain("name the lens");
  });
});
