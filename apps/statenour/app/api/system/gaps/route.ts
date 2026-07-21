import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { CRONS } from "@/config/crons";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";
import { nourTools } from "@/lib/ai/tools";
import { ENV_SPEC, isProd } from "@/lib/env";
import fs from "node:fs";
import path from "node:path";

/**
 * GET /api/system/gaps — "nothing missing" detector.
 *
 * Automated discovery of coded-but-not-surfaced things (v11 W11.4).
 * Scans for:
 *   · Unscheduled crons (in config/crons.ts but mode ≠ "active")
 *   · Empty API shell dirs (exist on disk, no route.ts)
 *   · Tools exported but missing catalog entries
 *   · Catalog entries without a matching export (dark tools)
 *   · Models with zero rows in the last 30d (candidates for retire)
 *   · Env vars in the spec but unset in the runtime
 *   · Retired crons past their deletion date (past TTL)
 */

interface Gap {
  category: string;
  severity: "info" | "warn" | "critical";
  key: string;
  detail: string;
  fix?: string;
}

const MODELS_TO_AUDIT = [
  "aiGeneration",
  "apiRequestLog",
  "autonomousAction",
  "brainDump",
  "captureInboxItem",
  "contradiction",
  "cronJobLog",
  "decisionReplay",
  "deviceCommand",
  "deviceEvent",
  "driftAlert",
  "errorLog",
  "lifeGoal",
  "localSyncLog",
  "mission",
  "personalDailyLog",
  "recoveryActionLog",
  "reflection",
  "situationLog",
  "stagedRecoveryItem",
  "stateLog",
  "systemMetric",
  "task",
] as const;

export const GET = apiHandler(async () => {
  const gaps: Gap[] = [];
  const cwd = process.cwd();

  // ── 1. Unscheduled crons + retirement-past-due ─────────────────
  const today = new Date();
  for (const c of CRONS) {
    if (c.mode === "folded") {
      gaps.push({
        category: "crons",
        severity: "info",
        key: c.name,
        detail: `folded — runs inside ${c.foldedInto ?? "another cron"}; keep or delete`,
      });
    }
    if (c.mode === "retired" && c.retireAfter) {
      const when = new Date(c.retireAfter);
      if (when < today) {
        gaps.push({
          category: "crons",
          severity: "warn",
          key: c.name,
          detail: `retired cron past deletion date (${c.retireAfter}) — delete app/api/cron/${c.name}/route.ts`,
          fix: `rm -r app/api/cron/${c.name}`,
        });
      }
    }
  }

  // ── 2. Empty /api/* shells ────────────────────────────────────
  const apiRoot = path.join(cwd, "app/api");
  if (fs.existsSync(apiRoot)) {
    const stack: string[] = [apiRoot];
    while (stack.length) {
      const dir = stack.pop()!;
      const entries = fs.readdirSync(dir);
      const hasRoute = entries.some((e) => e === "route.ts" || e === "route.tsx");
      if (hasRoute) continue;
      let hasSubdirWithRoute = false;
      for (const e of entries) {
        const full = path.join(dir, e);
        try {
          if (fs.statSync(full).isDirectory()) {
            stack.push(full);
            hasSubdirWithRoute = true;
          }
        } catch {
          // race on disk; ignore
        }
      }
      if (!hasSubdirWithRoute && dir !== apiRoot) {
        gaps.push({
          category: "api",
          severity: "warn",
          key: path.relative(cwd, dir).replace(/\\/g, "/"),
          detail: "empty /api/* shell — no route.ts anywhere under it",
          fix: `rm -r ${path.relative(cwd, dir).replace(/\\/g, "/")}`,
        });
      }
    }
  }

  // ── 3. Tool catalog drift ──────────────────────────────────────
  const exportedTools = new Set(Object.keys(nourTools));
  const catalogedTools = new Set(TOOL_CATALOG.map((t) => t.name));
  for (const n of exportedTools) {
    if (!catalogedTools.has(n)) {
      gaps.push({
        category: "tools",
        severity: "critical",
        key: n,
        detail: `tool exported but missing from TOOL_CATALOG — chat pruning and cost-grouping broken for this tool`,
        fix: "add an entry to lib/ai/tools/catalog.ts TOOL_CATALOG",
      });
    }
  }
  for (const n of catalogedTools) {
    if (!exportedTools.has(n)) {
      gaps.push({
        category: "tools",
        severity: "critical",
        key: n,
        detail: "catalog entry without a matching nourTools export",
        fix: "add the tool to lib/ai/tools.ts or remove the catalog entry",
      });
    }
  }

  // ── 4. Model write staleness (30d) ─────────────────────────────
  const since30d = new Date(Date.now() - 30 * 86400_000);
  await Promise.all(
    MODELS_TO_AUDIT.map(async (m) => {
      try {
        const client = prisma as unknown as Record<string, { count: (args: unknown) => Promise<number> }>;
        const model = client[m];
        if (!model) return;
        const count = await model.count({ where: { createdAt: { gte: since30d } } });
        if (count === 0) {
          gaps.push({
            category: "data",
            severity: "info",
            key: m,
            detail: `zero writes in 30d — either unused or the writer is broken`,
          });
        }
      } catch {
        // model doesn't have createdAt or lookup failed — skip silently
      }
    }),
  );

  // ── 5. Missing env vars ────────────────────────────────────────
  for (const spec of ENV_SPEC) {
    if (spec.tier !== "required") continue;
    const when = spec.when ? spec.when(isProd()) : true;
    if (!when) continue;
    const direct = process.env[spec.key];
    const viaAlias = (spec.aliases ?? []).some((a) => process.env[a]);
    if (!direct && !viaAlias) {
      gaps.push({
        category: "env",
        severity: "critical",
        key: spec.key,
        detail: `required env var missing: ${spec.description}`,
        fix: `set ${spec.key} in Vercel env or .env.local`,
      });
    }
  }

  // ── 6. Retired but still-coded crons ──────────────────────────
  for (const c of CRONS) {
    if (c.mode === "retired" && c.retireAfter) {
      const daysLeft = Math.round((new Date(c.retireAfter).getTime() - Date.now()) / 86400_000);
      if (daysLeft >= 0 && daysLeft < 7) {
        gaps.push({
          category: "crons",
          severity: "info",
          key: c.name,
          detail: `retired cron scheduled for deletion in ${daysLeft}d — prepare to remove`,
        });
      }
    }
  }

  const summary = {
    total: gaps.length,
    bySeverity: gaps.reduce<Record<string, number>>((acc, g) => {
      acc[g.severity] = (acc[g.severity] ?? 0) + 1;
      return acc;
    }, {}),
    byCategory: gaps.reduce<Record<string, number>>((acc, g) => {
      acc[g.category] = (acc[g.category] ?? 0) + 1;
      return acc;
    }, {}),
  };

  return { gaps, summary, generatedAt: new Date().toISOString() };
}, { auth: "owner" }); // v9.1.14 · was leaking unset env vars list + cron manifest gaps (recon data)
