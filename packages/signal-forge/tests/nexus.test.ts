import { describe, it, expect } from "vitest";
import { generateNexusAudit } from "../src/nexus/audit-generator.js";
import { createEnterpriseRagSupportAuditExample } from "../src/nexus/examples/enterprise-rag-support-audit.js";
import { renderNexusMarkdown } from "../src/shared/render-markdown.js";

describe("SignalForge Nexus", () => {
  it("marks missing evidence as unsupported rather than assuming support", () => {
    const input = createEnterpriseRagSupportAuditExample();
    const result = generateNexusAudit(input);
    
    const missingClaim = result.evidenceLedger.find(e => e.verdict === "unsupported");
    expect(missingClaim).toBeDefined();
    expect(missingClaim?.evidenceSource).toContain("Missing");
  });

  it("exports valid Markdown with exact 1 to 11 section order", () => {
    const input = createEnterpriseRagSupportAuditExample();
    const result = generateNexusAudit(input);
    const md = renderNexusMarkdown(result);
    
    expect(md.indexOf("# 1. Mission Scope")).toBeLessThan(md.indexOf("# 2. Executive Risk Snapshot"));
    expect(md.indexOf("# 10. Release Gate Decision")).toBeLessThan(md.indexOf("# 11. Final Executive Summary"));
  });

  it("includes synthetic trace data marker", () => {
    const input = createEnterpriseRagSupportAuditExample();
    expect(input.traceAndEvidence).toContain("[SYNTHETIC TEST DATA]");
  });

  it("outputs safe certainty markers", () => {
    const input = createEnterpriseRagSupportAuditExample();
    const result = generateNexusAudit(input);
    
    const hasUnverifiable = result.evidenceLedger.some(e => e.verdict === "unverifiable" || e.verdict === "structural risk");
    expect(hasUnverifiable).toBe(true);
  });
});
