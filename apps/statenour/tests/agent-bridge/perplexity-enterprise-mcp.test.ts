import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertBridgeAuth, resolveBridgeToken } from "@/lib/agent-bridge/auth";
import { getBridgeSafeTools } from "@/lib/agent-bridge/tool-adapter";
import { mcpAllowedOriginHostnames } from "@/lib/agent-bridge/mcp-server";
import { BRIDGE_HARD_DENY, isToolInScope, scopeTools } from "@/lib/agent-bridge/scopes";

describe("Perplexity Enterprise remote MCP", () => {
  const ORIGINAL_ENABLED = process.env.AGENT_BRIDGE_ENABLED;
  const ORIGINAL_TOKEN = process.env.AGENT_BRIDGE_TOKEN_PERPLEXITY;

  beforeEach(() => {
    process.env.AGENT_BRIDGE_ENABLED = "true";
    process.env.AGENT_BRIDGE_TOKEN_PERPLEXITY = "test-perplexity-connector-token";
  });

  afterEach(() => {
    if (ORIGINAL_ENABLED === undefined) delete process.env.AGENT_BRIDGE_ENABLED;
    else process.env.AGENT_BRIDGE_ENABLED = ORIGINAL_ENABLED;

    if (ORIGINAL_TOKEN === undefined) delete process.env.AGENT_BRIDGE_TOKEN_PERPLEXITY;
    else process.env.AGENT_BRIDGE_TOKEN_PERPLEXITY = ORIGINAL_TOKEN;
  });

  it("maps the dedicated credential to a dedicated research identity", () => {
    expect(
      resolveBridgeToken("test-perplexity-connector-token", {
        AGENT_BRIDGE_TOKEN_PERPLEXITY: "test-perplexity-connector-token",
      }),
    ).toEqual({
      clientId: "perplexity-enterprise",
      scope: "research",
    });
  });

  it("accepts both canonical Bearer and x-api-key custom-connector auth", () => {
    const bearer = new Request("https://bdnick.info/api/mcp", {
      headers: { Authorization: "Bearer test-perplexity-connector-token" },
    });
    const apiKey = new Request("https://bdnick.info/api/mcp", {
      headers: { "x-api-key": "test-perplexity-connector-token" },
    });

    expect(assertBridgeAuth(bearer)).toEqual({
      clientId: "perplexity-enterprise",
      scope: "research",
    });
    expect(assertBridgeAuth(apiKey)).toEqual({
      clientId: "perplexity-enterprise",
      scope: "research",
    });
  });

  it("allows the exact Perplexity web origins without wildcarding look-alikes", () => {
    const hosts = mcpAllowedOriginHostnames();
    expect(hosts).toContain("perplexity.ai");
    expect(hosts).toContain("www.perplexity.ai");
    expect(hosts).not.toContain("perplexity.ai.evil.example");
  });

  it("exposes read tools plus only the two bounded research writes", () => {
    const tools = scopeTools("research");
    expect(tools).toContain("getShopSnapshot");
    expect(tools).toContain("searchMemories");
    expect(tools).toContain("saveResearchReport");
    expect(tools).toContain("proposeResearchAction");

    for (const forbidden of [
      "createTask",
      "completeTask",
      "sendTelegram",
      "queueExternalWorkerJob",
      "runPython",
      "runDeviceCommand",
      "sendOpportunitySms",
      "triggerInstagramAutopost",
    ]) {
      expect(tools).not.toContain(forbidden);
      expect(isToolInScope(forbidden, "research")).toBe(false);
    }

    expect(tools.filter((name) => BRIDGE_HARD_DENY.has(name))).toEqual([]);
  });

  it("advertises valid MCP schemas for the research return channel", () => {
    const exposed = getBridgeSafeTools("mcp", "research");
    const save = exposed.find((tool) => tool.camelName === "saveResearchReport");
    const propose = exposed.find((tool) => tool.camelName === "proposeResearchAction");

    expect(save?.name).toBe("save_research_report");
    expect(propose?.name).toBe("propose_research_action");

    expect(save?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        title: expect.any(Object),
        question: expect.any(Object),
        summary: expect.any(Object),
        citations: expect.any(Object),
      }),
    });
    expect(propose?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        title: expect.any(Object),
        rationale: expect.any(Object),
        evidence: expect.any(Object),
        priority: expect.any(Object),
      }),
    });

    expect(
      save?.handler.inputSchema.safeParse({
        title: "Cleveland tire demand",
        question: "What changed this week?",
        summary: "A sufficiently long external research summary for the schema canary.",
        citations: [{ title: "Example", url: "https://example.com/source" }],
      }).success,
    ).toBe(true);

    expect(
      save?.handler.inputSchema.safeParse({
        title: "Bad citation",
        question: "What changed?",
        summary: "A sufficiently long external research summary for the schema canary.",
        citations: [{ url: "not-a-url" }],
      }).success,
    ).toBe(false);
  });
});
