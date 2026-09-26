import { describe, expect, it } from "vitest";
import {
  buildResearchCompilerDirective,
  detectResearchCompilerMode,
  stripResearchCompilerPrefix,
} from "@/lib/ai/research-query-compiler";
import { SLASH_COMMANDS } from "@/hooks/use-slash-commands";

describe("research query compiler", () => {
  it("detects explicit general and Nick's modes", () => {
    expect(detectResearchCompilerMode("DRQ: figure out the best camera setup")).toBe("general");
    expect(detectResearchCompilerMode("/drq figure out the best camera setup")).toBe("general");
    expect(detectResearchCompilerMode("NICKDRQ: improve local tire demand")).toBe("nicks");
    expect(detectResearchCompilerMode("/nickdrq improve local tire demand")).toBe("nicks");
  });

  it("detects natural prompt-writing asks but never hijacks an actual research request", () => {
    expect(detectResearchCompilerMode("write me a deep research prompt about camera intelligence")).toBe("general");
    expect(detectResearchCompilerMode("make a research query for the best CRM approach")).toBe("general");
    expect(detectResearchCompilerMode("deep research prompt for camera intelligence")).toBe("general");
    expect(detectResearchCompilerMode("do deep research on camera intelligence")).toBeNull();
    expect(detectResearchCompilerMode("search the web for the latest camera models")).toBeNull();
    expect(detectResearchCompilerMode("Research query performance for PostgreSQL")).toBeNull();
    expect(detectResearchCompilerMode("research query planner behavior for PostgreSQL")).toBeNull();
  });

  it("strips only the explicit compiler prefix", () => {
    expect(stripResearchCompilerPrefix(" DRQ:   compare open source vision stacks ")).toBe(
      "compare open source vision stacks",
    );
    expect(stripResearchCompilerPrefix("/nickdrq   local SEO")).toBe("local SEO");
  });

  it("general directive is prompt-only, adversarial, current-state-first and executable", () => {
    const prompt = buildResearchCompilerDirective("general");
    expect(prompt).toContain("Do NOT perform the research");
    expect(prompt).toContain("Return ONLY the finished research prompt");
    expect(prompt).toContain("falsify");
    expect(prompt).toContain("CURRENT-STATE FIRST");
    expect(prompt).toContain("REUSE");
    expect(prompt).toContain("What would change this conclusion?");
  });

  it("Nick's directive adds the shop-specific operating context without weakening the core", () => {
    const prompt = buildResearchCompilerDirective("nicks");
    expect(prompt).toContain("NICK'S TIRE & AUTO DOMAIN OVERRIDE");
    expect(prompt).toContain("greater Cleveland/Euclid");
    expect(prompt).toContain("LIVE + VERIFIED");
    expect(prompt).toContain("REUSE BEFORE REBUILD");
    expect(prompt).toContain("customer");
    expect(prompt).toContain("Do NOT perform the research");
  });

  it("surfaces both writers in the live chat slash menu as fill-not-fire templates", () => {
    const drq = SLASH_COMMANDS.find((c) => c.cmd === "/drq");
    const nick = SLASH_COMMANDS.find((c) => c.cmd === "/nickdrq");
    expect(drq?.prompt).toBe("DRQ: ");
    expect(nick?.prompt).toBe("NICKDRQ: ");
    expect(drq?.prompt.endsWith(": ")).toBe(true);
    expect(nick?.prompt.endsWith(": ")).toBe(true);
  });
});
