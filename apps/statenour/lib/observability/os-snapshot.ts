/**
 * OS-Snapshot collector · v10.0.526 · Arc A F5 (drift detector)
 *
 * Daily metrics over the codebase itself: route count, cron count,
 * tool count, LOC by domain, test count, monster-file count, `: any`
 * usage, console-call count. Persisted as SystemMetric rows under
 * `metric_name="os_snapshot.<metric>"` so we don't add a new table
 * (no-duplicate-data rule).
 *
 * Each counter LIFTS from its canonical source where one exists:
 *   · countRoutes → app/api walk (mirrors scripts/audit-api-readiness)
 *   · countCrons  → CRONS.filter(c => c.mode === 'active') (config/crons.ts)
 *   · countTools  → TOOL_CATALOG.length (lib/ai/tools/catalog.ts)
 *
 * The other counters (LOC / monster / `: any` / console.*) do their
 * own filesystem walks because no single-source-of-truth file exists
 * for them in the repo today.
 *
 * Pure read-side · no DB writes here. The cron handler decides whether
 * to persist (route at app/api/cron/os-snapshot/route.ts).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";

import { CRONS } from "@/config/crons";
import { TOOL_CATALOG } from "@/lib/ai/tools/catalog";

const REPO_ROOT = process.cwd();

/** Domains we sum LOC across. Order is reported back as-is. */
const LOC_DOMAINS = ["app", "components", "lib", "hooks", "prisma"] as const;
export type LocDomain = (typeof LOC_DOMAINS)[number];

export interface OsSnapshot {
  routeCount: number;
  cronCount: number;
  toolCount: number;
  locByDomain: Record<LocDomain, number>;
  locTotal: number;
  testFileCount: number;
  monsterFileCount: number;
  /** Snapshot of the >1000-LOC files for human inspection. */
  monsterFiles: { path: string; lines: number }[];
  anyUsageCount: number;
  consoleCallCount: number;
  capturedAt: string;
}

/**
 * Count app-router API route files. Uses the same walking convention
 * as scripts/audit-api-readiness.ts (every `route.ts` under `app/api`)
 * so the count never drifts from the audit's denominator.
 */
export async function countRoutes(): Promise<number> {
  const matches = await glob("app/api/**/route.ts", {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: ["**/node_modules/**", "**/.next/**", "**/.next-prod/**", "**/standalone/**"],
  });
  return matches.length;
}

/**
 * Active crons in the manifest. Lifted from CRONS — config/crons.ts
 * is the single source of truth (vercel.json is generated from it).
 */
export function countCrons(): number {
  return CRONS.filter((c) => c.mode === "active").length;
}

/**
 * Catalogued tool count. Lifted from TOOL_CATALOG, which is the
 * authoritative registry surfacing tools to the chat pipeline.
 */
export function countTools(): number {
  return TOOL_CATALOG.length;
}

/**
 * Lines-of-code per tracked domain. We only count source files
 * (.ts/.tsx/.js/.jsx/.prisma) and skip build artifacts, node_modules,
 * and Next's generated cache. The number is structural, not stylistic
 * — comments and blank lines are kept because they fluctuate with
 * doc work which is also a signal worth tracking week-over-week.
 */
export async function countLocByDomain(): Promise<Record<LocDomain, number>> {
  const out = {} as Record<LocDomain, number>;
  for (const domain of LOC_DOMAINS) {
    out[domain] = await sumLocForDir(domain);
  }
  return out;
}

async function sumLocForDir(dir: string): Promise<number> {
  const matches = await glob(`${dir}/**/*.{ts,tsx,js,jsx,prisma}`, {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-prod/**",
      "**/standalone/**",
      "**/dist/**",
      "**/*.d.ts",
    ],
  });
  let total = 0;
  for (const rel of matches) {
    try {
      const content = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      total += content.split("\n").length;
    } catch {
      // unreadable files (broken symlinks, race) silently skipped
    }
  }
  return total;
}

/** Test files under `tests/`. Pattern-matches the vitest layout. */
export async function countTestFiles(): Promise<number> {
  const matches = await glob("tests/**/*.test.{ts,tsx}", {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: ["**/node_modules/**", "**/.next/**", "**/.next-prod/**", "**/standalone/**"],
  });
  return matches.length;
}

/**
 * Files exceeding the LOC threshold. Defaults to 1000 — the same
 * monster-file gate used in the production audit doc.
 */
export async function countMonsterFiles(
  threshold = 1000,
): Promise<{ count: number; files: { path: string; lines: number }[] }> {
  const matches = await glob("{app,components,lib,hooks}/**/*.{ts,tsx}", {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-prod/**",
      "**/standalone/**",
      "**/dist/**",
      "**/*.d.ts",
    ],
  });
  const monsters: { path: string; lines: number }[] = [];
  for (const rel of matches) {
    try {
      const content = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      const lines = content.split("\n").length;
      if (lines > threshold) {
        monsters.push({ path: rel, lines });
      }
    } catch {
      // skip unreadable
    }
  }
  // largest first — keeps the persisted list useful as a top-N view
  monsters.sort((a, b) => b.lines - a.lines);
  return { count: monsters.length, files: monsters };
}

/**
 * Count `: any` annotations across TS source. Skips .d.ts (types
 * upstream sometimes ship `any` in declarations · we don't own that).
 *
 * Intentionally simple grep — we'd rather over-count modestly than
 * miss escapes. False positives like string contents are rare.
 */
export async function countAnyUsage(): Promise<number> {
  const matches = await glob("{app,components,lib,hooks,prisma}/**/*.{ts,tsx}", {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-prod/**",
      "**/standalone/**",
      "**/dist/**",
      "**/*.d.ts",
    ],
  });
  let total = 0;
  const pattern = /:\s*any\b/g;
  for (const rel of matches) {
    try {
      const content = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      const m = content.match(pattern);
      if (m) total += m.length;
    } catch {
      // skip
    }
  }
  return total;
}

/**
 * Count direct console.{log,error,warn} calls across src. The
 * structured logger (lib/logger.ts) is preferred; console.* in prod
 * paths is a smell.
 */
export async function countConsoleCalls(): Promise<number> {
  const matches = await glob("{app,components,lib,hooks}/**/*.{ts,tsx}", {
    cwd: REPO_ROOT,
    nodir: true,
    ignore: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.next-prod/**",
      "**/standalone/**",
      "**/dist/**",
      "**/*.d.ts",
    ],
  });
  let total = 0;
  const pattern = /\bconsole\.(log|error|warn)\s*\(/g;
  for (const rel of matches) {
    try {
      const content = await fs.readFile(path.join(REPO_ROOT, rel), "utf8");
      const m = content.match(pattern);
      if (m) total += m.length;
    } catch {
      // skip
    }
  }
  return total;
}

/**
 * One-shot collector. Used by the cron handler. Returns every metric
 * in a single object so the caller can iterate over keys cleanly.
 */
export async function snapshotAll(): Promise<OsSnapshot> {
  const [
    routeCount,
    locByDomain,
    testFileCount,
    monster,
    anyUsageCount,
    consoleCallCount,
  ] = await Promise.all([
    countRoutes(),
    countLocByDomain(),
    countTestFiles(),
    countMonsterFiles(),
    countAnyUsage(),
    countConsoleCalls(),
  ]);

  const cronCount = countCrons();
  const toolCount = countTools();

  const locTotal = Object.values(locByDomain).reduce((a, b) => a + b, 0);

  return {
    routeCount,
    cronCount,
    toolCount,
    locByDomain,
    locTotal,
    testFileCount,
    monsterFileCount: monster.count,
    monsterFiles: monster.files,
    anyUsageCount,
    consoleCallCount,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Flatten OsSnapshot into the (metric, value) pairs the SystemMetric
 * table expects. Keeping this co-located lets the cron writer and the
 * tests both consume the same projection.
 */
export function snapshotToMetricRows(
  snap: OsSnapshot,
): { metric: string; value: number }[] {
  const rows: { metric: string; value: number }[] = [
    { metric: "os_snapshot.route_count", value: snap.routeCount },
    { metric: "os_snapshot.cron_count", value: snap.cronCount },
    { metric: "os_snapshot.tool_count", value: snap.toolCount },
    { metric: "os_snapshot.loc_total", value: snap.locTotal },
    { metric: "os_snapshot.test_file_count", value: snap.testFileCount },
    { metric: "os_snapshot.monster_file_count", value: snap.monsterFileCount },
    { metric: "os_snapshot.any_usage_count", value: snap.anyUsageCount },
    { metric: "os_snapshot.console_call_count", value: snap.consoleCallCount },
  ];
  for (const domain of LOC_DOMAINS) {
    rows.push({
      metric: `os_snapshot.loc_${domain}`,
      value: snap.locByDomain[domain] ?? 0,
    });
  }
  return rows;
}

/** Tracked metric names the drift detector compares week-over-week. */
export const OS_SNAPSHOT_METRIC_NAMES: readonly string[] = [
  "os_snapshot.route_count",
  "os_snapshot.cron_count",
  "os_snapshot.tool_count",
  "os_snapshot.loc_total",
  "os_snapshot.test_file_count",
  "os_snapshot.monster_file_count",
  "os_snapshot.any_usage_count",
  "os_snapshot.console_call_count",
  ...LOC_DOMAINS.map((d) => `os_snapshot.loc_${d}`),
];
