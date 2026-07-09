import { SignalControlForgeInput } from "../schemas/input.js";

export function createEcommerceTrendDiscoveryExample(): SignalControlForgeInput {
  return {
    promptProductName: "Ecommerce Trend Discovery",
    defaultLanguage: "TypeScript",
    primaryUseCase: "Ecommerce Research",
    designPrinciple: "Evidence-led",
    coreTask: "Design a research-driven execution architecture that identifies emerging ecommerce product trends, validates real buyer demand, evaluates competitive intensity, estimates commercial viability, and produces a launch-ready product opportunity report for online sellers, ecommerce operators, dropshippers, marketplace sellers, and product researchers.",
    contextAndMaterials: "Global ecommerce market context, public marketplace trend signals, search demand indicators, public social media trend signals.",
    toolsAndLimits: "under 90 seconds, no paid APIs, no paid datasets.",
    deliverablePackage: "Full package with architecture, prompts, schemas, implementation notes, scoring rubric, failure containment, evidence standards, product opportunity report schema, and evaluation test cases.",
    precisionRequirements: "High accuracy, moderate risk, max four agents, evidence-based conclusions.",
    maxAgentCount: 4,
    allowedTools: ["public search engines", "public marketplace pages"],
    forbiddenTools: ["scraping private data", "paid APIs", "fabricating metrics"]
  };
}
