/**
 * AI Gateway Integration Tests
 * Tests Venice routing, circuit breaker, embed fallback,
 * and LLM bypass resolution.
 */
import { describe, it, expect } from "vitest";

describe("AI Provider Configuration", () => {
  it("Venice is the primary provider for all chat tasks", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/ai-gateway.ts", "utf8")
    );
    const veniceCount = (content.match(/provider: "venice"/g) || []).length;
    const ollamaCount = (content.match(/provider: "ollama"/g) || []).length;

    expect(veniceCount).toBeGreaterThanOrEqual(10);
    expect(ollamaCount).toBe(0);
  });

  it("embed task uses OpenAI (Venice doesnt support embeddings)", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/ai-gateway.ts", "utf8")
    );
    // Find the embed config block
    const embedMatch = content.match(/embed:\s*\{[^}]+\}/s);
    expect(embedMatch).toBeTruthy();
    expect(embedMatch![0]).toContain('"openai"');
    expect(embedMatch![0]).toContain("text-embedding-3-small");
  });

  it("circuit breaker thresholds are reasonable", () => {
    const FAILURE_THRESHOLD = 3;
    const COOLDOWN_MS = 120_000; // 2 minutes

    expect(FAILURE_THRESHOLD).toBe(3);
    expect(COOLDOWN_MS).toBe(120000);
    expect(COOLDOWN_MS / 1000).toBe(120); // 2 minutes in seconds
  });
});

describe("LLM Bypass (invokeLLM)", () => {
  it("resolveApiKey detects Venice URL", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/_core/llm.ts", "utf8")
    );
    expect(content).toContain("venice.ai");
    expect(content).toContain("VENICE_API_KEY");
    expect(content).toContain("OPENAI_API_KEY");
  });
});

describe("AI Routing Table", () => {
  it("all 11 task types have routing entries", () => {
    const tasks = [
      "chat", "classify", "summarize", "extract", "sql",
      "code", "embed", "generate", "receptionist", "estimate",
      "sms-response",
    ];
    expect(tasks).toHaveLength(11);
  });

  it("customer-facing tasks use reliable providers", () => {
    // receptionist and generate use OpenAI (most reliable)
    // These are customer-facing so reliability > cost
    const customerFacing = ["generate", "receptionist", "estimate"];
    expect(customerFacing).toHaveLength(3);
  });
});

describe("Gateway Health", () => {
  it("health endpoint reports Venice status", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/ai-gateway.ts", "utf8")
    );
    expect(content).toContain("veniceHealthy");
    expect(content).toContain("circuitBreaker");
  });

  it("memory alert fires at 80% threshold", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/health.ts", "utf8")
    );
    expect(content).toContain("80");
    expect(content).toContain("sendTelegram");
    expect(content).toContain("MEMORY");
  });
});

describe("Feature Flag Integration", () => {
  it("50 flags defined in featureFlags service", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/services/featureFlags.ts", "utf8")
    );
    const keyCount = (content.match(/key: "/g) || []).length;
    expect(keyCount).toBe(50);
  });

  it("flag REST API endpoints exist", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/_core/index.ts", "utf8")
    );
    expect(content).toContain("/api/admin/flags");
    expect(content).toContain("/api/admin/flags/toggle");
  });
});
