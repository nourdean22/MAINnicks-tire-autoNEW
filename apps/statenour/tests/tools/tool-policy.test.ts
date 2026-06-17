import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getToolCapabilities,
  getToolCapability,
  getMissingEnvForTool,
  getToolHealthSummary
} from "@/lib/tools/tool-registry";
import { evaluateToolAction } from "@/lib/tools/tool-policy";

describe("Tool Registry Completeness", () => {
  it("has all 26 core tool capabilities registered", () => {
    const list = getToolCapabilities();
    expect(list.length).toBeGreaterThanOrEqual(26);

    const ids = list.map((t) => t.id);
    const expected = [
      "web.search.verified",
      "web.search.arsenal",
      "document.ingest_url",
      "document.drive_read",
      "media.session_search",
      "media.session_recall",
      "browser.navigate",
      "browser.observe",
      "browser.extract",
      "browser.act",
      "memory.pin",
      "memory.log_situation",
      "memory.resolve_contradiction",
      "github.read_file",
      "github.search_code",
      "github.create_pr",
      "github.create_issue",
      "gmail.read_inbox",
      "gmail.read_thread",
      "gmail.compose_draft_card",
      "calendar.read_today",
      "calendar.propose_event_link",
      "code.run_js_vm",
      "code.run_python_e2b",
      "local.file_access",
      "local.shell"
    ];

    for (const id of expected) {
      expect(ids).toContain(id);
    }
  });

  it("retrieves individual tools correctly", () => {
    const t = getToolCapability("web.search.verified");
    expect(t).not.toBeNull();
    expect(t?.id).toBe("web.search.verified");
    expect(t?.category).toBe("web");

    const nonExistent = getToolCapability("non_existent_tool_id");
    expect(nonExistent).toBeNull();
  });
});

describe("Environment & Health Probes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-perplexity-key");
    vi.stubEnv("TAVILY_API_KEY", "test-tavily-key");
    vi.stubEnv("EXA_API_KEY", "test-exa-key");
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-google-key");
    vi.stubEnv("BROWSERBASE_API_KEY", "");
    vi.stubEnv("BROWSERBASE_PROJECT_ID", "");
    vi.stubEnv("E2B_API_KEY", "test-e2b-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("identifies missing required environment variables", () => {
    // browser.navigate requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID
    const missing = getMissingEnvForTool("browser.navigate");
    expect(missing).toContain("BROWSERBASE_API_KEY");
    expect(missing).toContain("BROWSERBASE_PROJECT_ID");

    // web.search.verified requires PERPLEXITY_API_KEY, which is stubbed
    const missingWeb = getMissingEnvForTool("web.search.verified");
    expect(missingWeb).not.toContain("PERPLEXITY_API_KEY");
  });

  it("calculates correct tool health summary based on env state", () => {
    const summary = getToolHealthSummary();
    const verifiedSearch = summary.find((s) => s.id === "web.search.verified");
    const browserNavigate = summary.find((s) => s.id === "browser.navigate");
    const localShell = summary.find((s) => s.id === "local.shell");

    expect(verifiedSearch?.health).toBe("active"); // All env set
    expect(browserNavigate?.health).toBe("missing_env"); // missing BROWSERBASE keys
    expect(localShell?.health).toBe("blocked"); // status is blocked
  });
});

describe("Permission Policy Engine Rules", () => {
  beforeEach(() => {
    vi.stubEnv("PERPLEXITY_API_KEY", "test-perplexity-key");
    vi.stubEnv("GITHUB_TOKEN", "test-github-token");
    vi.stubEnv("E2B_API_KEY", ""); // empty
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies unknown tools", () => {
    const res = evaluateToolAction({ toolId: "random.unknown", actionType: "read" });
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("Unknown tool ID");
  });

  it("denies blocked local tools", () => {
    const resFile = evaluateToolAction({ toolId: "local.file_access", actionType: "read" });
    expect(resFile.decision).toBe("deny");
    expect(resFile.reason).toContain("blocked");

    const resShell = evaluateToolAction({ toolId: "local.shell", actionType: "run" });
    expect(resShell.decision).toBe("deny");
    expect(resShell.reason).toContain("blocked");
  });

  it("denies inert/scaffolded tools with missing env", () => {
    const res = evaluateToolAction({ toolId: "browser.navigate", actionType: "navigate" });
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("Required environment variables are missing");
  });

  it("denies active tools that are missing their required env", () => {
    const res = evaluateToolAction({ toolId: "code.run_python_e2b", actionType: "execute" });
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("E2B_API_KEY");
  });

  it("allows low-risk read-only tools with healthy env", () => {
    const res = evaluateToolAction({ toolId: "web.search.verified", actionType: "search" });
    expect(res.decision).toBe("allow");
  });

  it("requires owner approval for external mutations", () => {
    const res = evaluateToolAction({
      toolId: "github.create_pr",
      actionType: "create",
      externalMutation: true
    });
    expect(res.decision).toBe("require_owner");
    expect(res.requiredApproval).toBe("owner_required");
  });

  it("requires screenshot approval for browser sensitive actions", () => {
    // We override status to active temporarily to bypass inert block in this test
    const cap = getToolCapability("browser.act");
    if (cap) {
      const originalStatus = cap.status;
      cap.status = "active";
      vi.stubEnv("BROWSERBASE_API_KEY", "set");
      vi.stubEnv("BROWSERBASE_PROJECT_ID", "set");

      const res = evaluateToolAction({
        toolId: "browser.act",
        actionType: "click"
      });
      expect(res.decision).toBe("require_screenshot_approval");
      expect(res.requiredApproval).toBe("screenshot_required");

      // restore
      cap.status = originalStatus;
    }
  });

  it("requires memory review for external memory writes", () => {
    const res = evaluateToolAction({
      toolId: "memory.pin",
      actionType: "write",
      memoryWriteRequested: true,
      containsExternalContent: true
    });
    expect(res.decision).toBe("require_memory_review");
    expect(res.requiredApproval).toBe("memory_review_required");
  });

  it("denies destructive actions", () => {
    const res = evaluateToolAction({
      toolId: "web.search.verified",
      actionType: "delete",
      destructive: true
    });
    expect(res.decision).toBe("deny");
    expect(res.reason).toContain("destructive actions are disabled");
  });

  describe("Dynamic Prefix Tools Evaluation", () => {
    it("resolves dynamic system tools (e.g. task.create) as low-risk/medium allow", () => {
      const cap = getToolCapability("task.create");
      expect(cap).not.toBeNull();
      expect(cap?.id).toBe("task.create");
      expect(cap?.category).toBe("system");
      expect(cap?.riskClass).toBe("medium");

      const res = evaluateToolAction({ toolId: "task.create", actionType: "execute" });
      expect(res.decision).toBe("allow");
    });

    it("resolves dynamic memory writes and requires owner approval", () => {
      const cap = getToolCapability("memory.pin_idea");
      expect(cap).not.toBeNull();
      expect(cap?.memoryWriteAllowed).toBe(true);

      const res = evaluateToolAction({
        toolId: "memory.pin_idea",
        actionType: "write",
        memoryWriteRequested: true
      });
      // Normal write request requires owner approval
      expect(res.decision).toBe("require_owner");
      expect(res.requiredApproval).toBe("owner_required");
    });

    it("resolves telegram tools and requires owner approval for mutations", () => {
      const cap = getToolCapability("telegram.sendMessage");
      expect(cap).not.toBeNull();
      expect(cap?.externalMutation).toBe(true);

      const res = evaluateToolAction({
        toolId: "telegram.sendMessage",
        actionType: "send"
      });
      expect(res.decision).toBe("require_owner");
      expect(res.requiredApproval).toBe("owner_required");
    });

    it("resolves arsenal code execution as critical risk requiring owner", () => {
      const cap = getToolCapability("arsenal.runPython");
      expect(cap).not.toBeNull();
      expect(cap?.riskClass).toBe("critical");

      const res = evaluateToolAction({
        toolId: "arsenal.runPython",
        actionType: "execute"
      });
      expect(res.decision).toBe("require_owner");
      expect(res.requiredApproval).toBe("owner_required");
    });
  });
});
