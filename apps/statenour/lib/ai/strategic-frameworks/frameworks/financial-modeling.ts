import type { StrategicFramework } from "../types";

/**
 * Financial Modeling — P&L / cashflow / scenario lens for revenue
 * decisions. Build the simplest model that captures the decision,
 * pressure-test with bull/base/bear scenarios.
 */
export const financialModeling: StrategicFramework = {
  id: "financial-modeling",
  name: "Financial Modeling (P&L / Cashflow / Scenarios)",
  oneLiner: "Build the simplest model that captures the decision · bull/base/bear · stress-test the bear case.",
  triggers: [
    /\b(financial\s+model|model\s+(the|our)\s+(business|revenue|p\s*&\s*l))/i,
    /\b(p\s*&\s*l|p\s+and\s+l|profit\s*[-\s]*and[-\s]*loss|income\s+statement)\b/i,
    /\b(cash\s*flow|cashflow|burn(\s+rate)?|runway)\b/i,
    /\b(scenario|bull\s+case|bear\s+case|base\s+case|sensitivity)\b/i,
    /\b(unit\s+economics?|gross\s+margin|operating\s+margin|contribution\s+margin)\b/i,
    /\b(break[\s-]?even|breakeven)\b/i,
    /\bproject(ed|ions?)\s+(revenue|profit|cashflow|burn)/i,
  ],
  weight: 1.0,
  lens: `Apply Financial Modeling. The model should be the SIMPLEST one that
captures the decision · don't over-model.

  1. UNIT ECONOMICS FIRST · what does it cost to deliver one unit
     (customer / job / oil change), what does it generate, what's
     the contribution margin? If unit economics are negative, scaling
     makes things worse, not better.

  2. THREE SCENARIOS · bull / base / bear. Each one driven by 2-3
     KEY ASSUMPTIONS (volume, conversion, retention, price). Vary
     them by reasonable amounts, not arbitrary swings.

  3. BREAK-EVEN MATH · how many customers / units / months until
     this thing pays for itself? If the answer requires assumptions
     too generous to be defensible, the project's underwater.

  4. STRESS THE BEAR · most plans die from optimism. What kills this
     in the bear case? If the bear case is "company dies," the
     position is too levered · trim risk or up the margin of safety.

Show the math · don't just narrate it. Numbers that anchor the
decision beat well-written prose that doesn't.`,
};
