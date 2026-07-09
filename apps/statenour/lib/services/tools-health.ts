/**
 * Tools-health service · Phase UU.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC settings slice).
 *
 * Lifted verbatim from `app/api/tools/health/route.ts` so the legacy
 * REST endpoint AND the new `system.toolsHealth` procedure call the
 * same function · drift between consumers structurally impossible.
 *
 * Runtime dependency check for every tool category: DB latency probe,
 * categorized env-var presence, then a per-category status rollup
 * derived from its declared dependencies.
 */

import { prisma } from "@/lib/prisma";

type HealthStatus = "ok" | "degraded" | "down";

interface DepCheck {
  status: HealthStatus;
  detail: string;
  checked: string[];
}

interface CategoryHealth {
  tools: number;
  deps: string[];
  status: HealthStatus;
}

export interface ToolsHealthReport {
  timestamp: string;
  summary: {
    totalTools: number;
    totalCategories: number;
    ok: number;
    degraded: number;
    down: number;
    overallStatus: "operational" | "degraded" | "partial";
  };
  dependencies: Record<string, DepCheck>;
  categories: Record<string, CategoryHealth>;
}

/** Build the full tool-category health report. */
export async function buildToolsHealth(): Promise<ToolsHealthReport> {
  const checks: Record<string, DepCheck> = {};
  const now = new Date().toISOString();

  // ── DATABASE ──
  try {
    // Warm the pooled connection FIRST, then time a SECOND probe — so we
    // measure steady-state latency, not cold-connection setup. A fresh
    // serverless invocation's first query carries connect overhead
    // (regularly >500ms) even though the DB is fast warm (~260ms per
    // /api/health) — that cold spike was flipping database to "degraded"
    // and dragging arsenal to PARTIAL on an otherwise-healthy DB.
    // (2026-06-02 audit.)
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
    checks.database = {
      status: "down",
      detail: String(e),
      checked: ["prisma", "neon"],
    };
  }

  // ── ENV VARS — categorized ──
  const envChecks: Record<string, string[]> = {
    // ai: the runtime provider fleet. AI is operational as long as AT
    // LEAST ONE provider key is present — the live chain falls back across
    // Ollama -> OpenAI -> Gemini -> Anthropic (lib/ai/provider.ts), and no
    // single key is individually required. (Venice was retired; keying off
    // a now-unset VENICE_API_KEY made the arsenal read "down" while AI was
    // fully operational.) This category uses anyOf semantics — see
    // ANY_OF_CATEGORIES below.
    ai: [
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "OLLAMA_API_KEY",
    ],
    voice: ["HUGGINGFACE_API_KEY"],
    files: ["GITHUB_TOKEN", "GOOGLE_SERVICE_ACCOUNT_KEY"],
    communication: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
    business: ["STATENOUR_SYNC_KEY"],
    cron: ["CRON_SECRET"],
  };

  // Categories whose keys are alternatives, not requirements: the category
  // is healthy when ANY ONE key is present (e.g. AI's fallback provider
  // fleet). All other categories require every declared key.
  const ANY_OF_CATEGORIES = new Set(["ai"]);

  for (const [category, vars] of Object.entries(envChecks)) {
    const present = vars.filter((v) => !!process.env[v]);
    const missing = vars.filter((v) => !process.env[v]);
    const ok = ANY_OF_CATEGORIES.has(category)
      ? present.length > 0
      : missing.length === 0;
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
  const categories: Record<string, CategoryHealth> = {
    "Personal Data (read)": { tools: 17, deps: ["database"], status: "ok" },
    "Personal Data (write)": { tools: 15, deps: ["database"], status: "ok" },
    "Weekly Planning": { tools: 5, deps: ["database"], status: "ok" },
    "Business / Shop": {
      tools: 18,
      deps: ["database", "env_business"],
      status: "ok",
    },
    "Live Shop Data": {
      tools: 6,
      deps: ["database", "env_business"],
      status: "ok",
    },
    "Revenue Tracking": { tools: 5, deps: ["database"], status: "ok" },
    "Win-Back / Retention": { tools: 3, deps: ["database"], status: "ok" },
    "Content / Marketing": {
      tools: 11,
      deps: ["database", "env_ai"],
      status: "ok",
    },
    Communication: { tools: 4, deps: ["env_communication"], status: "ok" },
    "AI / Analysis": { tools: 10, deps: ["env_ai"], status: "ok" },
    "Brain Intelligence": {
      tools: 5,
      deps: ["database", "env_ai"],
      status: "ok",
    },
    "Files (Drive + GitHub)": {
      tools: 11,
      deps: ["env_files"],
      status: "ok",
    },
    "Command Routines": {
      tools: 8,
      deps: ["database", "env_ai"],
      status: "ok",
    },
    Research: { tools: 7, deps: ["env_ai"], status: "ok" },
  };

  // Calculate category status from dependency health
  for (const [name, cat] of Object.entries(categories)) {
    const depStatuses = cat.deps.map((d) => checks[d]?.status || "down");
    if (depStatuses.includes("down")) {
      categories[name].status = "down";
    } else if (depStatuses.includes("degraded")) {
      categories[name].status = "degraded";
    }
  }

  // Summary
  const totalTools = Object.values(categories).reduce(
    (sum, c) => sum + c.tools,
    0,
  );
  const okCategories = Object.values(categories).filter(
    (c) => c.status === "ok",
  ).length;
  const degradedCategories = Object.values(categories).filter(
    (c) => c.status === "degraded",
  ).length;
  const downCategories = Object.values(categories).filter(
    (c) => c.status === "down",
  ).length;

  // Optional integrations (graceful-degrade) must NOT mark the whole
  // arsenal "degraded" when their keys are absent. "Files (Drive +
  // GitHub)" tools throw-and-fall-back (GITHUB_TOKEN is critical:false;
  // Drive tools return "not configured") -- a missing optional key is
  // "not set up", not "broken". Same false-alarm class as the old
  // integration-quotas panel (which probed integrations statenour does
  // not use). overallStatus is therefore computed from REQUIRED
  // categories only; database / env_business (STATENOUR_SYNC_KEY) /
  // env_ai / env_communication stay honest and still drive "degraded"
  // when genuinely down. (2026-06-02 audit.)
  const OPTIONAL_CATEGORIES = new Set(["Files (Drive + GitHub)"]);
  const requiredCats = Object.entries(categories).filter(
    ([name]) => !OPTIONAL_CATEGORIES.has(name),
  );
  const downRequired = requiredCats.filter(
    ([, c]) => c.status === "down",
  ).length;
  const notOkRequired = requiredCats.filter(
    ([, c]) => c.status !== "ok",
  ).length;

  return {
    timestamp: now,
    summary: {
      totalTools,
      totalCategories: Object.keys(categories).length,
      ok: okCategories,
      degraded: degradedCategories,
      down: downCategories,
      overallStatus:
        downRequired > 0
          ? "degraded"
          : notOkRequired > 0
            ? "partial"
            : "operational",
    },
    dependencies: checks,
    categories,
  };
}
