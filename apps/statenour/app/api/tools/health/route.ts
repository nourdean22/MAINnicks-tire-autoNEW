import { NextResponse } from "next/server";
export const revalidate = 300; // ISR: cache at edge, regenerate every 300s
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tools/health — Runtime dependency check for all tool categories.
 * Checks: database, env vars, external APIs.
 * Returns a category-level health report.
 */
export async function GET() {
  const checks: Record<string, { status: "ok" | "degraded" | "down"; detail: string; checked: string[] }> = {};
  const now = new Date().toISOString();

  // ── DATABASE ──
  try {
    const start = Date.now();
    await prisma.$queryRawUnsafe("SELECT 1");
    const latency = Date.now() - start;
    checks.database = {
      status: latency < 500 ? "ok" : "degraded",
      detail: `${latency}ms latency`,
      checked: ["prisma", "neon"],
    };
  } catch (e) {
    checks.database = { status: "down", detail: String(e), checked: ["prisma", "neon"] };
  }

  // ── ENV VARS — categorized ──
  const envChecks: Record<string, string[]> = {
    // ai: VENICE_API_KEY only — Venice is the PRIMARY provider and the
    // Ollama/OpenAI/Anthropic fallbacks back it. Requiring the unset
    // last-resort ANTHROPIC_API_KEY here falsely degraded the arsenal.
    // Mirrors lib/services/tools-health.ts. (2026-06-02 audit.)
    ai: ["VENICE_API_KEY"],
    voice: ["HUGGINGFACE_API_KEY"],
    files: ["GITHUB_TOKEN", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    communication: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    business: ["STATENOUR_SYNC_KEY"],
    cron: ["CRON_SECRET"],
  };

  for (const [category, vars] of Object.entries(envChecks)) {
    const present = vars.filter(v => !!process.env[v]);
    const missing = vars.filter(v => !process.env[v]);
    checks[`env_${category}`] = {
      status: missing.length === 0 ? "ok" : present.length > 0 ? "degraded" : "down",
      detail: missing.length === 0 ? "All set" : `Missing: ${missing.join(", ")}`,
      checked: vars,
    };
  }

  // ── TOOL CATEGORY SUMMARY ──
  type HealthStatus = "ok" | "degraded" | "down";
  const categories: Record<string, { tools: number; deps: string[]; status: HealthStatus }> = {
    "Personal Data (read)": { tools: 17, deps: ["database"], status: "ok" },
    "Personal Data (write)": { tools: 15, deps: ["database"], status: "ok" },
    "Weekly Planning": { tools: 5, deps: ["database"], status: "ok" },
    "Business / Shop": { tools: 18, deps: ["database", "env_business"], status: "ok" },
    "Live Shop Data": { tools: 6, deps: ["database", "env_business"], status: "ok" },
    "Revenue Tracking": { tools: 5, deps: ["database"], status: "ok" },
    "Win-Back / Retention": { tools: 3, deps: ["database"], status: "ok" },
    "Content / Marketing": { tools: 11, deps: ["database", "env_ai"], status: "ok" },
    "Communication": { tools: 4, deps: ["env_communication"], status: "ok" },
    "AI / Analysis": { tools: 10, deps: ["env_ai"], status: "ok" },
    "Brain Intelligence": { tools: 5, deps: ["database", "env_ai"], status: "ok" },
    "Files (Drive + GitHub)": { tools: 11, deps: ["env_files"], status: "ok" },
    "Command Routines": { tools: 8, deps: ["database", "env_ai"], status: "ok" },
    "Research": { tools: 7, deps: ["env_ai"], status: "ok" },
  };

  // Calculate category status from dependency health
  for (const [name, cat] of Object.entries(categories)) {
    const depStatuses = cat.deps.map(d => checks[d]?.status || "down");
    if (depStatuses.includes("down")) {
      categories[name].status = "down";
    } else if (depStatuses.includes("degraded")) {
      categories[name].status = "degraded";
    }
  }

  // Summary
  const totalTools = Object.values(categories).reduce((sum, c) => sum + c.tools, 0);
  const okCategories = Object.values(categories).filter(c => c.status === "ok").length;
  const degradedCategories = Object.values(categories).filter(c => c.status === "degraded").length;
  const downCategories = Object.values(categories).filter(c => c.status === "down").length;

  return NextResponse.json({
    timestamp: now,
    summary: {
      totalTools,
      totalCategories: Object.keys(categories).length,
      ok: okCategories,
      degraded: degradedCategories,
      down: downCategories,
      overallStatus: downCategories > 0 ? "degraded" : okCategories === Object.keys(categories).length ? "operational" : "partial",
    },
    dependencies: checks,
    categories,
  });
}
