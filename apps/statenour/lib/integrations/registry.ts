/**
 * AI Tools Arsenal — Integration Registry
 *
 * Central registry for all 18 free-tier AI tools integrated into NOUR OS.
 * Each tool has: status, category, credentials location, API endpoints, and health check.
 *
 * Usage:
 *   import { registry, getToolsByCategory, getActiveTools } from "@/lib/integrations/registry";
 */

export type ToolStatus = "pending" | "active" | "error" | "disabled" | "rate_limited";
export type ToolCategory =
  | "automation"
  | "research"
  | "content"
  | "design"
  | "video"
  | "presentations"
  | "meetings"
  | "sales"
  | "enrichment"
  | "chatbot"
  | "transcription"
  | "prototyping"
  | "planning"
  | "crm"
  | "seo"
  | "social"
  | "project_management"
  | "image_gen"
  | "dev"
  | "ai";

export interface IntegrationTool {
  id: string;
  name: string;
  category: ToolCategory;
  status: ToolStatus;
  tier: "free";
  signupUrl: string;
  apiBaseUrl?: string;
  envKeys: string[];
  webhookPath?: string;
  healthCheck?: () => Promise<boolean>;
  description: string;
}

/**
 * Master registry of active AI tools.
 * Cleaned Apr 14 — removed tools with no code integration and no credentials.
 * Status is determined at runtime by checking env vars.
 */
const TOOLS: Omit<IntegrationTool, "status">[] = [
  // CORE — actively used with credentials
  // Venice AI retired — the provider was decommissioned and no code
  // path calls it anymore (knowledge classification now no-ops). The
  // VENICE_API_KEY env var has no live consumer.
  { id: "make", name: "Make.com", category: "automation", tier: "free", signupUrl: "https://www.make.com/en/register", apiBaseUrl: "https://hook.us1.make.com", envKeys: ["MAKE_WEBHOOK_URL", "MAKE_API_KEY"], webhookPath: "/api/webhooks/make", description: "Visual automation workflows — connects everything" },
  { id: "grok", name: "Grok", category: "ai", tier: "free", signupUrl: "https://x.com/i/grok", apiBaseUrl: "https://api.x.ai/v1", envKeys: ["XAI_API_KEY"], description: "xAI's model — real-time data, unfiltered" },
  { id: "fireflies", name: "Fireflies.ai", category: "meetings", tier: "free", signupUrl: "https://fireflies.ai", apiBaseUrl: "https://api.fireflies.ai/graphql", envKeys: ["FIREFLIES_API_KEY"], description: "Meeting transcription and AI summaries" },
  { id: "apollo", name: "Apollo.io", category: "sales", tier: "free", signupUrl: "https://www.apollo.io/sign-up", apiBaseUrl: "https://api.apollo.io/v1", envKeys: ["APOLLO_API_KEY"], description: "Sales intelligence and lead generation" },
  { id: "clickup", name: "ClickUp", category: "project_management", tier: "free", signupUrl: "https://clickup.com/signup", apiBaseUrl: "https://api.clickup.com/api/v2", envKeys: ["CLICKUP_API_KEY"], description: "Project management and task tracking" },
  // v10.0.529.106 · Wave 55 · Descript dropped · was a registry stub
  // only · zero referencing code, no client adapter, no surface that
  // ever called it. The DESCRIPT_API_KEY env var had no consumer.
  // AVAILABLE — code exists, needs API key to activate
  { id: "perplexity", name: "Perplexity AI", category: "research", tier: "free", signupUrl: "https://www.perplexity.ai", apiBaseUrl: "https://api.perplexity.ai", envKeys: ["PERPLEXITY_API_KEY"], description: "AI-powered research engine with citations" },
  { id: "stripe", name: "Stripe", category: "crm", tier: "free", signupUrl: "https://stripe.com", apiBaseUrl: "https://api.stripe.com", envKeys: ["STRIPE_SECRET_KEY"], description: "Payment processing" },
];

/** Resolve tool status from environment */
function resolveStatus(tool: Omit<IntegrationTool, "status">): ToolStatus {
  if (tool.envKeys.length === 0) return "active"; // No API key needed — browser-based tools
  const allPresent = tool.envKeys.every((key) => !!process.env[key]);
  return allPresent ? "active" : "pending";
}

/** Get the full registry with resolved statuses */
export function getRegistry(): IntegrationTool[] {
  return TOOLS.map((t) => ({ ...t, status: resolveStatus(t) }));
}

/** Get tools by category */
export function getToolsByCategory(category: ToolCategory): IntegrationTool[] {
  return getRegistry().filter((t) => t.category === category);
}

/** Get only active (configured) tools */
export function getActiveTools(): IntegrationTool[] {
  return getRegistry().filter((t) => t.status === "active");
}

/** Get tools that still need setup */
export function getPendingTools(): IntegrationTool[] {
  return getRegistry().filter((t) => t.status === "pending");
}

/** Get a single tool by ID */
export function getTool(id: string): IntegrationTool | undefined {
  return getRegistry().find((t) => t.id === id);
}

/** Summary stats for dashboard */
export function getRegistryStats() {
  const all = getRegistry();
  return {
    total: all.length,
    active: all.filter((t) => t.status === "active").length,
    pending: all.filter((t) => t.status === "pending").length,
    error: all.filter((t) => t.status === "error").length,
    byCategory: Object.fromEntries(
      Array.from(new Set(all.map((t) => t.category))).map((cat) => [
        cat,
        { total: all.filter((t) => t.category === cat).length, active: all.filter((t) => t.category === cat && t.status === "active").length },
      ])
    ),
  };
}
