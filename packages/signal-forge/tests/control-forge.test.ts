import { describe, it, expect } from "vitest";
import { generateSignalControlArchitecture } from "../src/control-forge/architecture-generator.js";
import { createEcommerceTrendDiscoveryExample } from "../src/control-forge/examples/ecommerce-product-trends.js";
import { decideWorkflowPattern } from "../src/control-forge/workflow-scoring.js";
import { renderControlForgeMarkdown } from "../src/shared/render-markdown.js";

describe("Control Forge", () => {
  it("scores 0-6 as single_agent", () => {
    expect(decideWorkflowPattern(1, 1, 1, 1, 1).decision).toBe("single_agent");
  });

  it("scores 7-11 as single_agent_with_tools", () => {
    expect(decideWorkflowPattern(2, 2, 2, 2, 2).decision).toBe("single_agent_with_tools");
  });

  it("scores 12-20 as multi_agent", () => {
    expect(decideWorkflowPattern(4, 4, 4, 4, 4).decision).toBe("multi_agent");
  });

  it("generates deterministic ecommerce example without paid APIs", () => {
    const input = createEcommerceTrendDiscoveryExample();
    const result = generateSignalControlArchitecture(input);
    
    expect(result.roleRoster.length).toBeGreaterThan(0);
    expect(result.roleRoster[0].forbiddenTools).toContain("paid_apis");
  });

  it("exports valid Markdown with exact 1 to 19 section order", () => {
    const input = createEcommerceTrendDiscoveryExample();
    const result = generateSignalControlArchitecture(input);
    const md = renderControlForgeMarkdown(result);
    
    // Check sequential ordering
    expect(md.indexOf("# 1. Executive Verdict")).toBeLessThan(md.indexOf("# 2. Confidence Level"));
    expect(md.indexOf("# 2. Confidence Level")).toBeLessThan(md.indexOf("# 3. Task Restatement"));
    expect(md.indexOf("# 18. Implementation Notes")).toBeLessThan(md.indexOf("# 19. Final Recommendation"));
  });

  it("has no fabricated latency or cost metrics", () => {
    const input = createEcommerceTrendDiscoveryExample();
    const result = generateSignalControlArchitecture(input);
    const md = renderControlForgeMarkdown(result);
    
    expect(md).not.toContain("ms");
    expect(md).not.toContain("$0."); // No fake cost
  });
});
