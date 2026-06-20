import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// One-line note: Assertions verifying the integration of check:stale-docs in verify:hard and CI workflows go green only after F4 is applied.

describe("stale-docs-gate verification checks", () => {
  it("verifies apps/statenour/package.json verify:hard script includes check:stale-docs", () => {
    // Read package.json relative to this test directory
    const packageJsonPath = path.resolve(__dirname, "../../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

    const verifyHardScript = packageJson.scripts?.["verify:hard"];
    expect(verifyHardScript).toBeDefined();

    // Check that it runs the check:stale-docs script
    expect(verifyHardScript).toContain("check:stale-docs");
  });

  it("verifies .github/workflows/test.yml includes stale-docs verification step for statenour", () => {
    // Read test.yml relative to this test directory
    const workflowPath = path.resolve(__dirname, "../../../../.github/workflows/test.yml");
    const workflowYaml = fs.readFileSync(workflowPath, "utf-8");

    // The workflow should run the stale docs command for the workspace
    // either directly, via filter, or as part of verification
    expect(workflowYaml).toContain("check:stale-docs");
  });
});
