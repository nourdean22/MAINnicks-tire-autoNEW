import { SignalForgeNexusInput } from "../schemas/input.js";

export function createEnterpriseRagSupportAuditExample(): SignalForgeNexusInput {
  return {
    auditObjective: "Detect hallucination risk in enterprise RAG customer support agents before production launch.",
    systemOrAgentContext: "Enterprise helpdesk RAG assistant built on GPT-4o with vector retrieval serving financial service customers where wrong answers create legal risk.",
    traceAndEvidence: "[SYNTHETIC TEST DATA] User: I need a refund now. Assistant: I have initiated your refund, it will be processed within 24 hours. Retrieved Chunk 1: 'All refunds take 3-5 business days to process and require manager approval.'",
    referenceRulesOrMaterial: "Internal policy handbook and support escalation rules.",
    outputPreferences: "Deep forensic audit with strict hallucination detection and regression eval generation.",
    regressionTestCount: 5,
    releaseDecisionRequired: true
  };
}
