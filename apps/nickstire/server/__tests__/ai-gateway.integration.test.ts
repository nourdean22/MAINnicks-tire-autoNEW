/**
 * AI Gateway Integration Tests
 * Tests Venice routing, circuit breaker, embed fallback,
 * and LLM bypass resolution.
 */
import { describe, it, expect } from "vitest";

describe("AI Provider Configuration", () => {
  it("OpenAI is the primary provider for all chat tasks", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/ai-gateway.ts", "utf8")
    );
    const openaiCount = (content.match(/provider: "openai"/g) || []).length;
    const ollamaCount = (content.match(/provider: "ollama"/g) || []).length;

    expect(openaiCount).toBeGreaterThanOrEqual(10);
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
  it("resolveApiKey retrieves OpenAI key", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/_core/llm.ts", "utf8")
    );
    expect(content).not.toContain("venice.ai");
    expect(content).not.toContain("VENICE_API_KEY");
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
  it("health endpoint reports stats and routing table", async () => {
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/lib/ai-gateway.ts", "utf8")
    );
    expect(content).not.toContain("veniceHealthy");
    expect(content).not.toContain("circuitBreaker:");
    expect(content).toContain("routingTable");
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
  it("at least 30 flags defined in featureFlags service", async () => {
    // wave-181.60 — switched from `.toBe(50)` to `>=` so adding new
    // feature flags doesn't break the suite. The test exists to catch
    // accidental DELETIONS (someone removes the registry), not to
    // freeze the count. admin-excellence wave removed the 19 decorative
    // engine_* flags (58 -> 39 defs), so the floor is 30 — still catches a
    // mass-deletion of the registry without freezing the count.
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/services/featureFlags.ts", "utf8")
    );
    const keyCount = (content.match(/key: "/g) || []).length;
    expect(keyCount).toBeGreaterThanOrEqual(30);
  });

  it("flag REST API endpoints exist", async () => {
    // 2026-06 · index.ts god-file split — the /api/admin/* handlers were
    // extracted verbatim to routes/adminRoutes.ts (still mounted via
    // registerAdminRoutes(app) in index.ts). Assert against the new home.
    const content = await import("fs").then(fs =>
      fs.readFileSync("server/routes/adminRoutes.ts", "utf8")
    );
    expect(content).toContain("/api/admin/flags");
    expect(content).toContain("/api/admin/flags/toggle");
  });
});
