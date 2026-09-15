// Mutation receipt (2026-09-15): tool-inspector.tsx `rows.find((r) => r.id === entity.id)` -> `rows[0]` (any row for any id):
// 1 failed | 2 passed; red: "loading / error / unknown id are three different notices" expected the markup to contain
// 'data-inspector-state="not-found"'. Restored byte-for-byte from the scratchpad copy.
/**
 * ToolInspector states (2026-09-15, wave 3). One list read
 * (system.getTools), found by id: loading / error are the notices; an id
 * the registry lacks is NOT-FOUND; a loaded capability shows the flags
 * with their meanings (an off flag is crossed out, not hidden), the risk,
 * the approval policy, and the env verdict — missing keys named, or "all N
 * required keys present", or "no env required". Static markup, mocked trpc.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({ data: undefined, isLoading: false, isError: false, error: null });
  return { query: blank(), blank };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: { system: { getTools: { useQuery: () => stubs.query } } },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/system/tools",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { ToolInspector } from "@/components/inspector/panels/tool-inspector";

const ENTITY = { kind: "tool", id: "firecrawl.scrape" } as const;
const TOOL = {
  id: "firecrawl.scrape",
  label: "Firecrawl scrape",
  description: "Fetch a public web page as fenced markdown",
  category: "web",
  status: "restricted_active",
  health: "missing_env",
  riskClass: "medium",
  readAccess: true,
  writeAccess: false,
  externalMutation: false,
  memoryWriteAllowed: false,
  approvalPolicy: "auto_with_audit",
  requiredEnv: ["FIRECRAWL_API_KEY"],
  optionalEnv: ["FIRECRAWL_BASE_URL"],
  allowedDomains: ["*.example.com"],
  timeoutMs: 20000,
  dailyLimit: 200,
  costClass: "low",
  auditLogRequired: true,
  currentLimitations: ["SSRF guard blocks private ranges", "content is fenced before the prompt"],
  notes: "Parked on purpose for local hosts.",
  missingEnv: ["FIRECRAWL_API_KEY"],
};

beforeEach(() => {
  stubs.query = stubs.blank();
});

const render = () => renderToStaticMarkup(<ToolInspector entity={ENTITY} mode="inspect" />);

describe("ToolInspector", () => {
  it("loading / error / unknown id are three different notices", () => {
    stubs.query.isLoading = true;
    expect(render()).toContain('data-inspector-state="loading"');
    stubs.query = { ...stubs.blank(), isError: true, error: new Error("boom") };
    expect(render()).toContain('data-inspector-state="error"');
    stubs.query = { ...stubs.blank(), data: [{ ...TOOL, id: "other.tool" }] };
    const nf = render();
    expect(nf).toContain('data-inspector-state="not-found"');
    expect(nf).not.toContain("data-tool-inspector");
  });

  it("a known capability renders flags with meanings, risk, approval and the env verdict", () => {
    stubs.query.data = [TOOL];
    const html = render();
    expect(html).toContain('data-tool-inspector="firecrawl.scrape"');
    expect(html).toContain("Firecrawl scrape");
    expect(html).toContain('data-tool-flag="read" data-tool-flag-on="true"');
    expect(html).toMatch(/data-tool-flag="mutate"(?! data-tool-flag-on)/); // off → present, crossed out, not hidden
    expect(html).toContain("line-through");
    expect(html).toContain('data-tool-risk="medium"');
    expect(html).toContain("auto with audit");
    expect(html).toContain('data-tool-missing-env="1"');
    expect(html).toContain("missing · FIRECRAWL_API_KEY");
    expect(html).toContain("timeout 20000ms · 200/day · cost low");
    expect(html).toContain("SSRF guard blocks private ranges");
    expect(html).toContain("min-h-[44px]"); // the action row's phone floor
  });

  it("env verdict: all keys present, or no env required (the controls)", () => {
    stubs.query.data = [{ ...TOOL, missingEnv: [] }];
    expect(render()).toContain("all 1 required keys present");
    stubs.query.data = [{ ...TOOL, missingEnv: [], requiredEnv: [], optionalEnv: [] }];
    expect(render()).toContain("no env required");
  });
});
