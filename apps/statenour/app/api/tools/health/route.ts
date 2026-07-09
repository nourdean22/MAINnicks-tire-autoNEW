import { NextResponse } from "next/server";
// Live diagnostic — must NOT prerender. With ISR/static, the build-time
// render (no env vars, no DB) reported every category "down" + "Missing:
// VENICE_API_KEY" and served that false snapshot. force-dynamic = always
// reflects real runtime state. (2026-06-02 audit.)
export const dynamic = "force-dynamic";
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
    // Warm the pooled connection first, then time a second probe (measure
    // steady-state, not cold-connection setup). Mirrors the service copy.
    await prisma.$queryRaw`SELECT 1`;
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
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
    // ai: the runtime provider fleet. AI is operational as long as AT
    // LEAST ONE provider key is present (Ollama/OpenAI/Gemini/Anthropic
    // fallback chain). Venice was retired; keying off the now-unset
    // VENICE_API_KEY made the arsenal read "down" while AI was fully
    // operational. anyOf semantics — mirrors lib/services/tools-health.ts.
    ai: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OLLAMA_API_KEY"],
    voice: ["HUGGINGFACE_API_KEY"],
    files: ["GITHUB_TOKEN", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    communication: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    business: ["STATENOUR_SYNC_KEY"],
    cron: ["CRON_SECRET"],
  };

  // Categories whose keys are alternatives, not requirements: healthy when
  // ANY ONE key is present. Mirrors lib/services/tools-health.ts.
  const ANY_OF_CATEGORIES = new Set(["ai"]);

  for (const [category, vars] of Object.entries(envChecks)) {
    const present = vars.filter(v => !!process.env[v]);
    const missing = vars.filter(v => !process.env[v]);
    const ok = ANY_OF_CATEGORIES.has(category) ? present.length > 0 : missing.length === 0;
    checks[`env_${category}`] = {
      status: ok ? "ok" : present.length > 0 ? "degraded" : "down",
      detail: ok
        ? "All set"
        : ANY_OF_CATEGORIES.has(category)
          ? `None set: ${vars.join(", ")}`
          : `Missing: ${missing.join(", ")}`,
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
